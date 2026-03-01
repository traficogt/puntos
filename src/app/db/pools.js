import pg from "pg";
import { config } from "../../config/index.js";

const { Pool } = pg;

export const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30_000
});

export const migrationPool = (config.DB_MIGRATIONS_USER || config.DB_MIGRATIONS_PASSWORD)
  ? new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_MIGRATIONS_USER || config.DB_USER,
      password: config.DB_MIGRATIONS_PASSWORD || config.DB_PASSWORD,
      max: 5,
      idleTimeoutMillis: 30_000
    })
  : pool;

export async function closeDatabase() {
  await pool.end();
  if (migrationPool !== pool) await migrationPool.end();
}
