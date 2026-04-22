import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { getPlatformId } from "./platform-id.js";

function commandLocator(rawPlatform: NodeJS.Platform): string {
  return getPlatformId(rawPlatform) === "windows" ? "where" : "which";
}

function looksLikeExplicitPath(command: string): boolean {
  return command.includes("/") || command.includes("\\") || path.isAbsolute(command);
}

export function resolveCommandPath(command: string, rawPlatform: NodeJS.Platform = process.platform): string | null {
  if (looksLikeExplicitPath(command)) {
    return existsSync(command) ? command : null;
  }

  const result = spawnSync(commandLocator(rawPlatform), [command], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return null;
  }

  if (getPlatformId(rawPlatform) === "windows") {
    return command;
  }

  return firstLine;
}

export function spawnCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {}
): ChildProcessWithoutNullStreams {
  const platformId = getPlatformId();
  const extension = path.extname(command).toLowerCase();

  if (platformId === "windows") {
    if (looksLikeExplicitPath(command) && extension === ".ps1") {
      return spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
        {
          ...options,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: options.windowsHide ?? true
        }
      );
    }

    const useShell = !looksLikeExplicitPath(command) || extension === ".cmd" || extension === ".bat";
    return spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
      windowsHide: options.windowsHide ?? true
    });
  }

  return spawn(command, args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"]
  });
}
