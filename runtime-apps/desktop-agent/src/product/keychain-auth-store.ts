import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Logger } from "@kodexlink/shared";

import type { AgentAuthState, AgentIdentity } from "../pairing/pairing-manager.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "com.kodexlink.desktop-agent.relay-auth";
const LEGACY_KEYCHAIN_SERVICES = ["com.kodexlink.mac-agent.relay-auth"] as const;

interface KeychainAuthRecordV1 {
  version: 1;
  authByRelay: Record<string, AgentAuthState>;
}

function normalizeRelayBaseUrl(rawValue?: string): string | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function isValidAuthState(value: unknown): value is AgentAuthState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const auth = value as Partial<AgentAuthState>;
  return (
    typeof auth.deviceId === "string" &&
    typeof auth.accessToken === "string" &&
    typeof auth.refreshToken === "string" &&
    typeof auth.accessExpiresAt === "number" &&
    Number.isFinite(auth.accessExpiresAt) &&
    typeof auth.refreshExpiresAt === "number" &&
    Number.isFinite(auth.refreshExpiresAt) &&
    typeof auth.relayBaseUrl === "string"
  );
}

function normalizeAuthByRelay(value: unknown): Record<string, AgentAuthState> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: Record<string, AgentAuthState> = {};
  for (const [rawRelayBaseUrl, rawAuth] of Object.entries(value)) {
    const relayBaseUrl = normalizeRelayBaseUrl(rawRelayBaseUrl);
    if (!relayBaseUrl || !isValidAuthState(rawAuth)) {
      continue;
    }

    result[relayBaseUrl] = rawAuth;
  }

  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isMissingKeychainItem(error: unknown): boolean {
  const message = [
    errorMessage(error),
    typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : ""
  ]
    .join(" ")
    .toLowerCase();
  return message.includes("could not be found") || message.includes("specified item could not be found");
}

export class KeychainAuthStore {
  public constructor(private readonly logger: Logger) {}

  public async load(agentId: string): Promise<Record<string, AgentAuthState>> {
    if (process.platform !== "darwin") {
      return {};
    }

    const record = await this.readRecord(agentId);
    if (!record) {
      return {};
    }

    try {
      const parsed = JSON.parse(record.raw) as unknown;
      if (parsed && typeof parsed === "object" && "version" in parsed && parsed.version === 1) {
        const parsedRecord = parsed as Partial<KeychainAuthRecordV1>;
        const normalized = normalizeAuthByRelay(parsedRecord.authByRelay);
        await this.migrateLegacyRecord(agentId, record.service, normalized);
        return normalized;
      }
      const normalized = normalizeAuthByRelay(parsed);
      await this.migrateLegacyRecord(agentId, record.service, normalized);
      return normalized;
    } catch (error) {
      this.logger.warn("failed to parse keychain relay auth payload", {
        agentId,
        service: record.service,
        message: errorMessage(error)
      });
      return {};
    }
  }

  public async save(agentId: string, authByRelay: Record<string, AgentAuthState>): Promise<void> {
    if (process.platform !== "darwin") {
      return;
    }

    const normalized = normalizeAuthByRelay(authByRelay);
    if (Object.keys(normalized).length === 0) {
      await this.clear(agentId);
      return;
    }

    const payload: KeychainAuthRecordV1 = {
      version: 1,
      authByRelay: normalized
    };
    await this.runSecurity(
      [
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        agentId,
        "-w",
        JSON.stringify(payload)
      ],
      `Failed to write Keychain credentials (agentId=${agentId})`
    );
    await this.clearLegacy(agentId);
  }

  public async saveIdentity(agentId: string, identity: AgentIdentity): Promise<Record<string, AgentAuthState>> {
    const relayBaseUrl = normalizeRelayBaseUrl(identity.relayBaseUrl);
    if (!relayBaseUrl) {
      throw new Error(`invalid relay base url: ${identity.relayBaseUrl}`);
    }

    const next = await this.load(agentId);
    next[relayBaseUrl] = {
      deviceId: identity.deviceId,
      accessToken: identity.accessToken,
      refreshToken: identity.refreshToken,
      accessExpiresAt: identity.accessExpiresAt,
      refreshExpiresAt: identity.refreshExpiresAt,
      relayBaseUrl: identity.relayBaseUrl
    };
    await this.save(agentId, next);
    return next;
  }

  public async clear(agentId: string): Promise<void> {
    if (process.platform !== "darwin") {
      return;
    }

    for (const service of [KEYCHAIN_SERVICE, ...LEGACY_KEYCHAIN_SERVICES]) {
      await this.deleteRaw(agentId, service);
    }
  }

  private async readRecord(agentId: string): Promise<{ service: string; raw: string } | null> {
    for (const service of [KEYCHAIN_SERVICE, ...LEGACY_KEYCHAIN_SERVICES]) {
      const raw = await this.readRaw(agentId, service);
      if (raw) {
        return {
          service,
          raw
        };
      }
    }

    return null;
  }

  private async readRaw(agentId: string, service: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        service,
        "-a",
        agentId,
        "-w"
      ]);
      return stdout.trimEnd();
    } catch (error) {
      if (isMissingKeychainItem(error)) {
        return null;
      }
      throw new Error(`Failed to read Keychain credentials (agentId=${agentId}, service=${service}): ${errorMessage(error)}`);
    }
  }

  private async deleteRaw(agentId: string, service: string): Promise<void> {
    try {
      await execFileAsync("security", [
        "delete-generic-password",
        "-s",
        service,
        "-a",
        agentId
      ]);
    } catch (error) {
      if (isMissingKeychainItem(error)) {
        return;
      }
      throw new Error(`Failed to delete Keychain credentials (agentId=${agentId}, service=${service}): ${errorMessage(error)}`);
    }
  }

  private async clearLegacy(agentId: string): Promise<void> {
    for (const service of LEGACY_KEYCHAIN_SERVICES) {
      await this.deleteRaw(agentId, service);
    }
  }

  private async migrateLegacyRecord(
    agentId: string,
    service: string,
    authByRelay: Record<string, AgentAuthState>
  ): Promise<void> {
    if (service === KEYCHAIN_SERVICE || Object.keys(authByRelay).length === 0) {
      return;
    }

    await this.save(agentId, authByRelay);
    this.logger.info("migrated relay auth from legacy keychain service", {
      agentId,
      fromService: service,
      toService: KEYCHAIN_SERVICE
    });
  }

  private async runSecurity(args: string[], failureMessage: string): Promise<void> {
    try {
      await execFileAsync("security", args);
    } catch (error) {
      throw new Error(`${failureMessage}: ${errorMessage(error)}`);
    }
  }
}
