export const MOBILE_COMPANION_SCAN_NOTICE =
  "This pairing QR code must be scanned from the KodexLink iPhone/Android app.";

export type MobileCompanionPlatform = "ios" | "android";

export interface MobileCompanionApp {
  platform: MobileCompanionPlatform;
  packageName?: string;
  downloadUrl: string | null;
}

const IOS_APP_STORE_URL = "https://apps.apple.com/us/app/kodexlink-codex-mobile-chat/id6761055159?uo=4";
const ANDROID_PACKAGE_NAME = "com.kodexlink.android";
const ANDROID_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`;

export const MOBILE_COMPANION_APPS: readonly MobileCompanionApp[] = [
  {
    platform: "ios",
    downloadUrl: IOS_APP_STORE_URL
  },
  {
    platform: "android",
    packageName: ANDROID_PACKAGE_NAME,
    downloadUrl: ANDROID_PLAY_STORE_URL
  }
];

export function getMobileCompanionApp(platform: MobileCompanionPlatform): MobileCompanionApp {
  const app = MOBILE_COMPANION_APPS.find((entry) => entry.platform === platform);
  if (!app) {
    throw new Error(`Missing mobile companion app config for platform: ${platform}`);
  }

  return app;
}
