#!/usr/bin/env node

import path from "node:path";

import type { MacAgentRelaySource, MacAgentServiceConnectionStatus } from "@kodexlink/schemas";
import { ERROR_CODES, PROTOCOL_VERSION } from "@kodexlink/protocol";
import { configureFileLogger, createLogger } from "@kodexlink/shared";

import { loadMacAgentConfig } from "./config/index.js";
import { LocalPanelActions } from "./local-panel/local-panel-actions.js";
import { LocalPanelServer } from "./local-panel/local-panel-server.js";
import { LocalPanelStateService } from "./local-panel/local-panel-state-service.js";
import { CodexClient } from "./codex/codex-client.js";
import {
  CODEX_CLI_INSTALL_COMMAND,
  CodexRuntimeProbeError,
  probeCodexRuntimeCommand,
  resolveCodexRuntimeCommandPath
} from "./codex/codex-start-preflight.js";
import { AgentHealthController } from "./health/agent-health-controller.js";
import { PairingManager, type AgentIdentity } from "./pairing/pairing-manager.js";
import { PairingSnapshotController } from "./pairing/pairing-snapshot-controller.js";
import { canRenderTerminalQr, renderTerminalQr } from "./pairing/terminal-qr.js";
import { startTerminalPairingCountdown } from "./pairing/terminal-pairing-countdown.js";
import { getPlatformId, isManagedServicePlatform } from "./platform/platform-id.js";
import { createAgentCredentialStore, type AgentCredentialStore } from "./product/agent-credential-store.js";
import { CLI_NAME, MAC_PRODUCT_NAME, PRODUCT_NAME } from "./product/brand.js";
import {
  getProductConsoleStateFilePath,
  getProductDataDirectory,
  getProductLogDirectoryPath,
  getProductServiceStateFilePath,
  getProductSettingsFilePath,
  getProductStateFilePath,
  ensureProductDataDirectory
} from "./product/directories.js";
import { getAgentVersion } from "./product/agent-version.js";
import { ProductProfileStore, type ProductProfile } from "./product/profile-store.js";
import {
  MOBILE_COMPANION_SCAN_NOTICE,
  getMobileCompanionApp,
  type MobileCompanionApp
} from "./product/mobile-companion.js";
import { ProductRuntimeStore } from "./product/runtime-store.js";
import { ProductServiceStateStore } from "./product/service-state-store.js";
import { ProductSettingsStore } from "./product/settings-store.js";
import { RelayClient, RelayRequestHandlingError } from "./relay/relay-client.js";
import { buildThreadResumeWindow, describeThreadResumeWindow } from "./relay/thread-resume-window.js";
import {
  getLaunchAgentStatus,
  installOrUpdateLaunchAgent,
  startLaunchAgent,
  stopLaunchAgent,
  uninstallLaunchAgent
} from "./service/launch-agent.js";
import { RelayConnectionMonitor } from "./service/relay-connection-monitor.js";
import { ServiceStateNotifier } from "./service/service-state-notifier.js";
import { SessionMapper } from "./session/session-mapper.js";

configureFileLogger({
  appName: "desktop-agent",
  logDir: getProductLogDirectoryPath()
});

interface CliOptions {
  command: string;
  noOpen: boolean;
  relayUrl?: string;
  showPairing: boolean;
  threadLimit?: string;
}

interface DoctorCheck {
  label: string;
  ok: boolean;
  detail: string;
}

function resolveRuntimeCommandPath(command: string): string | null {
  return resolveCodexRuntimeCommandPath(command);
}

function resolveEffectiveCodexCommand(
  command: string,
  logger: ReturnType<typeof createLogger>
): string {
  const resolvedPath = resolveRuntimeCommandPath(command);
  if (!resolvedPath) {
    return command;
  }

  if (resolvedPath !== command) {
    logger.info("resolved codex runtime command", {
      configuredCommand: command,
      resolvedCommand: resolvedPath
    });
  }

  return resolvedPath;
}

function formatRuntimeUnavailableDetail(command: string): string {
  return `未找到运行时命令：${command}`;
}

function createRuntimeUnavailableMessage(command: string): string {
  return `桌面端运行时当前不可用，请先安装或配置 ${command}`;
}

