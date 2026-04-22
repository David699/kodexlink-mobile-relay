import { createHash, randomUUID } from "node:crypto";

import pg from "pg";

import { ERROR_CODES, type DeviceType, type ErrorCode } from "@kodexlink/protocol";
import { applyDatabaseMigrations, assertDatabaseMigrationsApplied, type MigrationRunResult } from "./migrator.js";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;

export interface DeviceRecord {
  deviceId: string;
  deviceType: DeviceType;
  deviceName: string;
  deviceToken: string;
  runtimeType?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BindingRecord {
  bindingId: string;
  agentId: string;
  mobileDeviceId: string;
  displayName: string;
  isDefault: boolean;
  status: "active" | "disabled" | "revoked";
  createdAt: number;
  lastActiveAt: number;
}

export type DeviceTokenKind = "access" | "refresh";
export type DeviceTokenStatus = "active" | "rotated" | "revoked" | "expired";

export interface DeviceTokenRecord {
  tokenId: string;
  deviceId: string;
  pairId: string;
  tokenKind: DeviceTokenKind;
  tokenHash: string;
  status: DeviceTokenStatus;
  issuedAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  replacedByTokenId?: string;
  revokedAt?: number;
  revokeReason?: string;
}

export interface DeviceTokenBundle {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export interface DeviceBootstrapResult {
  device: DeviceRecord;
  tokens: DeviceTokenBundle;
}

export type DeviceAuthResult =
  | {
      ok: true;
      device: DeviceRecord;
      token: DeviceTokenRecord;
    }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
    };

interface IssueDeviceTokenPairResult extends DeviceTokenBundle {
  accessTokenId: string;
  refreshTokenId: string;
}

export class DeviceAlreadyInitializedError extends Error {
  public readonly code = ERROR_CODES.deviceAlreadyInitialized;

  public constructor(deviceId: string) {
    super(`device already initialized: ${deviceId}`);
    this.name = "DeviceAlreadyInitializedError";
  }
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function buildRawToken(prefix: "atk" | "rtk"): string {
  return `${prefix}_${randomUUID()}`;
}

export class PostgresStore {
  private pool: pg.Pool;

  public constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    await assertDatabaseMigrationsApplied(this.pool);
  }

