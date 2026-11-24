import pg from "pg";
import { config } from "../../config/index.js";

const { Pool } = pg;

/** @typedef {import("../../types/db.js").DbPool} DbPool */

/**
 * Pool ceilings come from the environment; a typo must not become a NaN-sized
 * pool, so anything but a positive integer stops startup.
 * @param {string} name
 * @param {unknown} value
 * @returns {number}
 */
function poolSize(name, value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`${name} must be a positive integer (got ${String(value)})`);
  }
  return size;
}

const applicationConnection = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

// The pools are declared with the application's pool contract rather than the
// pg class so the integration tests can pin query/connect doubles on them.
/** @type {DbPool} */
export const pool = new Pool({
  ...applicationConnection,
  max: poolSize("DB_POOL_MAX", config.DB_POOL_MAX),
});

// A request retains its client until its response finishes. Transactions need
// independent capacity or a full request pool would wait on its own releases.
/** @type {DbPool} */
export const transactionPool = new Pool({
  ...applicationConnection,
  max: poolSize("DB_TX_POOL_MAX", config.DB_TX_POOL_MAX),
});

/** @type {DbPool} */
export const migrationPool =
  config.DB_MIGRATIONS_USER || config.DB_MIGRATIONS_PASSWORD
    ? new Pool({
        host: config.DB_HOST,
        port: config.DB_PORT,
        database: config.DB_NAME,
        user: config.DB_MIGRATIONS_USER || config.DB_USER,
        password: config.DB_MIGRATIONS_PASSWORD || config.DB_PASSWORD,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      })
    : pool;

/** @type {Promise<void> | undefined} */
let closePromise;
export function closeDatabase() {
  // The migration pool can alias the request pool; end every distinct pool
  // once, including when shutdown hooks call closeDatabase concurrently.
  closePromise ??= Promise.all(
    [...new Set([pool, transactionPool, migrationPool])].map((value) => value.end()),
  ).then(() => {});
  return closePromise;
}
