import { readFile, unlink, writeFile } from "node:fs/promises";

import {
  MacAgentServiceStateSchema,
  type MacAgentServiceConnectionStatus,
  type MacAgentServiceState
} from "@kodexlink/schemas";
import type { Logger } from "@kodexlink/shared";

import { ensureProductDataDirectory, getProductServiceStateFilePath } from "./directories.js";

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

export interface ServiceStateUpdateInput {
  relayUrl: string;
  status: MacAgentServiceConnectionStatus;
  lastConnectedAt?: string;
  lastError?: string;
  nextRetryAt?: string;
  reconnectAttempt?: number;
}

export class ProductServiceStateStore {
  public constructor(private readonly logger: Logger) {}

  public async load(): Promise<MacAgentServiceState | null> {
    try {
      const raw = await readFile(getProductServiceStateFilePath(), "utf8");
      return MacAgentServiceStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }

      this.logger.warn("failed to read desktop-agent service state", {
        serviceStateFilePath: getProductServiceStateFilePath(),
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  public async loadActive(): Promise<MacAgentServiceState | null> {
    const state = await this.load();
    if (!state) {
      return null;
    }

    if (isProcessRunning(state.pid)) {
      return state;
    }

    await this.clear();
    return null;
  }

  public async write(input: ServiceStateUpdateInput): Promise<MacAgentServiceState> {
    const current = await this.load();
    const now = new Date().toISOString();
    const next = MacAgentServiceStateSchema.parse({
      version: 1,
      pid: process.pid,
      relayUrl: input.relayUrl,
      status: input.status,
      startedAt: current?.pid === process.pid ? current.startedAt : now,
      updatedAt: now,
      lastConnectedAt:
        input.lastConnectedAt ??
        (input.status === "online" ? now : current?.lastConnectedAt),
      lastError: input.lastError,
      nextRetryAt: input.nextRetryAt,
      reconnectAttempt: input.reconnectAttempt
    });

    await ensureProductDataDirectory();
    await writeFile(getProductServiceStateFilePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  public async clear(): Promise<void> {
    try {
      await unlink(getProductServiceStateFilePath());
    } catch (error) {
      if (isFileNotFound(error)) {
        return;
      }

      this.logger.warn("failed to clear desktop-agent service state", {
        serviceStateFilePath: getProductServiceStateFilePath(),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
