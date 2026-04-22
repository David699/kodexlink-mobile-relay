import { z } from "zod";

const optionalUrlSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
}, z.string().url().optional());

const booleanishSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

export const MacAgentRelaySourceSchema = z.enum(["default", "settings", "env", "cli"]);
export type MacAgentRelaySource = z.infer<typeof MacAgentRelaySourceSchema>;

export const MacAgentConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  relayUrl: optionalUrlSchema,
  codexCommand: z.string().min(1).default("codex"),
  agentId: z.string().min(1).default("desktop-agent-local")
});

export type MacAgentConfig = z.infer<typeof MacAgentConfigSchema>;

export const MacAgentSettingsSchema = z.object({
  version: z.literal(1),
  relayUrlOverride: optionalUrlSchema,
  updatedAt: z.string().datetime().optional()
});

export type MacAgentSettings = z.infer<typeof MacAgentSettingsSchema>;

export const MacAgentConsoleStateSchema = z.object({
  version: z.literal(1),
  url: z.string().url(),
  port: z.number().int().positive(),
  pid: z.number().int().positive(),
  relayUrl: z.string().url(),
  relaySource: MacAgentRelaySourceSchema,
  startedAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime().optional()
});

export type MacAgentConsoleState = z.infer<typeof MacAgentConsoleStateSchema>;

export const MacAgentServiceConnectionStatusSchema = z.enum([
  "connecting",
  "online",
  "reconnecting",
  "offline"
]);

export type MacAgentServiceConnectionStatus = z.infer<
  typeof MacAgentServiceConnectionStatusSchema
>;

export const MacAgentServiceStateSchema = z.object({
  version: z.literal(1),
  pid: z.number().int().positive(),
  relayUrl: z.string().url(),
  status: MacAgentServiceConnectionStatusSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastConnectedAt: z.string().datetime().optional(),
  lastError: z.string().min(1).optional(),
  nextRetryAt: z.string().datetime().optional(),
  reconnectAttempt: z.number().int().nonnegative().optional()
});

export type MacAgentServiceState = z.infer<typeof MacAgentServiceStateSchema>;

export const RelayServerConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().positive().default(8787),
  bindHost: z.string().min(1).default("127.0.0.1"),
  publicBaseUrl: optionalUrlSchema,
  publicWebSocketUrl: optionalUrlSchema,
  databaseUrl: z.string().min(1).default("postgres://localhost:5432/codex_mobile"),
  redisUrl: z.string().min(1).default("redis://127.0.0.1:6379"),
  enableDevReset: booleanishSchema.default(false)
});

export type RelayServerConfig = z.infer<typeof RelayServerConfigSchema>;
