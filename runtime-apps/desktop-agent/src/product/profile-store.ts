import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { Logger } from "@kodexlink/shared";

import type { AgentAuthState, AgentIdentity } from "../pairing/pairing-manager.js";
import { CLI_NAME, MAC_PRODUCT_NAME } from "./brand.js";
import { ensureProductDataDirectory, getProductStateFilePath } from "./directories.js";

interface ProductProfileRecordV1 {
  version: 1;
  agentId: string;
  deviceName: string;
  hasShownInitialPairing: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductProfileRecordV2 {
  version: 2;
  agentId: string;
  deviceName: string;
  hasShownInitialPairing: boolean;
  auth?: AgentAuthState;
  createdAt: string;
  updatedAt: string;
}

interface ProductProfileRecordV3 {
  version: 3;
  machineId: string;
  agentId: string;
  deviceName: string;
  hasShownInitialPairing: boolean;
  authByRelay?: Record<string, AgentAuthState>;
  createdAt: string;
  updatedAt: string;
}

type ProductProfileRecord = ProductProfileRecordV1 | ProductProfileRecordV2 | ProductProfileRecordV3;

export interface ProductProfile {
  machineId: string;
  agentId: string;
  deviceName: string;
  hasShownInitialPairing: boolean;
  authByRelay: Record<string, AgentAuthState>;
  stateFilePath: string;
}

export interface LoadOrCreateProfileOptions {
  explicitAgentId?: string;
  allowEnvironmentOverride?: boolean;
}

function buildDefaultDeviceName(): string {
  const rawHost = hostname().replace(/\.local$/i, "").trim();
  return rawHost.length > 0 ? rawHost : MAC_PRODUCT_NAME;
}

function normalizeAgentId(rawValue?: string): string | undefined {
  const trimmed = rawValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
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

function buildDefaultRecord(explicitAgentId?: string): ProductProfileRecordV3 {
  const now = new Date().toISOString();
  const machineId = normalizeAgentId(explicitAgentId) ?? `${CLI_NAME}-${randomUUID()}`;
  return {
    version: 3,
    machineId,
    agentId: machineId,
    deviceName: buildDefaultDeviceName(),
    hasShownInitialPairing: false,
    authByRelay: {},
    createdAt: now,
    updatedAt: now
  };
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

function migrateLegacyAuth(auth?: AgentAuthState): Record<string, AgentAuthState> {
  if (!isValidAuthState(auth)) {
    return {};
  }

  const relayBaseUrl = normalizeRelayBaseUrl(auth.relayBaseUrl);
  if (!relayBaseUrl) {
    return {};
  }

  return {
    [relayBaseUrl]: auth
  };
}

function toRecordV3(record: ProductProfileRecord): ProductProfileRecordV3 | null {
  if (
    typeof record.agentId !== "string" ||
    typeof record.deviceName !== "string" ||
    typeof record.hasShownInitialPairing !== "boolean" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }

  if (record.version === 1) {
    return {
      version: 3,
      machineId: record.agentId,
      agentId: record.agentId,
      deviceName: record.deviceName,
      hasShownInitialPairing: record.hasShownInitialPairing,
      authByRelay: {},
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  if (record.version === 2) {
    return {
      version: 3,
      machineId: record.agentId,
      agentId: record.agentId,
      deviceName: record.deviceName,
      hasShownInitialPairing: record.hasShownInitialPairing,
      authByRelay: migrateLegacyAuth(record.auth),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  const machineId = normalizeAgentId(record.machineId) ?? record.agentId;
  return {
    version: 3,
    machineId,
    agentId: normalizeAgentId(record.agentId) ?? machineId,
    deviceName: record.deviceName,
    hasShownInitialPairing: record.hasShownInitialPairing,
    authByRelay: normalizeAuthByRelay(record.authByRelay),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toProfile(record: ProductProfileRecordV3): ProductProfile {
  return {
    machineId: record.machineId,
    agentId: record.agentId,
    deviceName: record.deviceName,
    hasShownInitialPairing: record.hasShownInitialPairing,
    authByRelay: record.authByRelay ?? {},
    stateFilePath: getProductStateFilePath()
  };
}

function shouldRewriteRecord(record: ProductProfileRecord, normalized: ProductProfileRecordV3): boolean {
  if (record.version !== 3) {
    return true;
  }

  const normalizedMachineId = normalizeAgentId(record.machineId) ?? record.agentId;
  const normalizedAgentId = normalizeAgentId(record.agentId) ?? normalizedMachineId;
  if (normalizedMachineId !== normalized.machineId || normalizedAgentId !== normalized.agentId) {
    return true;
  }

  const currentAuthByRelay = normalizeAuthByRelay(record.authByRelay);
  return JSON.stringify(currentAuthByRelay) !== JSON.stringify(normalized.authByRelay ?? {});
}

export class ProductProfileStore {
  public constructor(private readonly logger: Logger) {}

  public async load(): Promise<ProductProfile | null> {
    const existing = await this.readRecord();
    return existing ? toProfile(existing) : null;
  }

  public async loadOrCreate(options: LoadOrCreateProfileOptions = {}): Promise<ProductProfile> {
    const explicitAgentId = normalizeAgentId(options.explicitAgentId);
    const existing = await this.readRecord();
    if (!existing) {
      const created = buildDefaultRecord(explicitAgentId);
      await this.writeRecord(created);
      this.logger.info("created local product profile", {
        agentId: created.agentId,
        stateFilePath: getProductStateFilePath()
      });
      return toProfile(created);
    }

    if (explicitAgentId && explicitAgentId !== existing.agentId) {
      this.logger.warn("ignored environment agent id override because stable machine identity is already initialized", {
        requestedAgentId: explicitAgentId,
        persistedAgentId: existing.agentId,
        machineId: existing.machineId,
        stateFilePath: getProductStateFilePath()
      });
      return toProfile(existing);
    }

    return toProfile(existing);
  }

  public async saveIdentity(profile: ProductProfile, identity: AgentIdentity): Promise<ProductProfile> {
    const relayBaseUrl = normalizeRelayBaseUrl(identity.relayBaseUrl);
    if (!relayBaseUrl) {
      throw new Error(`invalid relay base url: ${identity.relayBaseUrl}`);
    }

    const current = await this.readRecord();
    const now = new Date().toISOString();
    const next: ProductProfileRecordV3 = {
      version: 3,
      machineId: current?.machineId ?? profile.machineId,
      agentId: profile.agentId,
      deviceName: profile.deviceName,
      hasShownInitialPairing: profile.hasShownInitialPairing,
      authByRelay: {
        ...(current?.authByRelay ?? profile.authByRelay),
        [relayBaseUrl]: {
          deviceId: identity.deviceId,
          accessToken: identity.accessToken,
          refreshToken: identity.refreshToken,
          accessExpiresAt: identity.accessExpiresAt,
          refreshExpiresAt: identity.refreshExpiresAt,
          relayBaseUrl: identity.relayBaseUrl
        }
      },
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    await this.writeRecord(next);
    return toProfile(next);
  }

  public async clearIdentity(profile: ProductProfile): Promise<ProductProfile> {
    const current = await this.readRecord();
    const now = new Date().toISOString();
    const next: ProductProfileRecordV3 = {
      version: 3,
      machineId: current?.machineId ?? profile.machineId,
      agentId: profile.agentId,
      deviceName: profile.deviceName,
      hasShownInitialPairing: profile.hasShownInitialPairing,
      authByRelay: {},
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    await this.writeRecord(next);
    return toProfile(next);
  }

  public async resetIdentity(profile: ProductProfile): Promise<ProductProfile> {
    const current = await this.readRecord();
    const now = new Date().toISOString();
    const nextIdentity = buildDefaultRecord();
    const next: ProductProfileRecordV3 = {
      version: 3,
      machineId: nextIdentity.machineId,
      agentId: nextIdentity.agentId,
      deviceName: profile.deviceName,
      hasShownInitialPairing: false,
      authByRelay: {},
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    await this.writeRecord(next);
    return toProfile(next);
  }

  public async stripSensitiveAuth(profile: ProductProfile): Promise<ProductProfile> {
    const current = await this.readRecord();
    const now = new Date().toISOString();
    const next: ProductProfileRecordV3 = {
      version: 3,
      machineId: current?.machineId ?? profile.machineId,
      agentId: profile.agentId,
      deviceName: profile.deviceName,
      hasShownInitialPairing: profile.hasShownInitialPairing,
      authByRelay: {},
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    await this.writeRecord(next);
    return toProfile(next);
  }

  public async markInitialPairingShown(profile: ProductProfile): Promise<ProductProfile> {
    const current = await this.readRecord();
    const now = new Date().toISOString();
    const next: ProductProfileRecordV3 = {
      version: 3,
      machineId: current?.machineId ?? profile.machineId,
      agentId: profile.agentId,
      deviceName: profile.deviceName,
      hasShownInitialPairing: true,
      authByRelay: current?.authByRelay ?? profile.authByRelay,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    await this.writeRecord(next);
    return toProfile(next);
  }

  private async readRecord(): Promise<ProductProfileRecordV3 | null> {
    try {
      const raw = await readFile(getProductStateFilePath(), "utf8");
      const parsed = JSON.parse(raw) as ProductProfileRecord;
      const normalized = toRecordV3(parsed);
      if (!normalized) {
        this.logger.warn("ignoring invalid local product profile", {
          stateFilePath: getProductStateFilePath()
        });
        return null;
      }

      if (shouldRewriteRecord(parsed, normalized)) {
        await this.writeRecord(normalized);
        this.logger.info("rewrote local product profile to normalized schema", {
          version: normalized.version,
          agentId: normalized.agentId,
          machineId: normalized.machineId,
          stateFilePath: getProductStateFilePath()
        });
      }

      return normalized;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      this.logger.warn("failed to read local product profile", {
        stateFilePath: getProductStateFilePath(),
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async writeRecord(record: ProductProfileRecordV3): Promise<void> {
    await ensureProductDataDirectory();
    await writeFile(getProductStateFilePath(), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
}