  async migrate(): Promise<MigrationRunResult> {
    return applyDatabaseMigrations(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM devices WHERE device_id = $1", [deviceId]);
    return rows[0] ? this.mapDeviceRow(rows[0]) : undefined;
  }

  async bootstrapDevice(input: {
    deviceType: DeviceType;
    deviceId?: string;
    deviceName: string;
    runtimeType?: string;
    nowSeconds: number;
  }): Promise<DeviceBootstrapResult> {
    const client = await this.pool.connect();
    const deviceId = input.deviceId ?? `${input.deviceType}_${randomUUID()}`;

    try {
      await client.query("BEGIN");

      const device = await this.upsertDevice(client, {
        deviceId,
        deviceType: input.deviceType,
        deviceName: input.deviceName,
        runtimeType: input.runtimeType,
        nowSeconds: input.nowSeconds
      });

      await this.expireTokensForDevice(client, deviceId, input.nowSeconds);

      const { rows: activeRows } = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM device_tokens
         WHERE device_id = $1 AND status = 'active'`,
        [deviceId]
      );
      if ((activeRows[0]?.count as number) > 0) {
        throw new DeviceAlreadyInitializedError(deviceId);
      }

      const tokens = await this.issueDeviceTokenPair(client, deviceId, input.nowSeconds);

      await client.query("COMMIT");
      return { device, tokens };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async validateDevice(
    deviceType: DeviceType,
    deviceId: string,
    accessToken: string
  ): Promise<DeviceAuthResult> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await this.expireTokensForDevice(client, deviceId, nowSeconds);

      const deviceQuery = await client.query(
        `SELECT *
         FROM devices
         WHERE device_id = $1
           AND device_type = $2
         FOR UPDATE`,
        [deviceId, deviceType]
      );
      const deviceRow = deviceQuery.rows[0] as Record<string, unknown> | undefined;
      if (!deviceRow) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: ERROR_CODES.authFailed,
          message: "device auth failed"
        };
      }

      const tokenQuery = await client.query(
        `SELECT *
         FROM device_tokens
         WHERE device_id = $1
           AND token_hash = $2
           AND token_kind = 'access'
         FOR UPDATE`,
        [deviceId, hashToken(accessToken)]
      );
      const tokenRow = tokenQuery.rows[0] as Record<string, unknown> | undefined;
      if (!tokenRow) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: ERROR_CODES.authFailed,
          message: "device auth failed"
        };
      }

      const token = this.mapDeviceTokenRow(tokenRow);
      if (token.status !== "active") {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: token.status === "expired" ? ERROR_CODES.tokenExpired : ERROR_CODES.tokenRevoked,
          message: token.status === "expired" ? "device token expired" : "device token revoked"
        };
      }

      await client.query(
        `UPDATE device_tokens
         SET last_used_at = $2
         WHERE token_id = $1`,
        [token.tokenId, nowSeconds]
      );
      await client.query(
        `UPDATE devices
         SET updated_at = $2
         WHERE device_id = $1`,
        [deviceId, nowSeconds]
      );

      await client.query("COMMIT");
      return {
        ok: true,
        device: this.mapDeviceRow(deviceRow),
        token
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async refreshDeviceTokens(input: {
    deviceId: string;
    refreshToken: string;
    nowSeconds: number;
  }): Promise<
    | { ok: true; device: DeviceRecord; tokens: DeviceTokenBundle }
    | { ok: false; code: ErrorCode; message: string }
  > {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await this.expireTokensForDevice(client, input.deviceId, input.nowSeconds);

      const deviceQuery = await client.query(
        `SELECT *
         FROM devices
         WHERE device_id = $1
         FOR UPDATE`,
        [input.deviceId]
      );
      const deviceRow = deviceQuery.rows[0] as Record<string, unknown> | undefined;
      if (!deviceRow) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: ERROR_CODES.authFailed,
          message: "refresh token is invalid"
        };
      }

      const tokenQuery = await client.query(
        `SELECT *
         FROM device_tokens
         WHERE device_id = $1
           AND token_hash = $2
           AND token_kind = 'refresh'
         FOR UPDATE`,
        [input.deviceId, hashToken(input.refreshToken)]
      );
      const tokenRow = tokenQuery.rows[0] as Record<string, unknown> | undefined;
      if (!tokenRow) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: ERROR_CODES.authFailed,
          message: "refresh token is invalid"
        };
      }

      const refreshTokenRecord = this.mapDeviceTokenRow(tokenRow);
      if (refreshTokenRecord.status !== "active") {
        await client.query("ROLLBACK");
        return {
          ok: false,
          code: refreshTokenRecord.status === "expired" ? ERROR_CODES.tokenExpired : ERROR_CODES.tokenRevoked,
          message:
            refreshTokenRecord.status === "expired"
              ? "refresh token expired"
              : "refresh token revoked"
        };
      }

      const nextTokens = this.buildRawDeviceTokenPair(input.nowSeconds);

      const rotatedRows = await client.query(
        `UPDATE device_tokens
         SET status = 'rotated',
             revoked_at = $2,
             revoke_reason = 'rotated'
         WHERE device_id = $1
           AND status = 'active'
         RETURNING token_id, token_kind`,
        [input.deviceId, input.nowSeconds]
      );

      const nextPairId = `pair_${randomUUID()}`;
      await client.query(
        `INSERT INTO device_tokens
          (token_id, device_id, pair_id, token_kind, token_hash, status, issued_at, expires_at, last_used_at)
         VALUES
          ($1, $2, $3, 'access', $4, 'active', $5, $6, $5),
          ($7, $2, $3, 'refresh', $8, 'active', $5, $9, $5)`,
        [
          nextTokens.accessTokenId,
          input.deviceId,
          nextPairId,
          hashToken(nextTokens.accessToken),
          input.nowSeconds,
          nextTokens.accessExpiresAt,
          nextTokens.refreshTokenId,
          hashToken(nextTokens.refreshToken),
          nextTokens.refreshExpiresAt
        ]
      );

      const replacedByTokenIds = new Map<DeviceTokenKind, string>([
        ["access", nextTokens.accessTokenId],
        ["refresh", nextTokens.refreshTokenId]
      ]);

      for (const row of rotatedRows.rows as Array<Record<string, unknown>>) {
        const tokenKind = row.token_kind as DeviceTokenKind;
        const replacementTokenId = replacedByTokenIds.get(tokenKind);
        if (!replacementTokenId) {
          continue;
        }

        await client.query(
          `UPDATE device_tokens
           SET replaced_by_token_id = $2
           WHERE token_id = $1`,
          [row.token_id as string, replacementTokenId]
        );
      }

      const device = await this.touchDevice(client, input.deviceId, input.nowSeconds);
      await client.query("COMMIT");

      return {
        ok: true,
        device,
        tokens: nextTokens
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeActiveTokensForDevice(input: {
    deviceId: string;
    revokeReason: string;
    nowSeconds: number;
  }): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE device_tokens
       SET status = 'revoked',
           revoked_at = $2,
           revoke_reason = $3
       WHERE device_id = $1
         AND status = 'active'`,
      [input.deviceId, input.nowSeconds, input.revokeReason]
    );
    return rowCount ?? 0;
  }

  async getBinding(bindingId: string): Promise<BindingRecord | undefined> {
    const { rows } = await this.pool.query("SELECT * FROM device_bindings WHERE binding_id = $1", [bindingId]);
    return rows[0] ? this.mapBindingRow(rows[0]) : undefined;
  }

  async getBindingsForMobileDevice(mobileDeviceId: string): Promise<BindingRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM device_bindings WHERE mobile_device_id = $1 AND status = 'active'",
      [mobileDeviceId]
    );
    return rows.map((row) => this.mapBindingRow(row));
  }

