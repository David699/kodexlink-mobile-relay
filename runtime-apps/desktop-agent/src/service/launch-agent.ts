import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Logger } from "@kodexlink/shared";

import { CLI_NAME } from "../product/brand.js";
import { syncLaunchAgentArtifacts } from "./launch-agent-artifacts.js";

const LAUNCH_AGENT_LABEL = "com.kodexlink.desktop-agent";
const LEGACY_LAUNCH_AGENT_LABELS = ["com.kodexlink.mac-agent"] as const;
const DEFAULT_STDOUT_LOG_NAME = "desktop-agent.launchd.stdout.log";
const DEFAULT_STDERR_LOG_NAME = "desktop-agent.launchd.stderr.log";

interface LaunchctlResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface LaunchAgentRuntimeStatus {
  loaded: boolean;
  pid?: number;
  pidActive: boolean;
  state?: string;
  lastExitCode?: number;
  lastExitReason?: string;
}

export interface LaunchAgentInstallOptions {
  nodePath: string;
  scriptPath: string;
  codexCommand: string;
  logDir: string;
  workingDirectory: string;
  pathEnv?: string;
  nodeEnv?: string;
  explicitAgentId?: string;
  allowEnvironmentAgentIdOverride?: boolean;
}

export interface LaunchAgentStatus {
  label: string;
  plistPath: string;
  stdoutPath: string;
  stderrPath: string;
  installed: boolean;
  loaded: boolean;
  pid?: number;
  lastExitCode?: number;
}

export interface LaunchAgentInstallResult extends LaunchAgentStatus {
  changed: boolean;
  plistChanged: boolean;
  wrapperChanged: boolean;
  environmentChanged: boolean;
}

export interface LaunchAgentStartOptions {
  forceRestart?: boolean;
}

export interface LaunchAgentStartResult extends LaunchAgentStatus {
  action: "started" | "restarted" | "running";
}

function ensureDarwin(): void {
  if (process.platform !== "darwin") {
    throw new Error(`${CLI_NAME} background service management is currently only supported on macOS`);
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function launchAgentDirectory(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

function launchAgentPlistPathFor(label: string): string {
  return join(launchAgentDirectory(), `${label}.plist`);
}

function launchAgentPlistPath(): string {
  return launchAgentPlistPathFor(LAUNCH_AGENT_LABEL);
}

function launchAgentDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    throw new Error("the current environment does not support resolving the launchd user domain");
  }
  return `gui/${uid}`;
}

function stdoutLogPath(logDir: string): string {
  return join(logDir, DEFAULT_STDOUT_LOG_NAME);
}

function stderrLogPath(logDir: string): string {
  return join(logDir, DEFAULT_STDERR_LOG_NAME);
}

function launchAgentTarget(label: string): string {
  return `${launchAgentDomain()}/${label}`;
}

function renderStringEntry(key: string, value: string): string {
  return `  <key>${xmlEscape(key)}</key>\n  <string>${xmlEscape(value)}</string>`;
}

function renderBooleanEntry(key: string, value: boolean): string {
  return `  <key>${xmlEscape(key)}</key>\n  <${value ? "true" : "false"}/>`;
}

function renderArrayEntry(key: string, values: string[]): string {
  const items = values.map((value) => `    <string>${xmlEscape(value)}</string>`).join("\n");
  return `  <key>${xmlEscape(key)}</key>\n  <array>\n${items}\n  </array>`;
}

function buildLaunchAgentPlist(
  wrapperPath: string,
  options: Pick<LaunchAgentInstallOptions, "logDir" | "workingDirectory">
): string {
  const argumentsList = [wrapperPath];
  const plistEntries = [
    renderStringEntry("Label", LAUNCH_AGENT_LABEL),
    renderArrayEntry("ProgramArguments", argumentsList),
    renderStringEntry("WorkingDirectory", options.workingDirectory),
    renderBooleanEntry("RunAtLoad", true),
    renderBooleanEntry("KeepAlive", true),
    renderStringEntry("StandardOutPath", stdoutLogPath(options.logDir)),
    renderStringEntry("StandardErrorPath", stderrLogPath(options.logDir))
  ].join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    plistEntries,
    `</dict>`,
    `</plist>`,
    ``
  ].join("\n");
}

function writeFileIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath) && readFileSync(filePath, "utf8") === content) {
    return false;
  }

  writeFileSync(filePath, content, "utf8");
  return true;
}

function runLaunchctl(args: string[]): LaunchctlResult {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8"
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function parsePid(output: string): number | undefined {
  const matched = output.match(/pid = (\d+)/);
  if (!matched) {
    return undefined;
  }

  const value = Number.parseInt(matched[1] ?? "", 10);
  return Number.isFinite(value) ? value : undefined;
}

function parseLastExitCode(output: string): number | undefined {
  const matched = output.match(/last exit code = (\d+)/);
  if (!matched) {
    return undefined;
  }

  const value = Number.parseInt(matched[1] ?? "", 10);
  return Number.isFinite(value) ? value : undefined;
}

function parseState(output: string): string | undefined {
  const matched = output.match(/state = (.+)/);
  return matched?.[1]?.trim();
}

function parseLastExitReason(output: string): string | undefined {
  const matched = output.match(/last exit reason = (.+)/);
  return matched?.[1]?.trim();
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

function readLaunchAgentRuntimeStatus(): LaunchAgentRuntimeStatus {
  const labelTarget = launchAgentTarget(LAUNCH_AGENT_LABEL);
  const printResult = runLaunchctl(["print", labelTarget]);
  const pid = printResult.status === 0 ? parsePid(printResult.stdout) : undefined;
  const pidActive = pid !== undefined ? isProcessRunning(pid) : false;

  return {
    loaded: printResult.status === 0,
    pid,
    pidActive,
    state: printResult.status === 0 ? parseState(printResult.stdout) : undefined,
    lastExitCode: printResult.status === 0 ? parseLastExitCode(printResult.stdout) : undefined,
    lastExitReason: printResult.status === 0 ? parseLastExitReason(printResult.stdout) : undefined
  };
}

function isIgnorableBootoutError(message: string | undefined): boolean {
  if (!message) {
    return true;
  }

  return message.includes("Could not find service") || message.includes("No such process");
}

function bootoutLaunchAgent(label: string, plistPath: string): { stopped: boolean; error?: string } {
  const domain = launchAgentDomain();
  const labelTarget = launchAgentTarget(label);
  const bootoutResult = runLaunchctl(["bootout", labelTarget]);

  if (bootoutResult.status === 0) {
    return {
      stopped: true
    };
  }

  const plistBootoutResult = runLaunchctl(["bootout", domain, plistPath]);
  if (plistBootoutResult.status === 0) {
    return {
      stopped: true
    };
  }

  const errorText = [bootoutResult.stderr, plistBootoutResult.stderr]
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  if (isIgnorableBootoutError(errorText)) {
    return {
      stopped: false
    };
  }

  return {
    stopped: false,
    error: errorText
  };
}

function cleanupLegacyLaunchAgents(logger?: Logger): void {
  for (const legacyLabel of LEGACY_LAUNCH_AGENT_LABELS) {
    const legacyPlistPath = launchAgentPlistPathFor(legacyLabel);
    const stopResult = bootoutLaunchAgent(legacyLabel, legacyPlistPath);
    if (stopResult.error) {
      throw new Error(`Failed to stop legacy LaunchAgent (${legacyLabel}): ${stopResult.error}`);
    }

    if (stopResult.stopped) {
      logger?.info("legacy launch agent stopped", {
        label: legacyLabel
      });
    }

    if (existsSync(legacyPlistPath)) {
      unlinkSync(legacyPlistPath);
      logger?.info("legacy launch agent plist removed", {
        label: legacyLabel,
        plistPath: legacyPlistPath
      });
    }
  }
}

export function installOrUpdateLaunchAgent(
  options: LaunchAgentInstallOptions
): LaunchAgentInstallResult {
  ensureDarwin();

  mkdirSync(launchAgentDirectory(), { recursive: true });
  mkdirSync(options.logDir, { recursive: true });
  mkdirSync(options.workingDirectory, { recursive: true });
  cleanupLegacyLaunchAgents();

  const artifactResult = syncLaunchAgentArtifacts(options);
  const plistPath = launchAgentPlistPath();
  const plistChanged = writeFileIfChanged(
    plistPath,
    buildLaunchAgentPlist(artifactResult.wrapperPath, options)
  );

  return {
    ...getLaunchAgentStatus(options.logDir),
    changed: plistChanged || artifactResult.wrapperChanged || artifactResult.environmentChanged,
    plistChanged,
    wrapperChanged: artifactResult.wrapperChanged,
    environmentChanged: artifactResult.environmentChanged
  };
}

export function startLaunchAgent(
  logger: Logger,
  logDir: string,
  options: LaunchAgentStartOptions = {}
): LaunchAgentStartResult {
  ensureDarwin();
  cleanupLegacyLaunchAgents(logger);

  const plistPath = launchAgentPlistPath();
  if (!existsSync(plistPath)) {
    throw new Error(`LaunchAgent config not found: ${plistPath}`);
  }

  const domain = launchAgentDomain();
  const labelTarget = launchAgentTarget(LAUNCH_AGENT_LABEL);
  const currentStatus = readLaunchAgentRuntimeStatus();
  const canTreatAsRunning = currentStatus.loaded && currentStatus.pidActive;

  if (canTreatAsRunning) {
    if (!options.forceRestart) {
      logger.info("launch agent already running", {
        label: LAUNCH_AGENT_LABEL,
        pid: currentStatus.pid
      });
      return {
        ...getLaunchAgentStatus(logDir),
        action: "running"
      };
    }

    const kickstartResult = runLaunchctl(["kickstart", "-k", labelTarget]);
    if (kickstartResult.status !== 0) {
      throw new Error(
        `Failed to restart LaunchAgent: ${kickstartResult.stderr.trim() || kickstartResult.stdout.trim() || "unknown error"}`
      );
    }
    logger.info("launch agent restarted", {
      label: LAUNCH_AGENT_LABEL
    });
    return {
      ...getLaunchAgentStatus(logDir),
      action: "restarted"
    };
  }

  if (currentStatus.loaded) {
    logger.warn("launch agent status is stale; recreating launch agent", {
      label: LAUNCH_AGENT_LABEL,
      pid: currentStatus.pid,
      pidActive: currentStatus.pidActive,
      state: currentStatus.state,
      lastExitCode: currentStatus.lastExitCode,
      lastExitReason: currentStatus.lastExitReason
    });
    const stopResult = bootoutLaunchAgent(LAUNCH_AGENT_LABEL, plistPath);
    if (stopResult.error) {
      throw new Error(`Failed to reset stale LaunchAgent: ${stopResult.error}`);
    }
  }

  const bootstrapResult = runLaunchctl(["bootstrap", domain, plistPath]);
  if (bootstrapResult.status !== 0) {
    throw new Error(
      `Failed to start LaunchAgent: ${bootstrapResult.stderr.trim() || bootstrapResult.stdout.trim() || "unknown error"}`
    );
  }

  logger.info("launch agent bootstrapped", {
    label: LAUNCH_AGENT_LABEL,
    plistPath
  });
  return {
    ...getLaunchAgentStatus(logDir),
    action: "started"
  };
}

export function stopLaunchAgent(logger: Logger): void {
  ensureDarwin();

  const plistPath = launchAgentPlistPath();
  const stopResult = bootoutLaunchAgent(LAUNCH_AGENT_LABEL, plistPath);
  if (stopResult.error) {
    throw new Error(`Failed to stop LaunchAgent: ${stopResult.error}`);
  }
  if (stopResult.stopped) {
    logger.info("launch agent stopped", {
      label: LAUNCH_AGENT_LABEL
    });
  }
  cleanupLegacyLaunchAgents(logger);
}

export function uninstallLaunchAgent(logger: Logger, logDir: string): LaunchAgentStatus {
  ensureDarwin();

  stopLaunchAgent(logger);
  const plistPath = launchAgentPlistPath();
  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }

  return getLaunchAgentStatus(logDir);
}

export function getLaunchAgentStatus(logDir: string): LaunchAgentStatus {
  ensureDarwin();

  const plistPath = launchAgentPlistPath();
  const status = readLaunchAgentRuntimeStatus();

  return {
    label: LAUNCH_AGENT_LABEL,
    plistPath,
    stdoutPath: stdoutLogPath(logDir),
    stderrPath: stderrLogPath(logDir),
    installed: existsSync(plistPath),
    loaded: status.loaded && status.pidActive,
    pid: status.pidActive ? status.pid : undefined,
    lastExitCode: status.lastExitCode
  };
}
