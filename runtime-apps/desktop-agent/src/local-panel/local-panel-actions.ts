import type { Logger } from "@kodexlink/shared";

import { DEFAULT_MAC_AGENT_RELAY_URL, normalizeRelayUrl } from "../config/index.js";
import type { AgentCredentialStore } from "../product/agent-credential-store.js";
import { getProductDataDirectory, getProductLogDirectoryPath } from "../product/directories.js";
import { ProductProfileStore } from "../product/profile-store.js";
import { ProductSettingsStore } from "../product/settings-store.js";
import {
  installOrUpdateLaunchAgent,
  startLaunchAgent,
  type LaunchAgentInstallOptions,
  type LaunchAgentStatus
} from "../service/launch-agent.js";
import { PairingSnapshotController } from "../pairing/pairing-snapshot-controller.js";
import { LocalPanelStateService } from "./local-panel-state-service.js";
import type { LocalPanelServiceSummary } from "./local-panel-types.js";

interface LocalPanelActionsOptions {
  logger: Logger;
  settingsStore: ProductSettingsStore;
  profileStore: ProductProfileStore;
  credentialStore: AgentCredentialStore;
  stateService: LocalPanelStateService;
  snapshotController: PairingSnapshotController;
  managedServiceEnabled: boolean;
  launchAgentInstallOptions: Omit<LaunchAgentInstallOptions, "logDir" | "workingDirectory">;
}

interface RelayUpdateInput {
  relayUrl?: string;
  useDefault?: boolean;
}

const RESET_IDENTITY_CONFIRMATION_MISMATCH = "resetIdentityConfirmationMismatchMessage";
const RESET_IDENTITY_UNAVAILABLE = "resetIdentityUnavailableMessage";

function resolveDefaultRelayUrl(): string {
  return normalizeRelayUrl(DEFAULT_MAC_AGENT_RELAY_URL) ?? DEFAULT_MAC_AGENT_RELAY_URL;
}

export class LocalPanelActions {
  private readonly defaultRelayUrl = resolveDefaultRelayUrl();

  public constructor(private readonly options: LocalPanelActionsOptions) {}

  private toServiceSummary(status: LaunchAgentStatus): LocalPanelServiceSummary {
    return {
      mode: "managed",
      supported: true,
      label: status.label,
      installed: status.installed,
      loaded: status.loaded,
      pid: status.pid,
      lastExitCode: status.lastExitCode,
      plistPath: status.plistPath,
      stdoutPath: status.stdoutPath,
      stderrPath: status.stderrPath
    };
  }

  private ensureManagedServiceEnabled(): void {
    if (this.options.managedServiceEnabled) {
      return;
    }

    throw new Error("Background service management is not supported on this platform. Keep kodexlink running in the terminal.");
  }

  public async saveRelayAndRestart(input: RelayUpdateInput): Promise<LocalPanelServiceSummary> {
    this.ensureManagedServiceEnabled();

    let nextRelayUrl = this.defaultRelayUrl;
    let relaySource: "default" | "settings" = "default";

    if (input.useDefault) {
      await this.options.settingsStore.clearRelayUrlOverride();
    } else {
      const normalizedRelayUrl = normalizeRelayUrl(input.relayUrl);
      if (!normalizedRelayUrl) {
        throw new Error("Enter a valid relay URL.");
      }

      if (normalizedRelayUrl === this.defaultRelayUrl) {
        await this.options.settingsStore.clearRelayUrlOverride();
      } else {
        await this.options.settingsStore.setRelayUrlOverride(normalizedRelayUrl);
        nextRelayUrl = normalizedRelayUrl;
        relaySource = "settings";
      }
    }

    this.options.stateService.setCurrentRelay(nextRelayUrl, relaySource);
    this.options.snapshotController.invalidate();

    return this.restartService();
  }

  public restartService(): LocalPanelServiceSummary {
    this.ensureManagedServiceEnabled();

    installOrUpdateLaunchAgent({
      ...this.options.launchAgentInstallOptions,
      logDir: getProductLogDirectoryPath(),
      workingDirectory: getProductDataDirectory()
    });

    const status = startLaunchAgent(this.options.logger, getProductLogDirectoryPath(), {
      forceRestart: true
    });
    this.options.logger.info("local panel restarted launch agent", {
      relayUrl: this.options.stateService.getCurrentRelay().relayUrl,
      loaded: status.loaded,
      pid: status.pid
    });
    return this.toServiceSummary(status);
  }

  public async resetIdentityAndRestart(confirmationText: string): Promise<LocalPanelServiceSummary> {
    this.ensureManagedServiceEnabled();

    const profile = await this.options.profileStore.load();
    if (!profile?.agentId) {
      this.options.logger.warn("local panel rejected identity reset because agent id is unavailable");
      throw new Error(RESET_IDENTITY_UNAVAILABLE);
    }

    const normalizedConfirmation = confirmationText.trim();
    if (normalizedConfirmation !== profile.agentId) {
      this.options.logger.warn("local panel rejected identity reset because confirmation did not match current agent id", {
        agentId: profile.agentId
      });
      throw new Error(RESET_IDENTITY_CONFIRMATION_MISMATCH);
    }

    const nextProfile = await this.options.credentialStore.resetIdentity(this.options.profileStore, profile);

    this.options.snapshotController.invalidate();
    this.options.logger.warn("local panel reset desktop-agent identity", {
      previousAgentId: profile.agentId,
      nextAgentId: nextProfile.agentId,
      nextMachineId: nextProfile.machineId
    });

    return this.restartService();
  }
}
