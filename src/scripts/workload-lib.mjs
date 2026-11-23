import assert from "node:assert/strict";
import { createServer } from "node:http";
import { errorMessage } from "../utils/error-shape.js";

/** Drops exactly one completed upstream response. This simulates a lost response after commit,
 * not a crash at an arbitrary point inside a database transaction. @param {string} baseUrl */
export async function startResponseDropProxy(baseUrl) {
  const target = new URL(baseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.protocol, "http:");
  let resolveObserved;
  const observed = new Promise((resolve) => {
    resolveObserved = resolve;
  });
  let used = false;
  const server = createServer(async (req, res) => {
    if (used || req.method !== "POST" || req.url !== "/api/staff/award") {
      res.writeHead(400).end();
      return;
    }
    used = true;
    try {
      let body = "";
      for await (const part of req) body += part;
      const headers = new Headers();
      for (const key of ["cookie", "content-type", "x-csrf-token", "origin"]) {
        if (typeof req.headers[key] === "string") headers.set(key, req.headers[key]);
      }
      const upstream = await fetch(new URL("/api/staff/award", target), {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      const result = { status: upstream.status, body: await upstream.json() };
      resolveObserved(result);
      res.destroy();
    } catch (error) {
      resolveObserved({ error: errorMessage(error) });
      res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    observed,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** @param {string[]} args */
export function parseWorkloadOptions(args) {
  assert.equal(
    args.filter((value) => value === "--run").length,
    1,
    "Pass --run explicitly to create a disposable workload stack",
  );
  const options = { reads: 60, purchases: 6, concurrency: 4, maxP95Ms: 1000 };
  const limits = {
    "--reads": ["reads", 4, 240],
    "--purchases": ["purchases", 1, 20],
    "--concurrency": ["concurrency", 1, 8],
    "--max-p95-ms": ["maxP95Ms", 1, 10000],
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--run") continue;
    assert.ok(Object.hasOwn(limits, flag), `Unsupported workload option: ${flag}`);
    assert.ok(!seen.has(flag), `Repeated workload option: ${flag}`);
    seen.add(flag);
    const [key, min, max] = limits[flag];
    const value = Number(args[++i]);
    assert.ok(
      Number.isInteger(value) && value >= min && value <= max,
      `${flag} must be an integer from ${min} to ${max}`,
    );
    options[key] = value;
  }
  return options;
}

/** @param {NodeJS.ProcessEnv} env */
export function assertWorkloadHost(env) {
  assert.ok(
    !env.NODE_ENV || ["test", "development"].includes(env.NODE_ENV),
    "Production environment is not a workload target",
  );
  for (const key of Object.keys(env)) {
    assert.ok(
      !/^(DB_|DATABASE_URL$|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|LOAD_|TEST_API_URL$|E2E_|DOCKER_|NODE_OPTIONS$|NODE_PATH$)/.test(
        key,
      ),
      `Remove inherited target configuration before running the disposable workload: ${key}`,
    );
  }
}

/** The parent uses this allowlist, never an inherited application environment. @param {string} password */
export function workloadEnvironment(password) {
  return {
    NODE_ENV: "development",
    TZ: "UTC",
    PF_DISPOSABLE_WORKLOAD: "1",
    DB_HOST: "db",
    DB_PORT: "5432",
    DB_NAME: "workload_test",
    DB_USER: "workload_app",
    DB_PASSWORD: password,
    DB_MIGRATIONS_USER: "postgres",
    DB_MIGRATIONS_PASSWORD: password,
    JWT_SECRET: `workload-${password}`,
    MESSAGE_PROVIDER: "dev",
    RATE_LIMIT_DRIVER: "memory",
    IN_PROCESS_WORKERS: "false",
    AUTO_APPLY_MIGRATIONS: "false",
    AUTO_APPLY_SCHEMA_EXTENSIONS: "false",
    APP_ORIGIN: "http://127.0.0.1:3001",
    MARKETING_ORIGIN: "http://127.0.0.1:3001",
    CORS_ORIGIN: "http://127.0.0.1:3001",
    PORT: "3001",
    LOG_LEVEL: "error",
  };
}

/** @param {{transactions: any[], balance: any}} state
 * @param {{purchaseIds: string[], refunds: {transactionId: string, requestId: string}[]}} expected */
export function assertFixtureState({ transactions, balance }, { purchaseIds, refunds }) {
  assert.equal(
    transactions.length,
    purchaseIds.length + refunds.length,
    "fixture transaction count",
  );
  assert.equal(
    new Set(transactions.map((row) => row.id)).size,
    transactions.length,
    "unique transaction IDs",
  );
  for (const id of purchaseIds) {
    const row = transactions.find((item) => item.id === id);
    assert.ok(row, `missing purchase ${id}`);
    assert.equal(row.source, "online");
    assert.equal(Number(row.points), 10);
    const refund = refunds.find((item) => item.transactionId === id);
    assert.equal(row.status, refund ? "REVERSED" : "POSTED");
    if (refund) {
      const reversals = transactions.filter((item) => item.original_transaction_id === id);
      assert.equal(reversals.length, 1, "one reversal per refunded purchase");
      assert.equal(reversals[0].request_id, refund.requestId);
      assert.equal(reversals[0].id, row.reversed_transaction_id);
      assert.equal(reversals[0].source, "reversal");
      assert.equal(reversals[0].status, "POSTED");
      assert.equal(Number(reversals[0].points), -10);
    } else assert.ok(!row.reversed_transaction_id);
  }
  const points = (purchaseIds.length - refunds.length) * 10;
  assert.ok(balance, "fixture customer balance exists");
  assert.equal(Number(balance.points), points, "available points");
  assert.equal(Number(balance.pending_points), 0, "pending points");
  assert.equal(Number(balance.lifetime_points), points, "lifetime points after refunds");
  assert.equal(
    transactions.reduce((sum, row) => sum + Number(row.points), 0),
    points,
    "net transaction effects",
  );
}

/** @typedef {{label: string, durationMs: number, outcome: 'ok'|'error'|'interrupted'}} Measurement */
/** @param {Measurement[]} measurements */
export function summarizeMeasurements(measurements) {
  return [...new Set(measurements.map((row) => row.label))].map((label) => {
    const rows = measurements.filter((row) => row.label === label);
    const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
    const round = (value) => Number(value.toFixed(2));
    return {
      label,
      requests: rows.length,
      successes: rows.filter((row) => row.outcome === "ok").length,
      errors: rows.filter((row) => row.outcome === "error").length,
      interrupted: rows.filter((row) => row.outcome === "interrupted").length,
      latencySamples: durations.length,
      avgMs: round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p95Ms: round(durations[Math.ceil(durations.length * 0.95) - 1]),
      maxMs: round(durations.at(-1)),
    };
  });
}
