export interface LoadMobileConfig {
  relayHttpBaseUrl: string;
  relayWsUrl: string;
  agentId: string;
  totalClients: number;
  requestText: string;
  setupParallelism: number;
  turnTimeoutMs: number;
  durationMinutes: number;
  thinkTimeMsMin: number;
  thinkTimeMsMax: number;
  reportIntervalSec: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/connect";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadMobileConfig {
  const relayHttpBaseUrl = env.RELAY_BASE_URL ?? "http://127.0.0.1:8787";
  const thinkTimeMsMin = parseNonNegativeInt(env.LOAD_THINK_TIME_MS_MIN, 500);
  const thinkTimeMsMaxRaw = parseNonNegativeInt(env.LOAD_THINK_TIME_MS_MAX, 3000);
  const thinkTimeMsMax = thinkTimeMsMaxRaw < thinkTimeMsMin ? thinkTimeMsMin : thinkTimeMsMaxRaw;

  return {
    relayHttpBaseUrl,
    relayWsUrl: env.RELAY_WS_URL ?? toWebSocketUrl(relayHttpBaseUrl),
    agentId: env.LOAD_AGENT_ID ?? "fake-agent-local",
    totalClients: parsePositiveInt(env.LOAD_CLIENTS, 100),
    requestText: env.LOAD_TURN_TEXT ?? "请回复：收到",
    setupParallelism: parsePositiveInt(env.LOAD_SETUP_PARALLELISM, 20),
    turnTimeoutMs: parsePositiveInt(env.LOAD_TURN_TIMEOUT_MS, 60_000),
    durationMinutes: parsePositiveNumber(env.LOAD_DURATION_MINUTES, 10),
    thinkTimeMsMin,
    thinkTimeMsMax,
    reportIntervalSec: parsePositiveInt(env.LOAD_REPORT_INTERVAL_SEC, 30)
  };
}
