import pg from "pg";
import { config } from "../../config/index.js";

const { Pool } = pg;

const applicationConnection = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
};

export const pool = new Pool({ ...applicationConnection, max: 20 });

// A request retains its client until its response finishes. Transactions need
// independent capacity or a full request pool would wait on its own releases.
export const transactionPool = new Pool({ ...applicationConnection, max: 10 });

export const migrationPool = (config.DB_MIGRATIONS_USER || config.DB_MIGRATIONS_PASSWORD)
  ? new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_MIGRATIONS_USER || config.DB_USER,
      password: config.DB_MIGRATIONS_PASSWORD || config.DB_PASSWORD,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    })
  : pool;

let closePromise;
export function closeDatabase() {
  // The migration pool can alias the request pool; end every distinct pool
  // once, including when shutdown hooks call closeDatabase concurrently.
  closePromise ??= Promise.all([...new Set([pool, transactionPool, migrationPool])].map(value => value.end())).then(() => {});
  return closePromise;
}
