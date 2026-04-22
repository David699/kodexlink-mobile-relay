import type { Logger } from "@kodexlink/shared";

import { DESKTOP_AGENT_PRODUCT_NAME, PRODUCT_NAME } from "../product/brand.js";
import { normalizePairingExpiresAt } from "./pairing-expiry.js";
import { generatePairingQrPngBase64 } from "./qr-image.js";
import { PairingManager, type AgentIdentity } from "./pairing-manager.js";

export interface PairingSnapshot {
  productName: string;
  desktopProductName: string;
  deviceName: string;
  relayUrl: string;
  agentLabel: string;
  expiresAt: number;
  payloadRaw: string;
  qrPngBase64: string;
}

export interface PairingSnapshotContext {
  identity: AgentIdentity;
  deviceName: string;
}

export class PairingSnapshotController {
  private snapshot: PairingSnapshot | null = null;
  private snapshotRelayUrl: string | null = null;

  public constructor(
    private readonly logger: Logger,
    private readonly resolveContext: (relayUrl: string) => Promise<PairingSnapshotContext>,
    private readonly persistIdentity?: (identity: AgentIdentity) => Promise<void>
  ) {}

  public invalidate(): void {
    this.snapshot = null;
    this.snapshotRelayUrl = null;
  }

  public async getCurrentSnapshot(relayUrl: string): Promise<PairingSnapshot> {
    if (this.snapshot && this.snapshotRelayUrl === relayUrl) {
      return this.snapshot;
    }

    return this.refreshSnapshot(relayUrl);
  }

  public async refreshSnapshot(relayUrl: string): Promise<PairingSnapshot> {
    const context = await this.resolveContext(relayUrl);
    const pairingManager = new PairingManager(relayUrl, this.logger);
    const pairingPayload = await pairingManager.createPairingSession(
      context.identity,
      context.deviceName
    );
    const payloadRaw = JSON.stringify(pairingPayload);
    const qrPngBase64 = await generatePairingQrPngBase64(payloadRaw);

    if (this.persistIdentity) {
      await this.persistIdentity(context.identity);
    }

    this.snapshot = {
      productName: PRODUCT_NAME,
      desktopProductName: DESKTOP_AGENT_PRODUCT_NAME,
      deviceName: context.deviceName,
      relayUrl: pairingPayload.relayUrl,
      agentLabel: pairingPayload.agentLabel,
      expiresAt: normalizePairingExpiresAt(pairingPayload.expiresAt),
      payloadRaw,
      qrPngBase64
    };
    this.snapshotRelayUrl = relayUrl;

    this.logger.info("console pairing snapshot refreshed", {
      agentLabel: pairingPayload.agentLabel,
      relayUrl,
      expiresAt: pairingPayload.expiresAt
    });

    return this.snapshot;
  }
}
