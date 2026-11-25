import { dbQuery } from "../database.js";

/**
 * Positional SQL parameters as `pg` accepts them.
 * @typedef {import("pg").QueryValues} SqlParams
 */

/**
 * The slice of a query result that the repositories read (src/types/db.ts).
 * @template {import("pg").QueryResultRow} [Row=any]
 * @typedef {import("../../types/db.js").DbQueryResultLike<Row>} QueryResult
 */

/**
 * A query function shaped like `dbQuery` (src/types/db.ts).
 * @typedef {import("../../types/db.js").DbQueryFnLike} QueryFn
 */

/**
 * A `pg` pool or client: anything exposing `.query(sql, params)`, such as the
 * client handed to `withTransaction` callbacks or a request's `req.pgClient`
 * (src/types/db.ts `DbQueryClient`).
 * @typedef {import("../../types/db.js").DbQueryClient} DbClient
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