function describeCurrentPlatform(): string {
  switch (getPlatformId()) {
    case "macos":
      return "macOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

function printManualServiceModeNotice(): void {
  process.stdout.write(
    `当前平台（${describeCurrentPlatform()}）暂不支持后台服务托管，请保持 ${CLI_NAME} 进程在终端中运行。\n`
  );
}

function printPreflightNoticeBlock(title: string, rows: Array<[string, string]>): void {
  const normalizedRows = rows.map(([label, value]) => [label, value.trim()] as const);
  const labelWidth = Math.max(...normalizedRows.map(([label]) => label.length), 0);
  const border = "=".repeat(56);
  const lines = normalizedRows.map(
    ([label, value]) => `${label.padEnd(labelWidth, " ")} : ${value}`
  );
  process.stdout.write(`\n${border}\n${title}\n${border}\n${lines.join("\n")}\n${border}\n\n`);
}

async function ensureCodexReadyForStart(
  codexCommand: string,
  logger: ReturnType<typeof createLogger>
): Promise<boolean> {
  process.stdout.write("Checking whether Codex is installed...\n");

  const commandPath = resolveCodexRuntimeCommandPath(codexCommand);
  if (!commandPath) {
    printPreflightNoticeBlock("Codex CLI Required", [
      ["Status", `No usable Codex command was found: ${codexCommand}`],
      ["Install", CODEX_CLI_INSTALL_COMMAND],
      ["Optional", "Set CODEX_COMMAND to the full executable path if Codex CLI is already installed."]
    ]);
    logger.warn("codex start preflight failed: command not found", {
      codexCommand,
      platform: describeCurrentPlatform()
    });
    return false;
  }

  printPreflightNoticeBlock(
    "Codex Detected",
    [[commandPath === codexCommand ? "Command" : "Path", commandPath]]
  );
  process.stdout.write("Checking whether Codex can start...\n");

  try {
    await probeCodexRuntimeCommand(commandPath, logger, {
      onReadyToUseCheck: () => {
        process.stdout.write("Checking whether Codex is ready to use...\n");
      }
    });
    printPreflightNoticeBlock("Codex Check Passed", [["Status", "Continuing to start KodexLink..."]]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CodexRuntimeProbeError && error.reason === "auth") {
      printPreflightNoticeBlock("Codex Sign-In Required", [
        ["Status", `Codex is installed, but it is not ready to use: ${message}`],
        ["Action", "Open Codex CLI, complete sign-in, then try again."]
      ]);
    } else {
      printPreflightNoticeBlock("Codex Runtime Check Failed", [
        ["Status", `Codex was found, but the local runtime check failed: ${message}`],
        ["Command", `${codexCommand} app-server`],
        ["Action", "Make sure the command above can start successfully, then try again."]
      ]);
    }
    logger.warn("codex start preflight failed: runtime probe failed", {
      codexCommand,
      commandPath,
      message
    });
    return false;
  }
}

function hasSamePersistedIdentity(
  profile: ProductProfile,
  identity: AgentIdentity
): boolean {
  const persistedIdentity = profile.authByRelay[identity.relayBaseUrl];
  if (!persistedIdentity) {
    return false;
  }

  return (
    persistedIdentity.deviceId === identity.deviceId &&
    persistedIdentity.accessToken === identity.accessToken &&
    persistedIdentity.refreshToken === identity.refreshToken &&
    persistedIdentity.accessExpiresAt === identity.accessExpiresAt &&
    persistedIdentity.refreshExpiresAt === identity.refreshExpiresAt &&
    persistedIdentity.relayBaseUrl === identity.relayBaseUrl
  );
}

async function loadOrCreateProfileWithAuth(
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  options: {
    explicitAgentId?: string;
    allowEnvironmentOverride?: boolean;
  }
): Promise<ProductProfile> {
  const profile = await profileStore.loadOrCreate(options);
  return credentialStore.hydrateProfile(profileStore, profile);
}

async function loadProfileWithAuth(
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore
): Promise<ProductProfile | null> {
  const profile = await profileStore.load();
  if (!profile) {
    return null;
  }

  return credentialStore.hydrateProfile(profileStore, profile);
}

async function resolveAgentIdentity(
  pairingManager: PairingManager,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  profile: ProductProfile
): Promise<{
  profile: ProductProfile;
  identity: AgentIdentity;
}> {
  const resolution = await pairingManager.ensureAgentIdentity({
    agentId: profile.agentId,
    deviceName: profile.deviceName,
    authByRelay: profile.authByRelay
  });

  if (hasSamePersistedIdentity(profile, resolution.identity)) {
    return {
      profile,
      identity: resolution.identity
    };
  }

  const updatedProfile = await credentialStore.persistIdentity(profileStore, profile, resolution.identity);
  return {
    profile: updatedProfile,
    identity: resolution.identity
  };
}

async function resolveProfileAndIdentityForRelay(
  relayUrl: string,
  logger: ReturnType<typeof createLogger>,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean
): Promise<{
  profile: ProductProfile;
  identity: AgentIdentity;
}> {
  const loadedProfile = await loadOrCreateProfileWithAuth(profileStore, credentialStore, {
    explicitAgentId,
    allowEnvironmentOverride: allowEnvironmentAgentIdOverride
  });

  return resolveAgentIdentity(
    new PairingManager(relayUrl, logger),
    profileStore,
    credentialStore,
    loadedProfile
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveServiceIdentityWithRetry(
  pairingManager: PairingManager,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  relayConnectionMonitor: RelayConnectionMonitor,
  logger: ReturnType<typeof createLogger>,
  relayUrl: string,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean
): Promise<AgentIdentity> {
  let attempt = 0;

  while (true) {
    attempt += 1;

    relayConnectionMonitor.onStateChanged({
      relayUrl,
      status: attempt === 1 ? "connecting" : "reconnecting",
      reconnectAttempt: Math.max(0, attempt - 1)
    });

    try {
      const loadedProfile = await loadOrCreateProfileWithAuth(profileStore, credentialStore, {
        explicitAgentId,
        allowEnvironmentOverride: allowEnvironmentAgentIdOverride
      });
      const { identity } = await resolveAgentIdentity(
        pairingManager,
        profileStore,
        credentialStore,
        loadedProfile
      );
      return identity;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
      const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

      logger.error("failed to resolve desktop-agent service identity; retrying", {
        relayUrl,
        attempt,
        delayMs,
        nextRetryAt,
        message
      });
      relayConnectionMonitor.onStateChanged({
        relayUrl,
        status: "reconnecting",
        lastError: message,
        nextRetryAt,
        reconnectAttempt: attempt
      });
      await delay(delayMs);
    }
  }
}

function parseThreadLimit(rawValue: string | undefined): number {
  if (!rawValue) {
    return 5;
  }

  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`invalid thread limit: ${rawValue}`);
  }

  return value;
}

function parseCliOptions(argv: string[]): CliOptions {
  const normalizedArgv = argv.filter((value) => value !== "--");
  let noOpen = false;
  let relayUrl: string | undefined;
  let showPairing = false;
  const positionals: string[] = [];

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const value = normalizedArgv[index];
    if (value === "--no-open") {
      noOpen = true;
      continue;
    }

    if (value === "--show-pairing") {
      showPairing = true;
      continue;
    }

    if (value === "--relay") {
      const nextValue = normalizedArgv[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("--relay requires a valid relay URL");
      }
      relayUrl = nextValue;
      index += 1;
      continue;
    }

    if (value.startsWith("--relay=")) {
      const inlineValue = value.slice("--relay=".length).trim();
      if (inlineValue.length === 0) {
        throw new Error("--relay requires a valid relay URL");
      }
      relayUrl = inlineValue;
      continue;
    }

    positionals.push(value);
  }

  const [command = "start", threadLimit] = positionals;

  return {
    command,
    noOpen,
    relayUrl,
    showPairing,
    threadLimit
  };
}

function printHelp(): void {
  process.stdout.write(
    `${PRODUCT_NAME} commands\n\n` +
      `Usage:\n` +
      `  ${CLI_NAME}                 Start the agent, open the local panel, and show the pairing QR code\n` +
      `  ${CLI_NAME} start           Start ${MAC_PRODUCT_NAME}\n` +
      `  ${CLI_NAME} pair            Open the local panel and show the pairing QR code\n` +
      `  ${CLI_NAME} threads [limit] Show recent thread previews\n` +
      `  ${CLI_NAME} status          Show local configuration status\n` +
      `  ${CLI_NAME} doctor          Check the local runtime environment\n` +
      `  ${CLI_NAME} service-install Install and start the background service (macOS only)\n` +
      `  ${CLI_NAME} service-status  Show background service status (macOS only)\n` +
      `  ${CLI_NAME} service-stop    Stop the background service (macOS only)\n` +
      `  ${CLI_NAME} service-remove  Remove the background service (macOS only)\n` +
      `  ${CLI_NAME} serve           Connect directly to the relay (development entry point)\n\n` +
      `Options:\n` +
      `  --relay <url>  Set and use the current relay URL\n` +
      `  --no-open      Do not open the browser automatically\n` +
      `  --show-pairing Accepted for compatibility; start already shows the pairing QR by default\n`
  );
}

function resolveRuntimeLogDir(): string {
  return getProductLogDirectoryPath();
}

function resolveCurrentScriptPath(): string {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    throw new Error("unable to determine the current desktop-agent script path");
  }

  return path.resolve(scriptPath);
}

