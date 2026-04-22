import { readFile, writeFile } from "node:fs/promises";

import {
  MacAgentSettingsSchema,
  type MacAgentSettings
} from "@kodexlink/schemas";
import type { Logger } from "@kodexlink/shared";

import { ensureProductDataDirectory, getProductSettingsFilePath } from "./directories.js";

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function defaultSettings(): MacAgentSettings {
  return {
    version: 1
  };
}

export class ProductSettingsStore {
  public constructor(private readonly logger: Logger) {}

  public async load(): Promise<MacAgentSettings> {
    try {
      const raw = await readFile(getProductSettingsFilePath(), "utf8");
      return MacAgentSettingsSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isFileNotFound(error)) {
        return defaultSettings();
      }

      this.logger.warn("failed to read local desktop-agent settings, using defaults", {
        settingsFilePath: getProductSettingsFilePath(),
        message: error instanceof Error ? error.message : String(error)
      });
      return defaultSettings();
    }
  }

  public async setRelayUrlOverride(relayUrl: string): Promise<MacAgentSettings> {
    const next = MacAgentSettingsSchema.parse({
      version: 1,
      relayUrlOverride: relayUrl,
      updatedAt: new Date().toISOString()
    });
    await this.write(next);
    return next;
  }

  public async clearRelayUrlOverride(): Promise<MacAgentSettings> {
    const next = MacAgentSettingsSchema.parse({
      version: 1,
      updatedAt: new Date().toISOString()
    });
    await this.write(next);
    return next;
  }

  private async write(settings: MacAgentSettings): Promise<void> {
    await ensureProductDataDirectory();
    await writeFile(getProductSettingsFilePath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}
