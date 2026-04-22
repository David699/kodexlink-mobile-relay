import { RelayServerConfigSchema, type RelayServerConfig } from "@kodexlink/schemas";

export function loadRelayServerConfig(env: NodeJS.ProcessEnv = process.env): RelayServerConfig {
  return RelayServerConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    bindHost: env.RELAY_BIND_HOST,
    publicBaseUrl: env.RELAY_PUBLIC_BASE_URL,
    publicWebSocketUrl: env.RELAY_PUBLIC_WS_URL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    enableDevReset: env.RELAY_ENABLE_DEV_RESET
  });
}
