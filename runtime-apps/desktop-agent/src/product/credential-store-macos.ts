import type { Logger } from "@kodexlink/shared";

import type { AgentAuthState, AgentIdentity } from "../pairing/pairing-manager.js";
import { KeychainAuthStore } from "./keychain-auth-store.js";
import type { AgentCredentialStore } from "./agent-credential-store.js";
import { ProductProfileStore, type ProductProfile } from "./profile-store.js";

function authStateFromIdentity(identity: AgentIdentity): AgentAuthState {
  return {
    deviceId: identity.deviceId,
    accessToken: identity.accessToken,
    refreshToken: identity.refreshToken,
    accessExpiresAt: identity.accessExpiresAt,
    refreshExpiresAt: identity.refreshExpiresAt,
    relayBaseUrl: identity.relayBaseUrl
  };
}

function mergeAuthByRelay(
  profile: ProductProfile,
  authByRelay: Record<string, AgentAuthState>
): ProductProfile {
  return {
    ...profile,
    authByRelay
  };
}

export class MacOSKeychainCredentialStore implements AgentCredentialStore {
  private readonly keychainAuthStore: KeychainAuthStore;

  public constructor(private readonly logger: Logger) {
    this.keychainAuthStore = new KeychainAuthStore(logger);
  }

  public async hydrateProfile(
    profileStore: ProductProfileStore,
    profile: ProductProfile
  ): Promise<ProductProfile> {
    const legacyAuthByRelay = profile.authByRelay;
    let keychainAuthByRelay: Record<string, AgentAuthState> = {};

    try {
      keychainAuthByRelay = await this.keychainAuthStore.load(profile.agentId);
    } catch (error) {
      this.logger.warn("failed to load relay auth from keychain, falling back to legacy state file", {
        agentId: profile.agentId,
        message: error instanceof Error ? error.message : String(error)
      });
      return profile;
    }

    if (Object.keys(legacyAuthByRelay).length === 0) {
      return mergeAuthByRelay(profile, keychainAuthByRelay);
    }

    const mergedAuthByRelay = {
      ...legacyAuthByRelay,
      ...keychainAuthByRelay
    };

    try {
      await this.keychainAuthStore.save(profile.agentId, mergedAuthByRelay);
      const strippedProfile = await profileStore.stripSensitiveAuth(profile);
      this.logger.info("migrated legacy relay auth from state file into keychain", {
        agentId: profile.agentId,
        relayCount: Object.keys(mergedAuthByRelay).length
      });
      return mergeAuthByRelay(strippedProfile, mergedAuthByRelay);
    } catch (error) {
      this.logger.warn("failed to migrate legacy relay auth into keychain, keeping state-file fallback", {
        agentId: profile.agentId,
        relayCount: Object.keys(mergedAuthByRelay).length,
        message: error instanceof Error ? error.message : String(error)
      });
      return mergeAuthByRelay(profile, mergedAuthByRelay);
    }
  }

  public async persistIdentity(
    profileStore: ProductProfileStore,
    profile: ProductProfile,
    identity: AgentIdentity
  ): Promise<ProductProfile> {
    const nextAuthByRelay = {
      ...profile.authByRelay,
      [identity.relayBaseUrl]: authStateFromIdentity(identity)
    };

    try {
      await this.keychainAuthStore.save(profile.agentId, nextAuthByRelay);
      const strippedProfile = await profileStore.stripSensitiveAuth(profile);
      return mergeAuthByRelay(strippedProfile, nextAuthByRelay);
    } catch (error) {
      this.logger.warn("failed to persist relay auth in keychain, falling back to legacy state file", {
        agentId: profile.agentId,
        relayBaseUrl: identity.relayBaseUrl,
        message: error instanceof Error ? error.message : String(error)
      });
      return profileStore.saveIdentity(profile, identity);
    }
  }

  public async resetIdentity(
    profileStore: ProductProfileStore,
    profile: ProductProfile
  ): Promise<ProductProfile> {
    try {
      await this.keychainAuthStore.clear(profile.agentId);
    } catch (error) {
      this.logger.warn("failed to clear relay auth from keychain before resetting identity", {
        agentId: profile.agentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return profileStore.resetIdentity(profile);
  }
}
