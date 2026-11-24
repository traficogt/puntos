import { dbQuery } from "../database.js";

/**
 * Positional SQL parameters as `pg` accepts them.
 * @typedef {unknown[]} SqlParams
 */

/**
 * The slice of a `pg` query result that the repositories read. `pg` ships no
 * type declarations in this repository, so the shape is declared here.
 * @template [Row=any]
 * @typedef {{ rows: Row[], rowCount?: number | null }} QueryResult
 */

/**
 * A query function shaped like `dbQuery`.
 * @typedef {(sql: string, params?: SqlParams) => Promise<QueryResult>} QueryFn
 */

/**
 * A `pg` pool or client: anything exposing `.query(sql, params)`, such as the
 * client handed to `withTransaction` callbacks or a request's `req.pgClient`.
 * @typedef {{ query: QueryFn }} DbClient
 */

/**
 * First row of the result, or `null` when the statement returned none.
 * @template [Row=any]
 * @param {string} sql
 * @param {SqlParams} [params]
 * @returns {Promise<Row | null>}
 */
export async function one(sql, params = []) {
  const r = await dbQuery(sql, params);
  return r.rows[0] ?? null;
}

/**
 * Every row of the result.
 * @template [Row=any]
 * @param {string} sql
 * @param {SqlParams} [params]
 * @returns {Promise<Row[]>}
 */
export async function many(sql, params = []) {
  const r = await dbQuery(sql, params);
  return r.rows;
}

/**
 * Runs a statement for its side effect and returns the raw result.
 * @param {string} sql
 * @param {SqlParams} [params]
 * @returns {Promise<QueryResult>}
 */
export async function exec(sql, params = []) {
  return dbQuery(sql, params);
}
