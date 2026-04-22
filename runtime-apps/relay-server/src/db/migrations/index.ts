import { initialSchemaMigration } from "./0001-initial-schema.js";

export const RELAY_SQL_MIGRATIONS = [initialSchemaMigration] as const;
