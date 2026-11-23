import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseWorkloadOptions,
  assertWorkloadHost,
  workloadEnvironment,
  assertFixtureState,
  summarizeMeasurements,
  startResponseDropProxy,
} from "../../src/scripts/workload-lib.mjs";

test("workload requires explicit opt-in and rejects targets, unbounded counts and ambiguous options", () => {
  assert.throws(() => parseWorkloadOptions([]), /--run/);
  assert.deepEqual(parseWorkloadOptions(["--run"]), {
    reads: 60,
    purchases: 6,
    concurrency: 4,
    maxP95Ms: 1000,
  });
  for (const args of [
    ["--base-url", "https://example.com"],
    ["--reads", "0"],
    ["--reads", "241"],
    ["--purchases", "21"],
    ["--concurrency", "9"],
    ["--concurrency", "1.2"],
    ["--reads", "NaN"],
    ["--max-p95-ms", "Infinity"],
    ["--run"],
    ["--reads", "4", "--reads", "5"],
  ])
    assert.throws(() => parseWorkloadOptions(["--run", ...args]));
});

test("CLI refuses production configuration before Docker and private scenario refuses direct host execution", () => {
  const launcher = fileURLToPath(
    new URL("../../src/scripts/run-workload-isolated.mjs", import.meta.url),
  );
  const scenario = fileURLToPath(new URL("../workload/scenario.mjs", import.meta.url));
  const clean = { PATH: process.env.PATH, NODE_ENV: "production" };
  const refused = spawnSync(process.execPath, [launcher, "--run"], {
    env: clean,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Production environment/);
  assert.doesNotMatch(refused.stdout, /Starting disposable/);
  const direct = spawnSync(process.execPath, [scenario, "--run"], {
    env: clean,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /Use the isolated workload launcher/);
});

test("recovery fault forwards one request, consumes the committed response and disconnects its caller", async (t) => {
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    assert.deepEqual(JSON.parse(body), { txId: "stable-fixture-id" });
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, committed: true }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", () => resolve(undefined)));
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  const address = upstream.address();
  assert.ok(address && typeof address === "object");
  const proxy = await startResponseDropProxy(`http://127.0.0.1:${address.port}`);
  try {
    await assert.rejects(
      fetch(`${proxy.url}/api/staff/award`, {
        method: "POST",
        body: JSON.stringify({ txId: "stable-fixture-id" }),
        signal: AbortSignal.timeout(2000),
      }),
    );
    assert.deepEqual(await proxy.observed, { status: 200, body: { ok: true, committed: true } });
    assert.equal(calls, 1);
  } finally {
    await proxy.close();
  }
});

test("workload refuses inherited target configuration and keeps provider credentials out of its stack", () => {
  for (const env of [
    { NODE_ENV: "production" },
    { DB_HOST: "127.0.0.1" },
    { DATABASE_URL: "private" },
    { LOAD_BASE_URL: "https://example.com" },
    { TEST_API_URL: "http://localhost:3001" },
    { DOCKER_HOST: "tcp://remote" },
    { NODE_OPTIONS: "--require=private" },
  ])
    assert.throws(() => assertWorkloadHost(env));
  assert.doesNotThrow(() => assertWorkloadHost({ NODE_ENV: "test" }));
  const env = workloadEnvironment("ephemeral-fixture-password");
  assert.equal(env.DB_NAME, "workload_test");
  assert.equal(env.DB_HOST, "db");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.MESSAGE_PROVIDER, "dev");
  assert.equal(env.IN_PROCESS_WORKERS, "false");
  assert.equal(env.PF_DISPOSABLE_WORKLOAD, "1");
  assert.equal(env.SMTP_PASSWORD, undefined);
  assert.equal(env.SUPER_ADMIN_PASSWORD, undefined);
});

const purchase = {
  id: "p1",
  source: "online",
  points: 10,
  status: "REVERSED",
  reversed_transaction_id: "r1",
};
const reversal = {
  id: "r1",
  source: "reversal",
  points: -10,
  status: "POSTED",
  original_transaction_id: "p1",
  request_id: "q1",
};
const state = () => ({
  transactions: [{ ...purchase }, { ...reversal }],
  balance: { points: 0, pending_points: 0, lifetime_points: 0 },
});
const expected = { purchaseIds: ["p1"], refunds: [{ transactionId: "p1", requestId: "q1" }] };

test("correctness rejects duplicate effects even when the final point sum is zero", () => {
  assert.doesNotThrow(() => assertFixtureState(state(), expected));
  const duplicate = state();
  duplicate.transactions.push({ ...purchase, id: "p2" }, { ...reversal, id: "r2" });
  assert.throws(() => assertFixtureState(duplicate, expected), /transaction count/);
});

test("correctness verifies exact purchase and refund identities, balances and original state", () => {
  for (const mutate of [
    (s) => {
      s.balance.points = 10;
    },
    (s) => {
      s.balance.pending_points = 10;
    },
    (s) => {
      s.balance.lifetime_points = 10;
    },
    (s) => {
      s.transactions[0].status = "POSTED";
    },
    (s) => {
      s.transactions[1].request_id = "other";
    },
    (s) => {
      s.transactions[1].original_transaction_id = "other";
    },
    (s) => {
      s.transactions[1].points = 0;
    },
    (s) => {
      s.transactions[0].id = "other";
    },
  ]) {
    const wrong = state();
    mutate(wrong);
    assert.throws(() => assertFixtureState(wrong, expected));
  }
  assert.doesNotThrow(() =>
    assertFixtureState(
      {
        transactions: [{ ...purchase, status: "POSTED", reversed_transaction_id: null }],
        balance: { points: 10, pending_points: 0, lifetime_points: 10 },
      },
      { purchaseIds: ["p1"], refunds: [] },
    ),
  );
});

test("latency samples, actual errors and deliberately interrupted responses are separate", () => {
  assert.deepEqual(
    summarizeMeasurements([
      { label: "read", durationMs: 10, outcome: "ok" },
      { label: "read", durationMs: 20, outcome: "ok" },
      { label: "read", durationMs: 30, outcome: "error" },
      { label: "recovery-drop", durationMs: 50, outcome: "interrupted" },
    ]),
    [
      {
        label: "read",
        requests: 3,
        successes: 2,
        errors: 1,
        interrupted: 0,
        latencySamples: 3,
        avgMs: 20,
        p95Ms: 30,
        maxMs: 30,
      },
      {
        label: "recovery-drop",
        requests: 1,
        successes: 0,
        errors: 0,
        interrupted: 1,
        latencySamples: 1,
        avgMs: 50,
        p95Ms: 50,
        maxMs: 50,
      },
    ],
  );
});
