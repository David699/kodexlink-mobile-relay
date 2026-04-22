import type { BindingRecord, PairingSessionRecord, RelayStore } from "../db/index.js";

export interface PairingPayload {
  v: 1;
  relayUrl: string;
  pairingId: string;
  pairingSecret: string;
  agentLabel: string;
  expiresAt: number;
}

export async function createPairingSession(
  store: RelayStore,
  input: {
    agentId: string;
    agentLabel: string;
    relayBaseUrl: string;
    nowSeconds: number;
  }
): Promise<{ pairing: PairingSessionRecord; payload: PairingPayload }> {
  const pairing = await store.createPairing(input);

  return {
    pairing,
    payload: {
      v: 1,
      relayUrl: pairing.relayBaseUrl,
      pairingId: pairing.pairingId,
      pairingSecret: pairing.pairingSecret,
      agentLabel: pairing.agentLabel,
      expiresAt: pairing.expiresAt
    }
  };
}

export async function claimPairingSession(
  store: RelayStore,
  input: {
    pairingId: string;
    pairingSecret: string;
    mobileDeviceId: string;
    displayName: string;
    nowSeconds: number;
  }
): Promise<{ pairing: PairingSessionRecord; binding: BindingRecord } | null> {
  return store.claimPairing(input);
}
