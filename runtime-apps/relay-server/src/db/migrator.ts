import { createHash } from "node:crypto";

import pg from "pg";

import { RELAY_SQL_MIGRATIONS } from "./migrations/index.js";

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  applied_at   BIGINT NOT NULL
);
`;

const MIGRATION_LOCK_NAMESPACE = 21841;
const MIGRATION_LOCK_KEY = 1;

export interface SqlMigrationDefinition {
  id: string;
  description: string;
  sql: string;
}

interface AppliedMigrationRow {
  migration_id: string;
  description: string;
  checksum: string;
  applied_at: string | number;
}

export interface MigrationRunResult {
  appliedMigrationIds: string[];
  skippedMigrationIds: string[];
}

export class PendingMigrationsError extends Error {
  public constructor(public readonly pendingMigrationIds: string[]) {
    super(
      `pending database migrations: ${pendingMigrationIds.join(", ")}. run \"pnpm --filter @kodexlink/relay-server migrate\" before starting relay-server`
    );
    this.name = "PendingMigrationsError";
  }
}

export class MigrationChecksumMismatchError extends Error {
  public constructor(public readonly migrationId: string) {
    super(`migration checksum mismatch detected for ${migrationId}`);
    this.name = "MigrationChecksumMismatchError";
  }
}

function checksumMigration(migration: SqlMigrationDefinition): string {
  return createHash("sha256")
    .update(`${migration.id}\n${migration.description}\n${migration.sql}`)
    .digest("hex");
}

async function ensureMigrationsTable(client: pg.PoolClient | pg.Pool): Promise<void> {
  await client.query(MIGRATIONS_TABLE_SQL);
}

async function loadAppliedMigrations(client: pg.PoolClient | pg.Pool): Promise<Map<string, AppliedMigrationRow>> {
  const { rows } = await client.query<AppliedMigrationRow>(
    `SELECT migration_id, description, checksum, applied_at
     FROM schema_migrations
     ORDER BY migration_id ASC`
  );
  return new Map(rows.map((row) => [row.migration_id, row]));
}

function validateAppliedMigrations(appliedMigrations: Map<string, AppliedMigrationRow>): string[] {
  const pendingMigrationIds: string[] = [];

  for (const migration of RELAY_SQL_MIGRATIONS) {
    const applied = appliedMigrations.get(migration.id);
    const checksum = checksumMigration(migration);
    if (!applied) {
      pendingMigrationIds.push(migration.id);
      continue;
    }

    if (applied.checksum !== checksum) {
      throw new MigrationChecksumMismatchError(migration.id);
    }
  }

  return pendingMigrationIds;
}

export async function assertDatabaseMigrationsApplied(pool: pg.Pool): Promise<void> {
  await ensureMigrationsTable(pool);
  const appliedMigrations = await loadAppliedMigrations(pool);
  const pendingMigrationIds = validateAppliedMigrations(appliedMigrations);
  if (pendingMigrationIds.length > 0) {
    throw new PendingMigrationsError(pendingMigrationIds);
  }
}

export async function applyDatabaseMigrations(pool: pg.Pool): Promise<MigrationRunResult> {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const appliedMigrations = await loadAppliedMigrations(client);
    const pendingMigrationIds = validateAppliedMigrations(appliedMigrations);

    const appliedMigrationIds: string[] = [];
    const skippedMigrationIds = RELAY_SQL_MIGRATIONS
      .map((migration) => migration.id)
      .filter((migrationId) => !pendingMigrationIds.includes(migrationId));

    for (const migration of RELAY_SQL_MIGRATIONS) {
      if (!pendingMigrationIds.includes(migration.id)) {
        continue;
      }

      const checksum = checksumMigration(migration);
      const appliedAt = Math.floor(Date.now() / 1000);

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (migration_id, description, checksum, applied_at)
           VALUES ($1, $2, $3, $4)`,
          [migration.id, migration.description, checksum, appliedAt]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      appliedMigrationIds.push(migration.id);
    }

    return {
      appliedMigrationIds,
      skippedMigrationIds
    };
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY]);
    } catch {
      // Unlock failure should not hide the original migration result.
    }
    client.release();
  }
}
