import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { APP_SUPPORT_DIRECTORY_NAME } from "./brand.js";

export function getProductDataDirectory(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_SUPPORT_DIRECTORY_NAME);
  }

  return join(homedir(), `.${APP_SUPPORT_DIRECTORY_NAME.toLowerCase()}`);
}

export function getProductStateFilePath(): string {
  return join(getProductDataDirectory(), "state.json");
}

export function getProductSettingsFilePath(): string {
  return join(getProductDataDirectory(), "settings.json");
}

export function getProductConsoleStateFilePath(): string {
  return join(getProductDataDirectory(), "console-state.json");
}

export function getProductServiceStateFilePath(): string {
  return join(getProductDataDirectory(), "service-state.json");
}

export function getProductServiceDirectory(): string {
  return join(getProductDataDirectory(), "service");
}

export function getProductLaunchAgentWrapperPath(): string {
  return join(getProductServiceDirectory(), "launch-agent.sh");
}

export function getProductLaunchAgentEnvironmentFilePath(): string {
  return join(getProductServiceDirectory(), "launch-agent.env");
}

export function getProductLogDirectoryPath(): string {
  return join(getProductDataDirectory(), "logs");
}

export async function ensureProductDataDirectory(): Promise<string> {
  const directory = getProductDataDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}
