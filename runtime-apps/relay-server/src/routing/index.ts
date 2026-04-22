import type { BindingRecord, RelayStore } from "../db/index.js";

export interface RouteTarget {
  bindingId: string;
  agentId: string;
  mobileDeviceId: string;
}

export async function resolveRouteTarget(
  store: RelayStore,
  bindingId: string
): Promise<RouteTarget | undefined> {
  const binding = await store.getBinding(bindingId);
  if (!binding || binding.status !== "active") {
    return undefined;
  }

  return {
    bindingId: binding.bindingId,
    agentId: binding.agentId,
    mobileDeviceId: binding.mobileDeviceId
  };
}

export async function validateMobileBinding(
  store: RelayStore,
  mobileDeviceId: string,
  bindingId: string
): Promise<BindingRecord | undefined> {
  const binding = await store.getBinding(bindingId);
  if (!binding) {
    return undefined;
  }

  if (binding.status !== "active" || binding.mobileDeviceId !== mobileDeviceId) {
    return undefined;
  }

  return binding;
}
