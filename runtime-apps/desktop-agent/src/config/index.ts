import { MacAgentConfigSchema, type MacAgentConfig, type MacAgentRelaySource } from "@kodexlink/schemas";

import { ProductSettingsStore } from "../product/settings-store.js";

export const DEFAULT_MAC_AGENT_RELAY_URL = "https://relay.example.com/";

export interface ResolvedMacAgentConfig extends Omit<MacAgentConfig, "relayUrl"> {
  relayUrl: string;
  relaySource: MacAgentRelaySource;
}

export interface LoadMacAgentConfigOptions {
  cliRelayUrl?: string;
  env?: NodeJS.ProcessEnv;
  settingsStore: ProductSettingsStore;
}

export function normalizeRelayUrl(rawValue?: string): string | undefined {
  const trimmed = rawValue?.trim();
  if (!trimmed || trimmed.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return trimmed;
    }

    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/v1/connect";
    }

    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

function resolveEnvironmentRelayUrl(env: NodeJS.ProcessEnv): string | undefined {
  return normalizeRelayUrl(env.KODEXLINK_RELAY_URL) ?? normalizeRelayUrl(env.RELAY_URL);
}

export async function loadMacAgentConfig(
  options: LoadMacAgentConfigOptions
): Promise<ResolvedMacAgentConfig> {
  const env = options.env ?? process.env;
  const cliRelayUrl = normalizeRelayUrl(options.cliRelayUrl);
  const environmentRelayUrl = resolveEnvironmentRelayUrl(env);
  const settings = await options.settingsStore.load();

  const parsedConfig = MacAgentConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    relayUrl: cliRelayUrl ?? environmentRelayUrl,
    codexCommand: env.CODEX_COMMAND,
    agentId: env.AGENT_ID
  });

  if (cliRelayUrl) {
    return {
      ...parsedConfig,
      relayUrl: cliRelayUrl,
      relaySource: "cli"
    };
  }

  if (environmentRelayUrl) {
    return {
      ...parsedConfig,
      relayUrl: environmentRelayUrl,
      relaySource: "env"
    };
  }

  if (settings.relayUrlOverride) {
    return {
      ...parsedConfig,
      relayUrl: settings.relayUrlOverride,
      relaySource: "settings"
    };
  }

  return {
    ...parsedConfig,
    relayUrl: normalizeRelayUrl(DEFAULT_MAC_AGENT_RELAY_URL) ?? DEFAULT_MAC_AGENT_RELAY_URL,
    relaySource: "default"
  };
}