function resolveExplicitAgentId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const rawValue = env.AGENT_ID?.trim();
  return rawValue && rawValue.length > 0 ? rawValue : undefined;
}

function shouldAllowEnvironmentAgentIdOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  const rawValue = env.KODEXLINK_ALLOW_AGENT_ID_OVERRIDE?.trim().toLowerCase();
  return rawValue === "1" || rawValue === "true" || rawValue === "yes";
}

function toRelaySourceLabel(source: MacAgentRelaySource): string {
  switch (source) {
    case "cli":
      return "Command line";
    case "env":
      return "Environment variable";
    case "settings":
      return "Local settings";
    case "default":
    default:
      return "Built-in default";
  }
}

function formatCliDateTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatCliOptional(value: string | number | null | undefined, fallback = "Unavailable"): string {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function formatCliYesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function toRelayConnectionStatusLabel(
  status: MacAgentServiceConnectionStatus | null | undefined
): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "online":
      return "Online";
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
    default:
      return "Unknown";
  }
}

function shouldPersistRelayOverride(command: string, source: MacAgentRelaySource): boolean {
  if (source !== "cli" && source !== "env") {
    return false;
  }

  return command === "start" || command === "pair" || command === "service-install";
}

async function runThreadsCommand(
  codexClient: CodexClient,
  logger: ReturnType<typeof createLogger>,
  limit: number
): Promise<void> {
  await codexClient.start();
  const threadPage = await codexClient.listThreads(limit);
  logger.info("loaded codex threads", {
    count: threadPage.items.length,
    nextCursor: threadPage.nextCursor
  });
  for (const thread of threadPage.items) {
    logger.info("thread preview", {
      id: thread.id,
      cwd: thread.cwd,
      preview: thread.preview.trim()
    });
  }
  await codexClient.stop();
}

async function runServeCommand(
  codexClient: CodexClient,
  relayClient: RelayClient,
  healthController: AgentHealthController,
  logger: ReturnType<typeof createLogger>,
  identity: AgentIdentity,
  relayUrl: string,
  codexCommand: string
): Promise<void> {
  const runtimeUnavailableMessage = createRuntimeUnavailableMessage(codexCommand);

  const ensureRuntimeReady = async (throwOnFailure = true): Promise<boolean> => {
    const runtimePath = resolveRuntimeCommandPath(codexCommand);

    if (!runtimePath) {
      const detail = formatRuntimeUnavailableDetail(codexCommand);
      healthController.markRuntimeUnavailable(detail);
      if (throwOnFailure) {
        throw new RelayRequestHandlingError(ERROR_CODES.internalError, runtimeUnavailableMessage);
      }
      return false;
    }

    try {
      await codexClient.start();
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      healthController.markRuntimeUnavailable(`codex app-server 启动失败：${detail}`);
      if (throwOnFailure) {
        throw new RelayRequestHandlingError(ERROR_CODES.internalError, runtimeUnavailableMessage);
      }
      return false;
    }
  };

  healthController.bindReporter((payload) => {
    relayClient.reportHealth(payload);
  });

  if (!resolveRuntimeCommandPath(codexCommand)) {
    healthController.markRuntimeUnavailable(formatRuntimeUnavailableDetail(codexCommand));
  }

  await relayClient.connect(identity, {
    handleThreadList: async (request) => {
      logger.info("handling relay thread list request", {
        requestId: request.id,
        limit: request.payload.limit
      });

      await ensureRuntimeReady();
      const threadPage = await runCoreHealthCheckedOperation(
        healthController,
        "thread_list",
        () => codexClient.listThreads(request.payload.limit, request.payload.cursor)
      );
      return {
        items: threadPage.items,
        nextCursor: threadPage.nextCursor
      };
    },
    handleThreadCreate: async (request) => {
      logger.info("handling relay thread create request", {
        requestId: request.id,
        cwd: request.payload.cwd
      });

      await ensureRuntimeReady();
      const thread = await runCoreHealthCheckedOperation(healthController, "thread_create", () =>
        codexClient.createThread(request.payload.cwd)
      );
      return {
        thread
      };
    },
    handleThreadArchive: async (request) => {
      logger.info("handling relay thread archive request", {
        requestId: request.id,
        threadId: request.payload.threadId
      });

      await ensureRuntimeReady();
      const archivedThread = await runCoreHealthCheckedOperation(
        healthController,
        "thread_archive",
        () => codexClient.archiveThread(request.payload.threadId)
      );
      return {
        threadId: archivedThread.threadId
      };
    },
    handleThreadResume: async (request) => {
      logger.info("handling relay thread resume request", {
        requestId: request.id,
        threadId: request.payload.threadId
      });

      const startedAt = Date.now();
      await ensureRuntimeReady();
      const resumedThread = await runCoreHealthCheckedOperation(
        healthController,
        "thread_resume",
        () => codexClient.resumeThread(request.payload.threadId)
      );
      logger.info("handled relay thread resume request", {
        requestId: request.id,
        threadId: resumedThread.threadId,
        messageCount: resumedThread.messages.length,
        timelineItemCount: resumedThread.timelineItems.length,
        durationMs: Date.now() - startedAt
      });
      const response = buildThreadResumeWindow(resumedThread, request.payload);
      logger.info("prepared relay thread resume window", {
        requestId: request.id,
        ...describeThreadResumeWindow(resumedThread, request.payload, response)
      });
      return response;
    },
    handleApprovalResolve: async (request) => {
      logger.info("handling relay approval resolve request", {
        requestId: request.id,
        approvalId: request.payload.approvalId,
        decision: request.payload.decision
      });

      await ensureRuntimeReady();
      const result = await codexClient.resolveApproval(
        request.payload.approvalId,
        request.payload.decision
      );

      return {
        requestId: request.id,
        approvalId: result.approvalId,
        threadId: result.threadId,
        turnId: result.turnId,
        decision: result.decision
      };
    },
    handleTurnInterrupt: async (request) => {
      logger.info("handling relay turn interrupt request", {
        requestId: request.id,
        threadId: request.payload.threadId,
        turnId: request.payload.turnId
      });

      await ensureRuntimeReady();
      const result = await codexClient.interruptTurn(
        request.payload.threadId,
        request.payload.turnId
      );

      return {
        requestId: request.id,
        threadId: result.threadId,
        turnId: result.turnId
      };
    },
    handleTurnStart: async (request, callbacks) => {
      logger.info("handling relay turn start request", {
        requestId: request.id,
        threadId: request.payload.threadId
      });

      await ensureRuntimeReady();
      const result = await runCoreHealthCheckedOperation(healthController, "turn_start", () =>
        codexClient.startTurn(request.payload.threadId, request.payload.inputs, {
          onStatus: (payload) => {
            logger.debug("forwarding turn status", {
              requestId: request.id,
              threadId: payload.threadId,
              turnId: payload.turnId,
              status: payload.status
            });
            callbacks.onStatus(payload);
          },
          onDelta: (payload) => {
            logger.debug("forwarding turn delta", {
              requestId: request.id,
              turnId: payload.turnId,
              itemId: payload.itemId,
              deltaLength: payload.delta.length
            });
            callbacks.onDelta(payload);
          },
          onCommandOutput: (payload) => {
            logger.debug("forwarding command output", {
              requestId: request.id,
              turnId: payload.turnId,
              itemId: payload.itemId,
              source: payload.source,
              deltaLength: payload.delta.length
            });
            callbacks.onCommandOutput(payload);
          },
          onApprovalRequested: (payload) => {
            logger.info("forwarding approval request", {
              requestId: request.id,
              approvalId: payload.approvalId,
              kind: payload.kind,
              threadId: payload.threadId,
              turnId: payload.turnId
            });
            callbacks.onApprovalRequested(payload);
          }
        })
      );

      return {
        requestId: request.id,
        threadId: result.threadId,
        turnId: result.turnId,
        status: result.status,
        text: result.text,
        errorMessage: result.errorMessage
      };
    }
  });

  await ensureRuntimeReady(false);

  logger.info("desktop agent relay maintenance loop started", {
    agentId: identity.deviceId,
    relayUrl,
    codexCommand
  });
}

