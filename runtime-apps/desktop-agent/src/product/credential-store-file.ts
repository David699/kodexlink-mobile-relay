import type { AgentCredentialStore } from "./agent-credential-store.js";
import type { ProductProfile } from "./profile-store.js";
import type { AgentIdentity } from "../pairing/pairing-manager.js";
import { ProductProfileStore } from "./profile-store.js";

export class FileCredentialStore implements AgentCredentialStore {
  public async hydrateProfile(
    _profileStore: ProductProfileStore,
    profile: ProductProfile
  ): Promise<ProductProfile> {
    return profile;
  }

  public async persistIdentity(
    profileStore: ProductProfileStore,
    profile: ProductProfile,
    identity: AgentIdentity
  ): Promise<ProductProfile> {
    return profileStore.saveIdentity(profile, identity);
  }

  public async resetIdentity(
    profileStore: ProductProfileStore,
    profile: ProductProfile
  ): Promise<ProductProfile> {
    return profileStore.resetIdentity(profile);
  }
}
