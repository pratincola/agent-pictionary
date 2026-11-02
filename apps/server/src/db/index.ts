import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
export type Sql = ReturnType<typeof postgres>;

export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, {
    max: opts.max ?? 8,
    // Keep bigint columns as BigInt (drizzle mode: "bigint" expects strings/bigints).
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

/** Folder with the checked-in drizzle-kit migrations (works from src and dist). */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/db -> ../../drizzle ; dist/db -> ../../drizzle
  return join(here, "..", "..", "drizzle");
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

export { schema };
