import { hostname } from "node:os";

export interface FakeAgentConfig {
  relayWsUrl: string;
  relayHttpBaseUrl: string;
  agentId: string;
  deviceName: string;
  clientVersion: string;
  defaultCwd: string;
  deltaChunks: number;
  deltaDelayMs: number;
  threadSeedCount: number;
}

function asPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toRelayHttpBaseUrl(relayWsUrl: string): string {
  const url = new URL(relayWsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function loadFakeAgentConfig(env: NodeJS.ProcessEnv = process.env): FakeAgentConfig {
  const relayWsUrl = env.RELAY_URL ?? "ws://127.0.0.1:8787/v1/connect";
  return {
    relayWsUrl,
    relayHttpBaseUrl: toRelayHttpBaseUrl(relayWsUrl),
    agentId: env.AGENT_ID ?? "fake-agent-local",
    deviceName: env.AGENT_NAME ?? `FakeAgent@${hostname()}`,
    clientVersion: env.CLIENT_VERSION ?? "fake-agent/0.1.0",
    defaultCwd: env.FAKE_AGENT_CWD ?? "/tmp/fake-agent-workspace",
    deltaChunks: asPositiveInt(env.FAKE_AGENT_DELTA_CHUNKS, 10),
    deltaDelayMs: asPositiveInt(env.FAKE_AGENT_DELTA_DELAY_MS, 80),
    threadSeedCount: asPositiveInt(env.FAKE_AGENT_THREAD_SEED_COUNT, 30)
  };
}
