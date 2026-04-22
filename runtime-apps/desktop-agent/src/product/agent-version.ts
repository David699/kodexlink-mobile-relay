import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UNKNOWN_AGENT_VERSION = "unknown";

let cachedAgentVersion: string | null = null;

function readVersionFromPackageJson(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : null;
  } catch {
    return null;
  }
}

export function getAgentVersion(): string {
  if (cachedAgentVersion) {
    return cachedAgentVersion;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonCandidates = [
    path.resolve(currentDir, "package.json"),
    path.resolve(currentDir, "../package.json"),
    path.resolve(currentDir, "../../package.json"),
    path.resolve(currentDir, "../../../package.json")
  ];

  for (const packageJsonPath of packageJsonCandidates) {
    const version = readVersionFromPackageJson(packageJsonPath);
    if (version) {
      cachedAgentVersion = version;
      return version;
    }
  }

  cachedAgentVersion = UNKNOWN_AGENT_VERSION;
  return cachedAgentVersion;
}
