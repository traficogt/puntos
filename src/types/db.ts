import type { PoolConfig, QueryResult, QueryResultBase, QueryResultRow, QueryValues } from "pg";

/*
 * Row types default to `any`, as in the upstream pg typings: column values are
 * whatever the statement produced and repositories coerce the ones they read.
 *
 * Two tiers describe the database layer.
 *
 * The strict tier (`DbQueryResult`, `DbClient`, ...) is what application code
 * receives from `dbQuery`, `withTransaction`, `withDbClientContext` and
 * `req.pgClient`: a real pg connection whose results carry the full statement
 * metadata.
 *
 * The loose tier (`...Like`, `DbPool`, `DbContext`) is the contract the pools
 * and the AsyncLocalStorage context are declared with. It admits what the
 * integration tests pin in place of a connection: `pg.Client` instances, plain
 * `{ query }` objects and doubles that answer `{ rows }` without metadata.
 * src/app/db converts from the loose to the strict tier at its boundaries.
 */

/**
 * Statement result as the application inspects it. `rowCount` is the count pg
 * reports for the INSERT/UPDATE/DELETE statements this code checks; pg reports
 * `null` only for statements without a count (BEGIN, SET, DDL), which nothing
 * here reads.
 */
export interface DbQueryResult<R extends QueryResultRow = any> extends Omit<
  QueryResult<R>,
  "rowCount"
> {
  rowCount: number;
}

/** A query function with the `pg` call shape, e.g. `dbQuery` or `client.query`. */
export type DbQueryFn = <R extends QueryResultRow = any>(
  sql: string,
  params?: QueryValues,
) => Promise<DbQueryResult<R>>;

/** A connection as application code receives it. */
export interface DbClient {
  query: DbQueryFn;
}

/** A pooled connection: `release(true)` or `release(error)` discards it. */
export interface DbPooledClient extends DbClient {
  release(err?: Error | boolean): void;
}

/** A pooled connection that also surfaces socket errors while a transaction is open. */
export interface DbTransactionClient extends DbPooledClient {
  on(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
}

/** Loose result: `rows` always, statement metadata only when the driver supplies it. */
export interface DbQueryResultLike<
  R extends QueryResultRow = any,
> extends Partial<QueryResultBase> {
  rows: R[];
}

/**
 * Anything that can run a parameterized query. The context layer never reads
 * the result (it only applies session settings), so doubles may resolve to
 * anything.
 */
export interface DbClientLike {
  query(sql: string, values?: QueryValues): Promise<unknown>;
}

export interface DbPooledClientLike extends DbClientLike {
  query(sql: string, values?: QueryValues): Promise<DbQueryResultLike>;
  release(err?: Error | boolean): void;
}

export interface DbTransactionClientLike extends DbPooledClientLike {
  on(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
}

/** The pool contract the application relies on; satisfied by `pg.Pool`. */
export interface DbPool<C extends DbPooledClientLike = DbPooledClientLike> {
  query(sql: string, values?: QueryValues): Promise<DbQueryResultLike>;
  connect(): Promise<C>;
  end(): Promise<void>;
  readonly options: PoolConfig;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

/**
 * Per-operation database context carried in AsyncLocalStorage
 * (src/app/db/context.js). The connection, when pinned, travels with the
 * tenant and privilege flags that were applied to it as session settings.
 */
export interface DbContext {
  /** Pinned connection; absent when the shared pool is used directly. */
  client?: DbClientLike;
  tenantId?: string | null;
  platformAdmin?: boolean;
  webhookIngest?: boolean;
}

/**
 * Flags a caller may set for the duration of `withDbClientContext`. A key that
 * is present (even as `null`/`undefined`) overrides the inherited value; an
 * absent key keeps the parent context's value.
 */
export type DbContextOverrides = Partial<
  Pick<DbContext, "tenantId" | "platformAdmin" | "webhookIngest">
>;
