import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { pool, getDbContext } from "../../src/app/database.js";
import { withPgClient } from "../../src/middleware/pg-client.js";

const originalConnect = pool.connect;
afterEach(() => {
  pool.connect = originalConnect;
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(query = async () => ({ rows: [] })) {
  const queries = [],
    releases = [],
    nextCalls = [];
  const client = {
    query(sql) {
      queries.push(sql);
      return query();
    },
    release(destroy) {
      releases.push({ destroy: Boolean(destroy) });
    },
  };
  const req = { aborted: false, pgClient: undefined };
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
    writableEnded: false,
  });
  const next = (error) => {
    nextCalls.push({ error, context: getDbContext() });
  };
  pool.connect = async () => client;
  return { client, queries, releases, nextCalls, req, res, next };
}

test("premature response close discards its client without resetting a still-running request", async () => {
  const pendingQuery = deferred();
  const f = fixture(() => pendingQuery.promise);
  withPgClient(f.req, f.res, f.next);
  await flush();
  assert.equal(f.nextCalls.length, 1);

  // The handler can still be awaiting work when navigation closes its response.
  const handlerQuery = f.client.query("SELECT fictional_request_work");
  f.res.destroyed = true;
  f.res.emit("close");
  assert.deepEqual(f.releases, [{ destroy: true }]);
  assert.deepEqual(
    f.queries,
    ["SELECT fictional_request_work"],
    "no tenant reset is queued behind the request query",
  );

  pendingQuery.resolve({ rows: [] });
  await handlerQuery;
  f.res.emit("finish");
  f.res.emit("close");
  await flush();
  assert.deepEqual(
    f.releases,
    [{ destroy: true }],
    "late events cannot return the discarded client",
  );
});

test("a response that closes while pool acquisition is pending never enters the handler", async () => {
  const f = fixture(),
    acquisition = deferred();
  pool.connect = () => acquisition.promise;
  withPgClient(f.req, f.res, f.next);
  f.res.emit("close");
  acquisition.resolve(f.client);
  await flush();
  assert.deepEqual(f.nextCalls, []);
  assert.equal(f.req.pgClient, undefined);
  assert.deepEqual(f.queries, []);
  assert.deepEqual(f.releases, [{ destroy: true }]);
});

for (const state of ["response destroyed", "request aborted"]) {
  test(`already ${state} before acquisition discards the client and does not call next`, async () => {
    const f = fixture(),
      acquisition = deferred();
    pool.connect = () => acquisition.promise;
    if (state === "response destroyed") f.res.destroyed = true;
    else f.req.aborted = true;
    withPgClient(f.req, f.res, f.next);
    acquisition.resolve(f.client);
    await flush();
    assert.deepEqual(f.nextCalls, []);
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.releases, [{ destroy: true }]);
  });
}

test("finish followed by close resets all request settings before returning the client exactly once", async () => {
  const reset = deferred();
  const f = fixture(() => reset.promise);
  withPgClient(f.req, f.res, f.next);
  await flush();
  assert.equal(f.req.pgClient, f.client);
  assert.deepEqual(f.nextCalls, [
    { error: undefined, context: { client: f.client, tenantId: null, platformAdmin: false } },
  ]);
  f.res.writableFinished = true;
  f.res.emit("finish");
  f.res.emit("close");
  f.res.emit("finish");
  assert.deepEqual(f.releases, [], "the pool cannot reuse this client until reset completes");
  assert.equal(f.queries.length, 1);
  for (const setting of ["app.current_tenant", "app.platform_admin", "app.webhook_ingest"]) {
    assert.ok(f.queries[0].includes(`set_config('${setting}', '', false)`));
  }
  reset.resolve({ rows: [] });
  await flush();
  f.res.emit("close");
  assert.deepEqual(f.releases, [{ destroy: false }]);
});

test("failed reset discards the connection instead of returning its uncleared state to the pool", async () => {
  const reset = deferred();
  const f = fixture(() => reset.promise);
  withPgClient(f.req, f.res, f.next);
  await flush();
  f.res.writableFinished = true;
  f.res.emit("finish");
  f.res.emit("close");
  reset.reject(new Error("fixture reset failed"));
  await flush();
  assert.deepEqual(f.releases, [{ destroy: true }]);
  assert.equal(f.nextCalls.length, 1, "a completed response is not sent back through the handler");
});

test("pool acquisition failure still reaches the existing Express error path", async () => {
  const f = fixture(),
    error = new Error("fixture connection failure");
  pool.connect = async () => {
    throw error;
  };
  withPgClient(f.req, f.res, f.next);
  await flush();
  assert.deepEqual(f.nextCalls, [{ error, context: null }]);
  assert.equal(f.req.pgClient, undefined);
  assert.deepEqual(f.releases, []);
  assert.equal(f.res.listenerCount("close"), 0);
});
