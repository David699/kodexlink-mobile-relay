import type { SqlMigrationDefinition } from "../migrator.js";

export const initialSchemaMigration: SqlMigrationDefinition = {
  id: "0001_initial_schema",
  description: "baseline relay schema",
  sql: `
CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  device_type  TEXT NOT NULL CHECK (device_type IN ('agent', 'mobile')),
  device_name  TEXT NOT NULL,
  device_token TEXT NOT NULL,
  runtime_type TEXT,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_bindings (
  binding_id       TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL REFERENCES devices(device_id),
  mobile_device_id TEXT NOT NULL REFERENCES devices(device_id),
  display_name     TEXT NOT NULL,
  is_default       BOOLEAN NOT NULL DEFAULT false,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at       BIGINT NOT NULL,
  last_active_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  token_id              TEXT PRIMARY KEY,
  device_id             TEXT NOT NULL REFERENCES devices(device_id),
  pair_id               TEXT NOT NULL,
  token_kind            TEXT NOT NULL CHECK (token_kind IN ('access', 'refresh')),
  token_hash            TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL CHECK (status IN ('active', 'rotated', 'revoked', 'expired')),
  issued_at             BIGINT NOT NULL,
  expires_at            BIGINT NOT NULL,
  last_used_at          BIGINT,
  replaced_by_token_id  TEXT REFERENCES device_tokens(token_id),
  revoked_at            BIGINT,
  revoke_reason         TEXT
);

CREATE INDEX IF NOT EXISTS idx_bindings_agent
  ON device_bindings(agent_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_bindings_mobile
  ON device_bindings(mobile_device_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_active
  ON device_bindings(agent_id, mobile_device_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_unique_default
  ON device_bindings(mobile_device_id) WHERE is_default = true AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_device_tokens_device
  ON device_tokens(device_id);

CREATE INDEX IF NOT EXISTS idx_device_tokens_hash
  ON device_tokens(token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_active_access
  ON device_tokens(device_id)
  WHERE token_kind = 'access' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_active_refresh
  ON device_tokens(device_id)
  WHERE token_kind = 'refresh' AND status = 'active';
`
};