async function runCoreHealthCheckedOperation<TResult>(
  healthController: AgentHealthController,
  operation: "thread_list" | "thread_create" | "thread_archive" | "thread_resume" | "turn_start",
  fn: () => Promise<TResult>
): Promise<TResult> {
  try {
    const result = await fn();
    healthController.recordCoreRequestSuccess(operation);
    return result;
  } catch (error) {
    healthController.recordCoreRequestFailure(operation, error);
    throw error;
  }
}

async function maybeOpenLocalPanel(
  localPanelServer: LocalPanelServer,
  logger: ReturnType<typeof createLogger>,
  noOpen: boolean
): Promise<void> {
  if (noOpen) {
    return;
  }

  try {
    await localPanelServer.openInBrowser();
  } catch (error) {
    logger.warn("failed to open local panel in browser", {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function buildTerminalQrSection(title: string, payloadRaw: string): Promise<string> {
  if (!canRenderTerminalQr()) {
    return "";
  }

  const terminalQr = await renderTerminalQr(payloadRaw);
  return `${title}:\n${terminalQr}\n`;
}

function formatMobileCompanionTerminalLine(label: string, app: MobileCompanionApp): string {
  if (app.downloadUrl) {
    return `${label}: ${app.downloadUrl}`;
  }

  if (app.packageName) {
    return `${label}: Unavailable (package: ${app.packageName})`;
  }

  return `${label}: Unavailable`;
}

async function buildMobileCompanionSection(): Promise<string> {
  const downloadApps = [
    {
      label: "iPhone app (App Store)",
      qrTitle: "iPhone app download QR code",
      app: getMobileCompanionApp("ios")
    },
    {
      label: "Android app (Google Play)",
      qrTitle: "Android app download QR code",
      app: getMobileCompanionApp("android")
    }
  ] as const;
  const appLines = downloadApps
    .map(({ label, app }) => formatMobileCompanionTerminalLine(label, app))
    .join("\n");
  const qrSections = (
    await Promise.all(
      downloadApps.map(async ({ qrTitle, app }) =>
        app.downloadUrl ? await buildTerminalQrSection(qrTitle, app.downloadUrl) : ""
      )
    )
  )
    .map((section) => section.trimEnd())
    .filter((section) => section.length > 0)
    .join("\n\n");

  return [MOBILE_COMPANION_SCAN_NOTICE, appLines, qrSections]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

async function printLocalPanelWithOptionalPairing(
  localPanelServer: LocalPanelServer,
  logger: ReturnType<typeof createLogger>,
  noOpen: boolean,
  enableLiveTerminalCountdown = true
): Promise<void> {
  const localPanelPage = await localPanelServer.start();
  await maybeOpenLocalPanel(localPanelServer, logger, noOpen);

  try {
    const pairing = await localPanelServer.getCurrentPairingSnapshot();
    logger.info("local panel ready", {
      pageUrl: localPanelPage.url,
      expiresAt: pairing.expiresAt
    });
    const mobileCompanionSection = await buildMobileCompanionSection();
    const terminalQrSection = await buildTerminalQrSection("Pairing QR code", pairing.payloadRaw);

    process.stdout.write(
      `${mobileCompanionSection}\n` +
        `Local panel URL: ${localPanelPage.url}\n` +
        `QR code expires at: ${formatCliDateTime(pairing.expiresAt)}\n` +
        terminalQrSection +
        `Manual pairing payload:\n${pairing.payloadRaw}\n`
    );

    if (enableLiveTerminalCountdown && canRenderTerminalQr()) {
      startTerminalPairingCountdown({
        expiresAt: pairing.expiresAt
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("local panel pairing snapshot unavailable", {
      pageUrl: localPanelPage.url,
      message
    });
    process.stdout.write(
      `Local panel URL: ${localPanelPage.url}\n` +
        `Pairing QR unavailable: ${message}\n` +
        `Open the local panel and use Reset Identity to generate a fresh QR code.\n`
    );
  }
}

async function runPairCommand(
  localPanelServer: LocalPanelServer,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  logger: ReturnType<typeof createLogger>,
  relayUrl: string,
  relaySource: MacAgentRelaySource,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean,
  noOpen: boolean
): Promise<void> {
  logger.info("preparing local panel pairing view", {
    relaySource,
    relayUrl,
    explicitAgentId,
    allowEnvironmentAgentIdOverride,
    noOpen
  });
  const profile = await loadOrCreateProfileWithAuth(profileStore, credentialStore, {
    explicitAgentId,
    allowEnvironmentOverride: allowEnvironmentAgentIdOverride
  });
  logger.info("local panel pairing view prepared", {
    deviceName: profile.deviceName
  });
  process.stdout.write(
    `${MAC_PRODUCT_NAME} local panel is ready\n` +
      `Relay: ${relayUrl}\n` +
      `Relay source: ${toRelaySourceLabel(relaySource)}\n` +
      `Device name: ${profile.deviceName}\n`
  );
  await printLocalPanelWithOptionalPairing(localPanelServer, logger, noOpen, true);

  if (!profile.hasShownInitialPairing) {
    await profileStore.markInitialPairingShown(profile);
  }
}

async function runStartCommand(
  localPanelServer: LocalPanelServer,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  logger: ReturnType<typeof createLogger>,
  relayUrl: string,
  relaySource: MacAgentRelaySource,
  codexCommand: string,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean,
  showPairing: boolean,
  noOpen: boolean
): Promise<void> {
  logger.info("starting managed desktop-agent", {
    relayUrl,
    relaySource,
    codexCommand,
    showPairing,
    noOpen,
    explicitAgentId,
    allowEnvironmentAgentIdOverride
  });

  if (!(await ensureCodexReadyForStart(codexCommand, logger))) {
    process.exitCode = 1;
    return;
  }

  const profile = await loadOrCreateProfileWithAuth(profileStore, credentialStore, {
    explicitAgentId,
    allowEnvironmentOverride: allowEnvironmentAgentIdOverride
  });

  const logDir = resolveRuntimeLogDir();
  logger.info("installing or updating launch agent", {
    logDir,
    relayUrl,
    codexCommand
  });
  const installResult = installOrUpdateLaunchAgent({
    nodePath: process.execPath,
    scriptPath: resolveCurrentScriptPath(),
    codexCommand,
    logDir,
    workingDirectory: getProductDataDirectory(),
    pathEnv: process.env.PATH,
    nodeEnv: process.env.NODE_ENV,
    explicitAgentId,
    allowEnvironmentAgentIdOverride
  });
  const serviceStatus = startLaunchAgent(logger, logDir, {
    forceRestart: installResult.changed
  });
  logger.info("launch agent started", { ...serviceStatus });

  const serviceHeadline =
    serviceStatus.action === "running"
      ? `${MAC_PRODUCT_NAME} background service is already running`
      : serviceStatus.action === "restarted"
        ? `${MAC_PRODUCT_NAME} background service updated and restarted`
        : `${MAC_PRODUCT_NAME} background service started`;

  process.stdout.write(
    `${serviceHeadline}\n` +
      `Relay: ${relayUrl}\n` +
      `Relay source: ${toRelaySourceLabel(relaySource)}\n` +
      `LaunchAgent: ${serviceStatus.label}\n` +
      `Config file: ${serviceStatus.plistPath}\n` +
      `Current PID: ${formatCliOptional(serviceStatus.pid)}\n` +
      `Stdout log: ${serviceStatus.stdoutPath}\n` +
      `Stderr log: ${serviceStatus.stderrPath}\n`
  );

  await printLocalPanelWithOptionalPairing(localPanelServer, logger, noOpen, true);

  if (!profile.hasShownInitialPairing) {
    await profileStore.markInitialPairingShown(profile);
  }
}

async function runForegroundStartCommand(
  localPanelServer: LocalPanelServer,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  pairingManager: PairingManager,
  codexClient: CodexClient,
  relayClient: RelayClient,
  healthController: AgentHealthController,
  logger: ReturnType<typeof createLogger>,
  relayUrl: string,
  relaySource: MacAgentRelaySource,
  codexCommand: string,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean,
  noOpen: boolean
): Promise<void> {
  logger.info("starting desktop-agent in manual foreground mode", {
    relayUrl,
    relaySource,
    codexCommand,
    noOpen,
    explicitAgentId,
    allowEnvironmentAgentIdOverride,
    platform: describeCurrentPlatform()
  });

  if (!(await ensureCodexReadyForStart(codexCommand, logger))) {
    process.exitCode = 1;
    return;
  }

  const profile = await loadOrCreateProfileWithAuth(profileStore, credentialStore, {
    explicitAgentId,
    allowEnvironmentOverride: allowEnvironmentAgentIdOverride
  });

  process.stdout.write(
    `${MAC_PRODUCT_NAME} manual mode\n` +
      `Relay: ${relayUrl}\n` +
      `Relay source: ${toRelaySourceLabel(relaySource)}\n` +
      `Device name: ${profile.deviceName}\n`
  );
  printManualServiceModeNotice();

  await printLocalPanelWithOptionalPairing(localPanelServer, logger, noOpen, false);

  if (!profile.hasShownInitialPairing) {
    await profileStore.markInitialPairingShown(profile);
  }

  const { identity } = await resolveAgentIdentity(pairingManager, profileStore, credentialStore, profile);
  await runServeCommand(codexClient, relayClient, healthController, logger, identity, relayUrl, codexCommand);
}

async function runStatusCommand(
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  runtimeStore: ProductRuntimeStore,
  serviceStateStore: ProductServiceStateStore,
  relayUrl: string,
  relaySource: MacAgentRelaySource,
  codexCommand: string,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean
): Promise<void> {
  const logger = createLogger("desktop-agent");
  const profile = await loadProfileWithAuth(profileStore, credentialStore);
  const activeLocalPanelState = await runtimeStore.loadActive();
  const environmentAgentIdDetail = explicitAgentId
    ? profile
      ? `${explicitAgentId} (stable machine identity already initialized; environment override ignored)`
      : `${explicitAgentId} (will be used during the first initialization)`
    : "Not set";
  const authRelayCount = profile ? Object.keys(profile.authByRelay).length : 0;
  const activeServiceState = await serviceStateStore.loadActive();

  process.stdout.write(
    `${MAC_PRODUCT_NAME} status\n` +
      `Agent version: ${getAgentVersion()}\n` +
      `Data directory: ${getProductDataDirectory()}\n` +
      `State file: ${getProductStateFilePath()}\n` +
      `Settings file: ${getProductSettingsFilePath()}\n` +
      `Local panel state file: ${getProductConsoleStateFilePath()}\n` +
      `Service state file: ${getProductServiceStateFilePath()}\n` +
      `Log directory: ${resolveRuntimeLogDir()}\n` +
      `Relay: ${relayUrl}\n` +
      `Relay source: ${toRelaySourceLabel(relaySource)}\n` +
      `Relay connection: ${toRelayConnectionStatusLabel(activeServiceState?.status)}\n` +
      `Last relay online at: ${formatCliOptional(
        activeServiceState?.lastConnectedAt ? formatCliDateTime(activeServiceState.lastConnectedAt) : undefined,
        "Never"
      )}\n` +
      `Next reconnect at: ${formatCliOptional(
        activeServiceState?.nextRetryAt ? formatCliDateTime(activeServiceState.nextRetryAt) : undefined,
        "Not scheduled"
      )}\n` +
      `Last relay error: ${formatCliOptional(activeServiceState?.lastError, "None")}\n` +
      `Runtime command: ${codexCommand}\n` +
      `Current agentId: ${profile?.agentId ?? explicitAgentId ?? "Not initialized"}\n` +
      `Current machineId: ${profile?.machineId ?? "Not initialized"}\n` +
      `Environment AGENT_ID: ${environmentAgentIdDetail}\n` +
      `Current device name: ${profile?.deviceName ?? "Not initialized"}\n` +
      `Initial pairing shown: ${formatCliYesNo(Boolean(profile?.hasShownInitialPairing))}\n` +
      `Saved relay auth count: ${authRelayCount}\n` +
      `Current local panel: ${activeLocalPanelState?.url ?? "Not running"}\n`
  );

  if (process.platform === "darwin") {
    const serviceStatus = getLaunchAgentStatus(resolveRuntimeLogDir());
    logger.info("queried launch agent status", { ...serviceStatus });
    process.stdout.write(
      `Background service installed: ${formatCliYesNo(serviceStatus.installed)}\n` +
        `Background service loaded: ${formatCliYesNo(serviceStatus.loaded)}\n` +
        `Background service PID: ${formatCliOptional(serviceStatus.pid)}\n` +
        `Background service config: ${serviceStatus.plistPath}\n`
    );
  } else {
    process.stdout.write(
      `Background service mode: Manual\n` +
        `Background service support: Unsupported on ${describeCurrentPlatform()}\n`
    );
  }
}

async function runServiceRunCommand(
  relayClient: RelayClient,
  healthController: AgentHealthController,
  pairingManager: PairingManager,
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  relayConnectionMonitor: RelayConnectionMonitor,
  logger: ReturnType<typeof createLogger>,
  relayUrl: string,
  codexCommand: string,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean
): Promise<void> {
  logger.info("running desktop-agent in launchd service mode", {
    relayUrl,
    codexCommand,
    explicitAgentId,
    allowEnvironmentAgentIdOverride
  });
  const identity = await resolveServiceIdentityWithRetry(
    pairingManager,
    profileStore,
    credentialStore,
    relayConnectionMonitor,
    logger,
    relayUrl,
    explicitAgentId,
    allowEnvironmentAgentIdOverride
  );
  logger.info("resolved service identity", {
    agentId: identity.deviceId,
    relayBaseUrl: identity.relayBaseUrl
  });
  const codexClient = new CodexClient(codexCommand, logger, {
    onRuntimeAvailable: (detail) => {
      healthController.markRuntimeAvailable(detail);
    },
    onRuntimeUnavailable: (detail) => {
      healthController.markRuntimeUnavailable(detail);
    }
  });
  await runServeCommand(codexClient, relayClient, healthController, logger, identity, relayUrl, codexCommand);
}

function printLaunchAgentStatus(status: ReturnType<typeof getLaunchAgentStatus>): void {
  process.stdout.write(
    `${MAC_PRODUCT_NAME} background service status\n` +
      `LaunchAgent: ${status.label}\n` +
      `Installed: ${formatCliYesNo(status.installed)}\n` +
      `Loaded: ${formatCliYesNo(status.loaded)}\n` +
      `Current PID: ${formatCliOptional(status.pid)}\n` +
      `Last exit code: ${formatCliOptional(status.lastExitCode)}\n` +
      `Config file: ${status.plistPath}\n` +
      `Stdout log: ${status.stdoutPath}\n` +
      `Stderr log: ${status.stderrPath}\n`
  );
}

function printRelayServiceConnectionState(
  state: Awaited<ReturnType<ProductServiceStateStore["loadActive"]>>
): void {
  process.stdout.write(
    `Relay connection: ${toRelayConnectionStatusLabel(state?.status)}\n` +
      `Last relay online at: ${formatCliOptional(
        state?.lastConnectedAt ? formatCliDateTime(state.lastConnectedAt) : undefined,
        "Never"
      )}\n` +
      `Next reconnect at: ${formatCliOptional(
        state?.nextRetryAt ? formatCliDateTime(state.nextRetryAt) : undefined,
        "Not scheduled"
      )}\n` +
      `Last relay error: ${formatCliOptional(state?.lastError, "None")}\n`
  );
}

function checkCommandAvailability(command: string): DoctorCheck {
  const resolvedPath = resolveRuntimeCommandPath(command);
  if (resolvedPath) {
    return {
      label: "Runtime command",
      ok: true,
      detail: resolvedPath
    };
  }

  return {
    label: "Runtime command",
    ok: false,
    detail: `not found: ${command}`
  };
}

async function runDoctorCommand(
  profileStore: ProductProfileStore,
  credentialStore: AgentCredentialStore,
  runtimeStore: ProductRuntimeStore,
  serviceStateStore: ProductServiceStateStore,
  relayUrl: string,
  relaySource: MacAgentRelaySource,
  codexCommand: string,
  explicitAgentId: string | undefined,
  allowEnvironmentAgentIdOverride: boolean
): Promise<void> {
  const checks: DoctorCheck[] = [];

  try {
    const directory = await ensureProductDataDirectory();
    checks.push({
      label: "Local data directory",
      ok: true,
      detail: directory
    });
  } catch (error) {
    checks.push({
      label: "Local data directory",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  const logger = createLogger("desktop-agent");
  const profile = await loadProfileWithAuth(profileStore, credentialStore);
  const activeLocalPanelState = await runtimeStore.loadActive();
  const activeServiceState = await serviceStateStore.loadActive();
  checks.push({
    label: "Local device profile",
    ok: true,
    detail: profile
      ? `${profile.deviceName} (${profile.agentId})`
      : "Not initialized yet. It will be created automatically on first launch."
  });

  checks.push({
    label: "Local auth state",
    ok: true,
    detail: profile
      ? `${Object.keys(profile.authByRelay).length} relay auth record(s) saved`
      : "No relay credentials saved yet"
  });

  checks.push({
    label: "Environment AGENT_ID",
    ok: true,
    detail: explicitAgentId
      ? profile
        ? `${explicitAgentId} (stable machine identity already initialized; environment override ignored)`
        : `${explicitAgentId} (will be used during the first initialization)`
      : "Not set"
  });

  checks.push({
    label: "Relay source",
    ok: true,
    detail: toRelaySourceLabel(relaySource)
  });

  try {
    const parsedRelayUrl = new URL(relayUrl);
    checks.push({
      label: "Relay URL",
      ok: parsedRelayUrl.protocol === "ws:" || parsedRelayUrl.protocol === "wss:",
      detail: relayUrl
    });
  } catch (error) {
    checks.push({
      label: "Relay URL",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  checks.push(checkCommandAvailability(codexCommand));
  checks.push({
    label: "Local panel state",
    ok: true,
    detail: activeLocalPanelState ? activeLocalPanelState.url : "Not running"
  });

  checks.push({
    label: "Relay connection state",
    ok: activeServiceState?.status !== "offline",
    detail: activeServiceState
      ? `${toRelayConnectionStatusLabel(activeServiceState.status)}${
          activeServiceState.lastError ? ` (${activeServiceState.lastError})` : ""
        }`
      : "Unknown"
  });

  process.stdout.write(`${PRODUCT_NAME} diagnostics\n`);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? "[OK]" : "[FAIL]"} ${check.label}: ${check.detail}\n`);
  }

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const logger = createLogger("desktop-agent");
  const cliOptions = parseCliOptions(argv);
  const explicitAgentId = resolveExplicitAgentId();
  const allowEnvironmentAgentIdOverride = shouldAllowEnvironmentAgentIdOverride();
  const settingsStore = new ProductSettingsStore(logger);
  const runtimeStore = new ProductRuntimeStore(logger);
  const serviceStateStore = new ProductServiceStateStore(logger);
  const config = await loadMacAgentConfig({
    cliRelayUrl: cliOptions.relayUrl,
    env: process.env,
    settingsStore
  });
  const resolvedConfig = {
    ...config,
    codexCommand: resolveEffectiveCodexCommand(config.codexCommand, logger)
  };

  if (shouldPersistRelayOverride(cliOptions.command, resolvedConfig.relaySource)) {
    await settingsStore.setRelayUrlOverride(resolvedConfig.relayUrl);
    logger.info("persisted relay override for future service launches", {
      command: cliOptions.command,
      relayUrl: resolvedConfig.relayUrl,
      relaySource: resolvedConfig.relaySource
    });
  }

  const healthController = new AgentHealthController(logger);
  const codexClient = new CodexClient(resolvedConfig.codexCommand, logger, {
    onRuntimeAvailable: (detail) => {
      healthController.markRuntimeAvailable(detail);
    },
    onRuntimeUnavailable: (detail) => {
      healthController.markRuntimeUnavailable(detail);
    }
  });
  const relayClient = new RelayClient(resolvedConfig.relayUrl, logger);
  const serviceStateNotifier = new ServiceStateNotifier(logger);
  const relayConnectionMonitor = new RelayConnectionMonitor({
    logger,
    stateStore: serviceStateStore,
    notifier: serviceStateNotifier
  });
  relayClient.bindConnectionStateReporter((snapshot) => {
    relayConnectionMonitor.onStateChanged(snapshot);
  });
  const sessionMapper = new SessionMapper(logger);
  const pairingManager = new PairingManager(resolvedConfig.relayUrl, logger);
  const profileStore = new ProductProfileStore(logger);
  const credentialStore = createAgentCredentialStore(logger);
  const localPanelStateService = new LocalPanelStateService({
    logger,
    profileStore,
    credentialStore,
    settingsStore,
    runtimeStore,
    serviceStateStore,
    relayUrl: resolvedConfig.relayUrl,
    relaySource: resolvedConfig.relaySource,
    codexCommand: resolvedConfig.codexCommand
  });
  const pairingSnapshotController = new PairingSnapshotController(
    logger,
    async (relayUrl) => {
      const { profile, identity } = await resolveProfileAndIdentityForRelay(
        relayUrl,
        logger,
        profileStore,
        credentialStore,
        explicitAgentId,
        allowEnvironmentAgentIdOverride
      );

      return {
        identity,
        deviceName: profile.deviceName
      };
    },
    async (identity) => {
      const profile = await loadProfileWithAuth(profileStore, credentialStore);
      if (!profile) {
        return;
      }

      await credentialStore.persistIdentity(profileStore, profile, identity);
    }
  );
  const localPanelActions = new LocalPanelActions({
    logger,
    settingsStore,
    profileStore,
    credentialStore,
    stateService: localPanelStateService,
    snapshotController: pairingSnapshotController,
    launchAgentInstallOptions: {
      nodePath: process.execPath,
      scriptPath: resolveCurrentScriptPath(),
      codexCommand: resolvedConfig.codexCommand,
      pathEnv: process.env.PATH,
      nodeEnv: process.env.NODE_ENV,
      explicitAgentId,
      allowEnvironmentAgentIdOverride
    },
    managedServiceEnabled: isManagedServicePlatform()
  });
  const localPanelServer = new LocalPanelServer(
    localPanelStateService,
    localPanelActions,
    pairingSnapshotController,
    logger
  );

  logger.info("desktop agent skeleton initialized", {
    protocolVersion: PROTOCOL_VERSION,
    relayUrl: resolvedConfig.relayUrl,
    relaySource: resolvedConfig.relaySource,
    defaultCommand: "start"
  });

  switch (cliOptions.command) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    case "threads":
      await runThreadsCommand(codexClient, logger, parseThreadLimit(cliOptions.threadLimit));
      break;
    case "serve": {
      const loadedProfile = await loadOrCreateProfileWithAuth(profileStore, credentialStore, {
        explicitAgentId,
        allowEnvironmentOverride: allowEnvironmentAgentIdOverride
      });
      const { identity } = await resolveAgentIdentity(
        pairingManager,
        profileStore,
        credentialStore,
        loadedProfile
      );
      await runServeCommand(
        codexClient,
        relayClient,
        healthController,
        logger,
        identity,
        resolvedConfig.relayUrl,
        resolvedConfig.codexCommand
      );
      break;
    }
    case "service-run":
      await runServiceRunCommand(
        relayClient,
        healthController,
        pairingManager,
        profileStore,
        credentialStore,
        relayConnectionMonitor,
        logger,
        resolvedConfig.relayUrl,
        resolvedConfig.codexCommand,
        explicitAgentId,
        allowEnvironmentAgentIdOverride
      );
      break;
    case "pair":
      await runPairCommand(
        localPanelServer,
        profileStore,
        credentialStore,
        logger,
        resolvedConfig.relayUrl,
        resolvedConfig.relaySource,
        explicitAgentId,
        allowEnvironmentAgentIdOverride,
        cliOptions.noOpen
      );
      break;
    case "status":
      await runStatusCommand(
        profileStore,
        credentialStore,
        runtimeStore,
        serviceStateStore,
        resolvedConfig.relayUrl,
        resolvedConfig.relaySource,
        resolvedConfig.codexCommand,
        explicitAgentId,
        allowEnvironmentAgentIdOverride
      );
      break;
    case "doctor":
      await runDoctorCommand(
        profileStore,
        credentialStore,
        runtimeStore,
        serviceStateStore,
        resolvedConfig.relayUrl,
        resolvedConfig.relaySource,
        resolvedConfig.codexCommand,
        explicitAgentId,
        allowEnvironmentAgentIdOverride
      );
      break;
    case "service-install": {
      if (!isManagedServicePlatform()) {
        printManualServiceModeNotice();
        process.exitCode = 1;
        break;
      }

      installOrUpdateLaunchAgent({
        nodePath: process.execPath,
        scriptPath: resolveCurrentScriptPath(),
        codexCommand: resolvedConfig.codexCommand,
        logDir: resolveRuntimeLogDir(),
        workingDirectory: getProductDataDirectory(),
        pathEnv: process.env.PATH,
        nodeEnv: process.env.NODE_ENV,
        explicitAgentId,
        allowEnvironmentAgentIdOverride
      });
      printLaunchAgentStatus(
        startLaunchAgent(logger, resolveRuntimeLogDir(), {
          forceRestart: true
        })
      );
      printRelayServiceConnectionState(await serviceStateStore.loadActive());
      break;
    }
    case "service-status":
      if (!isManagedServicePlatform()) {
        printManualServiceModeNotice();
        break;
      }
      printLaunchAgentStatus(getLaunchAgentStatus(resolveRuntimeLogDir()));
      printRelayServiceConnectionState(await serviceStateStore.loadActive());
      break;
    case "service-stop":
      if (!isManagedServicePlatform()) {
        printManualServiceModeNotice();
        process.exitCode = 1;
        break;
      }
      stopLaunchAgent(logger);
      printLaunchAgentStatus(getLaunchAgentStatus(resolveRuntimeLogDir()));
      printRelayServiceConnectionState(await serviceStateStore.loadActive());
      break;
    case "service-remove":
      if (!isManagedServicePlatform()) {
        printManualServiceModeNotice();
        process.exitCode = 1;
        break;
      }
      printLaunchAgentStatus(uninstallLaunchAgent(logger, resolveRuntimeLogDir()));
      printRelayServiceConnectionState(await serviceStateStore.loadActive());
      break;
    case "start":
      if (isManagedServicePlatform()) {
        await runStartCommand(
          localPanelServer,
          profileStore,
          credentialStore,
          logger,
          resolvedConfig.relayUrl,
          resolvedConfig.relaySource,
          resolvedConfig.codexCommand,
          explicitAgentId,
          allowEnvironmentAgentIdOverride,
          cliOptions.showPairing,
          cliOptions.noOpen
        );
      } else {
        await runForegroundStartCommand(
          localPanelServer,
          profileStore,
          credentialStore,
          pairingManager,
          codexClient,
          relayClient,
          healthController,
          logger,
          resolvedConfig.relayUrl,
          resolvedConfig.relaySource,
          resolvedConfig.codexCommand,
          explicitAgentId,
          allowEnvironmentAgentIdOverride,
          cliOptions.noOpen
        );
      }
      break;
    default:
      logger.error("unsupported desktop-agent command", {
        command: cliOptions.command,
        supportedCommands: [
          "start",
          "pair",
          "status",
          "doctor",
          "threads",
          "serve",
          "service-install",
          "service-status",
          "service-stop",
          "service-remove"
        ]
      });
      printHelp();
      process.exitCode = 1;
  }

  void relayClient;
  void healthController;
  void sessionMapper;
}

void main().catch((error: unknown) => {
  const logger = createLogger("desktop-agent");
  logger.error("desktop agent command failed", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
