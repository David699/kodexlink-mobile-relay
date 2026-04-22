export interface RelayMetricsSnapshot {
  activeConnections: number;
  queuedMessages: number;
}

export function createEmptyMetrics(): RelayMetricsSnapshot {
  return {
    activeConnections: 0,
    queuedMessages: 0
  };
}

