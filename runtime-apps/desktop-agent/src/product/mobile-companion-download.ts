import { generatePairingQrPngBase64 } from "../pairing/qr-image.js";
import {
  MOBILE_COMPANION_APPS,
  type MobileCompanionApp,
  type MobileCompanionPlatform
} from "./mobile-companion.js";

export interface MobileCompanionDownloadAppSnapshot extends MobileCompanionApp {
  qrPngBase64: string | null;
}

export interface MobileCompanionDownloadSnapshot {
  apps: Record<MobileCompanionPlatform, MobileCompanionDownloadAppSnapshot>;
}

let cachedSnapshotPromise: Promise<MobileCompanionDownloadSnapshot> | null = null;

async function generateQrOrNull(payload: string): Promise<string | null> {
  try {
    return await generatePairingQrPngBase64(payload);
  } catch {
    return null;
  }
}

function indexApps(
  apps: MobileCompanionDownloadAppSnapshot[]
): Record<MobileCompanionPlatform, MobileCompanionDownloadAppSnapshot> {
  return Object.fromEntries(
    apps.map((app) => [app.platform, app] as const)
  ) as Record<MobileCompanionPlatform, MobileCompanionDownloadAppSnapshot>;
}

export async function getMobileCompanionDownloadSnapshot(): Promise<MobileCompanionDownloadSnapshot> {
  if (!cachedSnapshotPromise) {
    cachedSnapshotPromise = (async () => {
      const apps = await Promise.all(
        MOBILE_COMPANION_APPS.map(async (app) => ({
          ...app,
          qrPngBase64: app.downloadUrl ? await generateQrOrNull(app.downloadUrl) : null
        }))
      );

      return {
        apps: indexApps(apps)
      };
    })();
  }

  return cachedSnapshotPromise;
}
