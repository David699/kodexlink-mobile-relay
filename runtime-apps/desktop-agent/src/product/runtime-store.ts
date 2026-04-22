import { readFile, unlink, writeFile } from "node:fs/promises";

import {
  MacAgentConsoleStateSchema,
  type MacAgentConsoleState,
  type MacAgentRelaySource
} from "@kodexlink/schemas";
import type { Logger } from "@kodexlink/shared";

import { ensureProductDataDirectory, getProductConsoleStateFilePath } from "./directories.js";

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

export class ProductRuntimeStore {
  public constructor(private readonly logger: Logger) {}

  public async load(): Promise<MacAgentConsoleState | null> {
    try {
      const raw = await readFile(getProductConsoleStateFilePath(), "utf8");
      return MacAgentConsoleStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return null;
      }

      this.logger.warn("failed to read local desktop-agent console state", {
        consoleStateFilePath: getProductConsoleStateFilePath(),
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  public async loadActive(): Promise<MacAgentConsoleState | null> {
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

  public async writeConsoleState(input: {
    url: string;
    relayUrl: string;
    relaySource: MacAgentRelaySource;
  }): Promise<MacAgentConsoleState> {
    const port = Number.parseInt(new URL(input.url).port, 10);
    const now = new Date().toISOString();
    const state = MacAgentConsoleStateSchema.parse({
      version: 1,
      url: input.url,
      port,
      pid: process.pid,
      relayUrl: input.relayUrl,
      relaySource: input.relaySource,
      startedAt: now,
      lastHeartbeatAt: now
    });

    await ensureProductDataDirectory();
    await writeFile(getProductConsoleStateFilePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }

  public async touchHeartbeat(): Promise<MacAgentConsoleState | null> {
    const current = await this.load();
    if (!current) {
      return null;
    }

    if (current.pid !== process.pid) {
      return current;
    }

    const next = MacAgentConsoleStateSchema.parse({
      ...current,
      lastHeartbeatAt: new Date().toISOString()
    });

    await ensureProductDataDirectory();
    await writeFile(getProductConsoleStateFilePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  public async clear(): Promise<void> {
    try {
      await unlink(getProductConsoleStateFilePath());
    } catch (error) {
      if (isFileNotFound(error)) {
        return;
      }

      this.logger.warn("failed to clear local desktop-agent console state", {
        consoleStateFilePath: getProductConsoleStateFilePath(),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
