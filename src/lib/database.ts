import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { config } from "../config.js";

let pool: Pool | undefined;

export function isDatabaseEnabled(): boolean {
  return Boolean(config.database.url);
}

export async function initializeDatabase(): Promise<void> {
  if (!isDatabaseEnabled()) {
    console.warn("DATABASE_URL is not configured; using in-memory repositories.");
    return;
  }

  const migrationsDirectory = join(process.cwd(), "migrations");
  const migrationNames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();

  for (const migrationName of migrationNames) {
    const migration = await readFile(join(migrationsDirectory, migrationName), "utf8");
    await getPool().query(migration);
  }
}

export async function queryDatabase<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<Row>(text, values);
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

function getPool(): Pool {
  if (!config.database.url) {
    throw new Error("DATABASE_URL is not configured.");
  }

  pool ??= new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined
  });

  return pool;
}
