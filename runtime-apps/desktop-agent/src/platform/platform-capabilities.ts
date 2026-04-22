import { getPlatformId } from "./platform-id.js";

export interface PlatformCapabilities {
  managedService: boolean;
  desktopNotifications: boolean;
  browserOpen: boolean;
  qrPngGeneration: boolean;
  secureCredentialStore: boolean;
}

const CAPABILITIES: Record<ReturnType<typeof getPlatformId>, PlatformCapabilities> = {
  macos: {
    managedService: true,
    desktopNotifications: true,
    browserOpen: true,
    qrPngGeneration: true,
    secureCredentialStore: true
  },
  windows: {
    managedService: false,
    desktopNotifications: true,
    browserOpen: true,
    qrPngGeneration: true,
    secureCredentialStore: false
  },
  linux: {
    managedService: false,
    desktopNotifications: true,
    browserOpen: true,
    qrPngGeneration: true,
    secureCredentialStore: false
  },
  other: {
    managedService: false,
    desktopNotifications: false,
    browserOpen: false,
    qrPngGeneration: true,
    secureCredentialStore: false
  }
};

export function getPlatformCapabilities(rawPlatform: NodeJS.Platform = process.platform): PlatformCapabilities {
  return CAPABILITIES[getPlatformId(rawPlatform)];
}
