import type { DeviceType } from "@kodexlink/protocol";

import type { DeviceAuthResult, DeviceBootstrapResult, RelayStore } from "../db/index.js";

export interface DeviceAuthInput {
  deviceType: DeviceType;
  deviceId: string;
  deviceToken: string;
}

export async function bootstrapDevice(
  store: RelayStore,
  input: {
    deviceType: DeviceType;
    deviceId?: string;
    deviceName: string;
    runtimeType?: string;
    nowSeconds: number;
  }
): Promise<DeviceBootstrapResult> {
  return store.bootstrapDevice(input);
}

export async function validateDeviceAuth(
  store: RelayStore,
  input: DeviceAuthInput
): Promise<DeviceAuthResult> {
  return store.validateDevice(input.deviceType, input.deviceId, input.deviceToken);
}

export async function refreshDeviceAuth(
  store: RelayStore,
  input: {
    deviceId: string;
    refreshToken: string;
    nowSeconds: number;
  }
): Promise<
  | { ok: true; device: DeviceBootstrapResult["device"]; tokens: DeviceBootstrapResult["tokens"] }
  | { ok: false; code: string; message: string }
> {
  return store.refreshDeviceTokens(input);
}

export async function revokeDeviceAuthTokens(
  store: RelayStore,
  input: {
    deviceId: string;
    revokeReason: string;
    nowSeconds: number;
  }
): Promise<number> {
  return store.revokeActiveTokensForDevice(input);
}
