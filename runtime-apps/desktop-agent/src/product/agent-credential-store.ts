import type { Logger } from "@kodexlink/shared";

import type { AgentIdentity } from "../pairing/pairing-manager.js";
import { FileCredentialStore } from "./credential-store-file.js";
import { MacOSKeychainCredentialStore } from "./credential-store-macos.js";
import { ProductProfileStore, type ProductProfile } from "./profile-store.js";

export interface AgentCredentialStore {
  hydrateProfile(profileStore: ProductProfileStore, profile: ProductProfile): Promise<ProductProfile>;
  persistIdentity(
    profileStore: ProductProfileStore,
    profile: ProductProfile,
    identity: AgentIdentity
  ): Promise<ProductProfile>;
  resetIdentity(profileStore: ProductProfileStore, profile: ProductProfile): Promise<ProductProfile>;
}

export function createAgentCredentialStore(logger: Logger): AgentCredentialStore {
  if (process.platform === "darwin") {
    return new MacOSKeychainCredentialStore(logger);
  }

  return new FileCredentialStore();
}
