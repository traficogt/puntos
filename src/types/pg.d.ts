/**
 * Hand-maintained declaration for the `pg` driver: the dependency tree carries
 * no `@types/pg`, so without this file every import of "pg" resolves to `any`.
 * Only the surface this codebase uses is declared; shapes follow the upstream
 * DefinitelyTyped definitions so a later switch to `@types/pg` is a no-op.
 */
declare module "pg" {
  import { EventEmitter } from "node:events";
  import type { ConnectionOptions } from "node:tls";

  export interface ClientConfig {
    user?: string;
    database?: string;
    password?: string | (() => string | Promise<string>);
    port?: number;
    host?: string;
    connectionString?: string;
    keepAlive?: boolean;
    statement_timeout?: number | false;
    query_timeout?: number;
    lock_timeout?: number;
    application_name?: string;
    connectionTimeoutMillis?: number;
    idle_in_transaction_session_timeout?: number;
    ssl?: boolean | ConnectionOptions;
    options?: string;
  }

  export interface PoolConfig extends ClientConfig {
    max?: number;
    min?: number;
    idleTimeoutMillis?: number | null;
    maxUses?: number;
    maxLifetimeSeconds?: number;
    allowExitOnIdle?: boolean;
    log?: (...messages: unknown[]) => void;
  }

  /**
   * One result row. Column values are untyped by the driver; as upstream, the
   * row type parameter defaults to `any` so repositories can narrow or coerce
   * the columns they read without a cast at every call.
   */
  export interface QueryResultRow {
    [column: string]: any;
  }

  export interface FieldDef {
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
    dataTypeSize: number;
    dataTypeModifier: number;
    format: string;
  }

  export interface QueryResultBase {
    command: string;
    /** Null for statements that report no affected-row count (upstream shape). */
    rowCount: number | null;
    oid: number;
    fields: FieldDef[];
  }

  export interface QueryResult<R extends QueryResultRow = any> extends QueryResultBase {
    rows: R[];
  }

  export interface QueryConfig<I extends readonly unknown[] = readonly unknown[]> {
    name?: string;
    text: string;
    values?: I;
    rowMode?: "array";
  }

  /** Bound parameter values; the driver serializes each one itself. */
  export type QueryValues = readonly unknown[];

  export interface Notification {
    processId: number;
    channel: string;
    payload?: string;
  }

  export class ClientBase extends EventEmitter {
    query<R extends QueryResultRow = any>(
      queryText: string | QueryConfig,
      values?: QueryValues,
    ): Promise<QueryResult<R>>;
    escapeIdentifier(str: string): string;
    escapeLiteral(str: string): string;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "notice", listener: (notice: Error) => void): this;
    on(event: "notification", listener: (message: Notification) => void): this;
    on(event: "end", listener: () => void): this;
    // The untyped overload is inherited from Node's EventEmitter and must be
    // restated so the specific overloads above remain assignable to the base.
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }

  export class Client extends ClientBase {
    constructor(config?: string | ClientConfig);
    connect(): Promise<void>;
    end(): Promise<void>;
  }

  export interface PoolClient extends ClientBase {
    /** Return the connection; `true` or an error discards it instead. */
    release(err?: Error | boolean): void;
  }

  export class Pool extends EventEmitter {
    constructor(config?: PoolConfig);
    /** The configuration the pool was created with, defaults applied. */
    readonly options: PoolConfig;
    readonly totalCount: number;
    readonly idleCount: number;
    readonly waitingCount: number;
    readonly ended: boolean;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    query<R extends QueryResultRow = any>(
      queryText: string | QueryConfig,
      values?: QueryValues,
    ): Promise<QueryResult<R>>;
    on(event: "error", listener: (err: Error, client: PoolClient) => void): this;
    on(
      event: "connect" | "acquire" | "release" | "remove",
      listener: (client: PoolClient) => void,
    ): this;
    // See ClientBase.on.
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }

  export class DatabaseError extends Error {
    readonly length: number;
    readonly name: string;
    severity?: string;
    code?: string;
    detail?: string;
    hint?: string;
    position?: string;
    internalPosition?: string;
    internalQuery?: string;
    where?: string;
    schema?: string;
    table?: string;
    column?: string;
    dataType?: string;
    constraint?: string;
    file?: string;
    line?: string;
    routine?: string;
  }

  export const types: {
    setTypeParser(oid: number, parser: (value: string) => unknown): void;
    getTypeParser(oid: number): (value: string) => unknown;
    builtins: Record<string, number>;
  };

  export function escapeIdentifier(str: string): string;
  export function escapeLiteral(str: string): string;

  const pg: {
    Pool: typeof Pool;
    Client: typeof Client;
    DatabaseError: typeof DatabaseError;
    types: typeof types;
    escapeIdentifier: typeof escapeIdentifier;
    escapeLiteral: typeof escapeLiteral;
  };
  export default pg;
}
