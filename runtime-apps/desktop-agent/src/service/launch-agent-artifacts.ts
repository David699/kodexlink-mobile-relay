import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  getProductLaunchAgentEnvironmentFilePath,
  getProductLaunchAgentWrapperPath
} from "../product/directories.js";

export interface LaunchAgentArtifactOptions {
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

export interface LaunchAgentArtifactSyncResult {
  wrapperPath: string;
  environmentPath: string;
  wrapperChanged: boolean;
  environmentChanged: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function writeFileIfChanged(filePath: string, content: string): boolean {
  mkdirSync(dirname(filePath), { recursive: true });

  if (existsSync(filePath) && readFileSync(filePath, "utf8") === content) {
    return false;
  }

  writeFileSync(filePath, content, "utf8");
  return true;
}

function buildLaunchAgentEnvironment(options: LaunchAgentArtifactOptions): string {
  const entries: Array<[string, string]> = [
    ["NODE_PATH", options.nodePath],
    ["SCRIPT_PATH", options.scriptPath],
    ["WORKING_DIRECTORY", options.workingDirectory],
    ["CODEX_COMMAND", options.codexCommand],
    ["CODEX_MOBILE_LOG_DIR", options.logDir]
  ];

  if (options.pathEnv && options.pathEnv.length > 0) {
    entries.push(["PATH", options.pathEnv]);
  }
  if (options.nodeEnv && options.nodeEnv.length > 0) {
    entries.push(["NODE_ENV", options.nodeEnv]);
  }
  if (options.explicitAgentId && options.explicitAgentId.length > 0) {
    entries.push(["AGENT_ID", options.explicitAgentId]);
  }
  if (options.allowEnvironmentAgentIdOverride) {
    entries.push(["KODEXLINK_ALLOW_AGENT_ID_OVERRIDE", "1"]);
  }

  const variableLines = entries.map(([key, value]) => `${key}=${shellQuote(value)}`);
  const exportLine = `export ${entries.map(([key]) => key).join(" ")}`;

  return `${variableLines.join("\n")}\n${exportLine}\n`;
}

function buildLaunchAgentWrapperScript(environmentPath: string): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    `. ${shellQuote(environmentPath)}`,
    'cd "$WORKING_DIRECTORY"',
    'exec "$NODE_PATH" "$SCRIPT_PATH" service-run',
    ""
  ].join("\n");
}

export function syncLaunchAgentArtifacts(
  options: LaunchAgentArtifactOptions
): LaunchAgentArtifactSyncResult {
  const wrapperPath = getProductLaunchAgentWrapperPath();
  const environmentPath = getProductLaunchAgentEnvironmentFilePath();
  const environmentChanged = writeFileIfChanged(
    environmentPath,
    buildLaunchAgentEnvironment(options)
  );
  const wrapperChanged = writeFileIfChanged(
    wrapperPath,
    buildLaunchAgentWrapperScript(environmentPath)
  );

  chmodSync(environmentPath, 0o600);
  chmodSync(wrapperPath, 0o755);

  return {
    wrapperPath,
    environmentPath,
    wrapperChanged,
    environmentChanged
  };
}
