import { getPlatformCapabilities } from "../platform-capabilities.js";
import { getPlatformId } from "../platform-id.js";
import type { DesktopNotifier } from "./desktop-notifier.js";
import { MacOSDesktopNotifier } from "./desktop-notifier-macos.js";
import { NodeDesktopNotifier } from "./desktop-notifier-node.js";

class NoopDesktopNotifier implements DesktopNotifier {
  public async notify(): Promise<void> {}
}

export function createDesktopNotifier(rawPlatform: NodeJS.Platform = process.platform): DesktopNotifier {
  const capabilities = getPlatformCapabilities(rawPlatform);
  if (!capabilities.desktopNotifications) {
    return new NoopDesktopNotifier();
  }

  if (getPlatformId(rawPlatform) === "macos") {
    return new MacOSDesktopNotifier();
  }

  return new NodeDesktopNotifier();
}
