import type { MacAgentRelaySource } from "@kodexlink/schemas";
import type { Logger } from "@kodexlink/shared";

import type { AgentCredentialStore } from "../product/agent-credential-store.js";
import { DESKTOP_AGENT_PRODUCT_NAME, PRODUCT_NAME } from "../product/brand.js";
import {
  getProductConsoleStateFilePath,
  getProductDataDirectory,
  getProductLogDirectoryPath,
  getProductSettingsFilePath,
  getProductStateFilePath
} from "../product/directories.js";
import { getAgentVersion } from "../product/agent-version.js";
import { ProductProfileStore } from "../product/profile-store.js";
import { ProductRuntimeStore } from "../product/runtime-store.js";
import { ProductServiceStateStore } from "../product/service-state-store.js";
import { ProductSettingsStore } from "../product/settings-store.js";
import { getLaunchAgentStatus } from "../service/launch-agent.js";
import type { LocalPanelServiceSummary, LocalPanelStatusResponse } from "./local-panel-types.js";

interface LocalPanelStateServiceOptions {
  logger: Logger;
  profileStore: ProductProfileStore;
  credentialStore: AgentCredentialStore;
  settingsStore: ProductSettingsStore;
  runtimeStore: ProductRuntimeStore;
  serviceStateStore: ProductServiceStateStore;
  relayUrl: string;
  relaySource: MacAgentRelaySource;
  codexCommand: string;
}

function toUnsupportedServiceStatus(): LocalPanelServiceSummary {
  return {
    mode: "manual",
    supported: false,
    installed: false,
    loaded: false
  };
}

export class LocalPanelStateService {
  private relayUrl: string;
  private relaySource: MacAgentRelaySource;

  public constructor(private readonly options: LocalPanelStateServiceOptions) {
    this.relayUrl = options.relayUrl;
    this.relaySource = options.relaySource;
  }

  public getCurrentRelay(): { relayUrl: string; relaySource: MacAgentRelaySource } {
    return {
      relayUrl: this.relayUrl,
      relaySource: this.relaySource
    };
  }

  public setCurrentRelay(relayUrl: string, relaySource: MacAgentRelaySource): void {
    this.relayUrl = relayUrl;
    this.relaySource = relaySource;
  }

  public async recordLocalPanelStart(url: string): Promise<void> {
    await this.options.runtimeStore.writeConsoleState({
      url,
      relayUrl: this.relayUrl,
      relaySource: this.relaySource
    });
  }

  public async touchHeartbeat(): Promise<void> {
    await this.options.runtimeStore.touchHeartbeat();
  }

  public async clearLocalPanelState(): Promise<void> {
    await this.options.runtimeStore.clear();
  }

  public async loadStatus(): Promise<LocalPanelStatusResponse> {
    const settings = await this.options.settingsStore.load();
    const profile = await this.loadProfile();
    const activeLocalPanelState = await this.options.runtimeStore.loadActive();
    const activeServiceState = await this.options.serviceStateStore.loadActive();
    const service = process.platform === "darwin"
      ? {
          mode: "managed" as const,
          supported: true,
          ...getLaunchAgentStatus(getProductLogDirectoryPath())
        }
      : toUnsupportedServiceStatus();

    return {
      productName: PRODUCT_NAME,
      desktopProductName: DESKTOP_AGENT_PRODUCT_NAME,
      agentVersion: getAgentVersion(),
      relayUrl: this.relayUrl,
      relaySource: this.relaySource,
      relayUrlOverride: settings.relayUrlOverride,
      dataDirectory: getProductDataDirectory(),
      stateFilePath: getProductStateFilePath(),
      settingsFilePath: getProductSettingsFilePath(),
      localPanelStateFilePath: getProductConsoleStateFilePath(),
      logDirectory: getProductLogDirectoryPath(),
      codexCommand: this.options.codexCommand,
      currentLocalPanelUrl: activeLocalPanelState?.url,
      relayConnection: {
        status: activeServiceState?.status ?? "unknown",
        lastConnectedAt: activeServiceState?.lastConnectedAt,
        lastError: activeServiceState?.lastError,
        nextRetryAt: activeServiceState?.nextRetryAt,
        reconnectAttempt: activeServiceState?.reconnectAttempt
      },
      profile: profile
        ? {
            agentId: profile.agentId,
            machineId: profile.machineId,
            deviceName: profile.deviceName,
            hasShownInitialPairing: profile.hasShownInitialPairing,
            authRelayCount: Object.keys(profile.authByRelay).length
          }
        : null,
      service,
      updatedAt: new Date().toISOString()
    };
  }

  private async loadProfile() {
    const profile = await this.options.profileStore.load();
    if (!profile) {
      return null;
    }

    try {
      return await this.options.credentialStore.hydrateProfile(this.options.profileStore, profile);
    } catch (error) {
      this.options.logger.warn("failed to hydrate profile for local panel status", {
        message: error instanceof Error ? error.message : String(error)
      });
      return profile;
    }
  }
}
