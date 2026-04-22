export type PlatformId = "macos" | "windows" | "linux" | "other";

export function getPlatformId(rawPlatform: NodeJS.Platform = process.platform): PlatformId {
  switch (rawPlatform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "other";
  }
}

export function isManagedServicePlatform(rawPlatform: NodeJS.Platform = process.platform): boolean {
  return getPlatformId(rawPlatform) === "macos";
}