  async getBindingsForAgent(agentId: string): Promise<BindingRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM device_bindings WHERE agent_id = $1 AND status = 'active'",
      [agentId]
    );
    return rows.map((row) => this.mapBindingRow(row));
  }

  async createBinding(input: {
    bindingId: string;
    agentId: string;
    mobileDeviceId: string;
    displayName: string;
    nowSeconds: number;
  }): Promise<BindingRecord> {
    try {
      const { rows } = await this.pool.query(
        `WITH default_check AS (
          SELECT EXISTS(
            SELECT 1 FROM device_bindings
            WHERE mobile_device_id = $3 AND is_default = true AND status = 'active'
          ) AS has_default
        )
        INSERT INTO device_bindings
          (binding_id, agent_id, mobile_device_id, display_name, is_default, status, created_at, last_active_at)
        SELECT $1, $2, $3, $4, NOT dc.has_default, 'active', $5, $5
        FROM default_check dc
        ON CONFLICT (agent_id, mobile_device_id) WHERE status = 'active'
        DO UPDATE SET last_active_at = EXCLUDED.last_active_at
        RETURNING *`,
        [input.bindingId, input.agentId, input.mobileDeviceId, input.displayName, input.nowSeconds]
      );
      return this.mapBindingRow(rows[0]);
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505" && pgError.constraint === "idx_bindings_unique_default") {
        const { rows } = await this.pool.query(
          `INSERT INTO device_bindings
             (binding_id, agent_id, mobile_device_id, display_name, is_default, status, created_at, last_active_at)
           VALUES ($1, $2, $3, $4, false, 'active', $5, $5)
           ON CONFLICT (agent_id, mobile_device_id) WHERE status = 'active'
           DO UPDATE SET last_active_at = EXCLUDED.last_active_at
           RETURNING *`,
          [input.bindingId, input.agentId, input.mobileDeviceId, input.displayName, input.nowSeconds]
        );
        return this.mapBindingRow(rows[0]);
      }
      throw error;
    }
  }

  async touchBinding(bindingId: string, nowSeconds: number): Promise<void> {
    await this.pool.query("UPDATE device_bindings SET last_active_at = $2 WHERE binding_id = $1", [
      bindingId,
      nowSeconds
    ]);
  }

  async findExistingBinding(agentId: string, mobileDeviceId: string): Promise<BindingRecord | undefined> {
    const { rows } = await this.pool.query(
      "SELECT * FROM device_bindings WHERE agent_id = $1 AND mobile_device_id = $2 AND status = 'active'",
      [agentId, mobileDeviceId]
    );
    return rows[0] ? this.mapBindingRow(rows[0]) : undefined;
  }

  private async upsertDevice(
    client: pg.PoolClient,
    input: {
      deviceId: string;
      deviceType: DeviceType;
      deviceName: string;
      runtimeType?: string;
      nowSeconds: number;
    }
  ): Promise<DeviceRecord> {
    const legacyToken = `legacy_${randomUUID()}`;
    const { rows } = await client.query(
      `INSERT INTO devices (device_id, device_type, device_name, device_token, runtime_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (device_id) DO UPDATE SET
         device_name = EXCLUDED.device_name,
         runtime_type = COALESCE(EXCLUDED.runtime_type, devices.runtime_type),
         updated_at = EXCLUDED.updated_at
       WHERE devices.device_type = EXCLUDED.device_type
       RETURNING *`,
      [
        input.deviceId,
        input.deviceType,
        input.deviceName,
        legacyToken,
        input.runtimeType ?? null,
        input.nowSeconds
      ]
    );

    if (!rows[0]) {
      throw new Error(`device id already exists with a different type: ${input.deviceId}`);
    }

    return this.mapDeviceRow(rows[0]);
  }

  private async touchDevice(client: pg.PoolClient, deviceId: string, nowSeconds: number): Promise<DeviceRecord> {
    const { rows } = await client.query(
      `UPDATE devices
       SET updated_at = $2
       WHERE device_id = $1
       RETURNING *`,
      [deviceId, nowSeconds]
    );

    if (!rows[0]) {
      throw new Error(`device not found: ${deviceId}`);
    }

    return this.mapDeviceRow(rows[0]);
  }

  private async expireTokensForDevice(client: pg.PoolClient, deviceId: string, nowSeconds: number): Promise<void> {
    await client.query(
      `UPDATE device_tokens
       SET status = 'expired',
           revoked_at = COALESCE(revoked_at, $2),
           revoke_reason = COALESCE(revoke_reason, 'expired')
       WHERE device_id = $1
         AND status = 'active'
         AND expires_at <= $2`,
      [deviceId, nowSeconds]
    );
  }

  private buildRawDeviceTokenPair(nowSeconds: number): IssueDeviceTokenPairResult {
    return {
      accessTokenId: `tok_${randomUUID()}`,
      refreshTokenId: `tok_${randomUUID()}`,
      accessToken: buildRawToken("atk"),
      refreshToken: buildRawToken("rtk"),
      accessExpiresAt: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresAt: nowSeconds + REFRESH_TOKEN_TTL_SECONDS
    };
  }

  private async issueDeviceTokenPair(
    client: pg.PoolClient,
    deviceId: string,
    nowSeconds: number
  ): Promise<DeviceTokenBundle> {
    const nextTokens = this.buildRawDeviceTokenPair(nowSeconds);
    const pairId = `pair_${randomUUID()}`;

    await client.query(
      `INSERT INTO device_tokens
        (token_id, device_id, pair_id, token_kind, token_hash, status, issued_at, expires_at, last_used_at)
       VALUES
        ($1, $2, $3, 'access', $4, 'active', $5, $6, $5),
        ($7, $2, $3, 'refresh', $8, 'active', $5, $9, $5)`,
      [
        nextTokens.accessTokenId,
        deviceId,
        pairId,
        hashToken(nextTokens.accessToken),
        nowSeconds,
        nextTokens.accessExpiresAt,
        nextTokens.refreshTokenId,
        hashToken(nextTokens.refreshToken),
        nextTokens.refreshExpiresAt
      ]
    );

    return nextTokens;
  }

  private mapDeviceRow(row: Record<string, unknown>): DeviceRecord {
    return {
      deviceId: row.device_id as string,
      deviceType: row.device_type as DeviceType,
      deviceName: row.device_name as string,
      deviceToken: row.device_token as string,
      runtimeType: (row.runtime_type as string) ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  private mapDeviceTokenRow(row: Record<string, unknown>): DeviceTokenRecord {
    return {
      tokenId: row.token_id as string,
      deviceId: row.device_id as string,
      pairId: row.pair_id as string,
      tokenKind: row.token_kind as DeviceTokenKind,
      tokenHash: row.token_hash as string,
      status: row.status as DeviceTokenStatus,
      issuedAt: Number(row.issued_at),
      expiresAt: Number(row.expires_at),
      lastUsedAt: row.last_used_at == null ? undefined : Number(row.last_used_at),
      replacedByTokenId: (row.replaced_by_token_id as string) ?? undefined,
      revokedAt: row.revoked_at == null ? undefined : Number(row.revoked_at),
      revokeReason: (row.revoke_reason as string) ?? undefined
    };
  }

  private mapBindingRow(row: Record<string, unknown>): BindingRecord {
    return {
      bindingId: row.binding_id as string,
      agentId: row.agent_id as string,
      mobileDeviceId: row.mobile_device_id as string,
      displayName: row.display_name as string,
      isDefault: row.is_default as boolean,
      status: row.status as BindingRecord["status"],
      createdAt: Number(row.created_at),
      lastActiveAt: Number(row.last_active_at)
    };
  }
}
