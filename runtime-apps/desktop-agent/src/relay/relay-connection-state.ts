import type { MacAgentServiceConnectionStatus } from "@kodexlink/schemas";

export interface RelayConnectionStateSnapshot {
  relayUrl: string;
  status: MacAgentServiceConnectionStatus;
  lastError?: string;
  lastConnectedAt?: string;
  nextRetryAt?: string;
  reconnectAttempt?: number;
}

export type RelayConnectionStateReporter = (snapshot: RelayConnectionStateSnapshot) => void;
