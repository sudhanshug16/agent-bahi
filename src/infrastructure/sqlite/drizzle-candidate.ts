import { drizzle } from "drizzle-orm/bun-sqlite";
import type { Database } from "bun:sqlite";

/**
 * Proof-gated infrastructure candidate only. Domain and application code must
 * depend on ports, while this adapter may be replaced by NativeBunSqlite.
 */
export function createDrizzleCandidate(client: Database) {
  return drizzle({ client });
}

export const DRIZZLE_CANDIDATE = {
  package: "drizzle-orm",
  adapter: "bun-sqlite",
  status: "candidate",
  migrationPolicy: "hand-reviewed-sql",
} as const;
