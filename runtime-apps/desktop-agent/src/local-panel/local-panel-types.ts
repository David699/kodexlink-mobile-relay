import type { MacAgentRelaySource } from "@kodexlink/schemas";

export interface LocalPanelProfileSummary {
  agentId: string;
  machineId: string;
  deviceName: string;
  hasShownInitialPairing: boolean;
  authRelayCount: number;
}

export interface LocalPanelServiceSummary {
  mode: "managed" | "manual";
  supported: boolean;
  label?: string;
  installed: boolean;
  loaded: boolean;
  pid?: number;
  lastExitCode?: number;
  plistPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
}

export interface LocalPanelRelayConnectionSummary {
  status: "connecting" | "online" | "reconnecting" | "offline" | "unknown";
  lastConnectedAt?: string;
  lastError?: string;
  nextRetryAt?: string;
  reconnectAttempt?: number;
}

export interface LocalPanelStatusResponse {
  productName: string;
  desktopProductName: string;
  agentVersion: string;
  relayUrl: string;
  relaySource: MacAgentRelaySource;
  relayUrlOverride?: string;
  dataDirectory: string;
  stateFilePath: string;
  settingsFilePath: string;
  localPanelStateFilePath: string;
  logDirectory: string;
  codexCommand: string;
  currentLocalPanelUrl?: string;
  profile: LocalPanelProfileSummary | null;
  service: LocalPanelServiceSummary;
  relayConnection: LocalPanelRelayConnectionSummary;
  updatedAt: string;
}
