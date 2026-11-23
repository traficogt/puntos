import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { transactionPool, withTransaction } from "../../src/app/database.js";

const originalConnect = transactionPool.connect;
afterEach(() => {
  transactionPool.connect = originalConnect;
});

test("transaction connection loss retains the original rejection and discards the broken client", async () => {
  const original = Object.assign(new Error("fixture backend terminated"), { code: "57P01" });
  const disconnected = new Error("fixture connection terminated unexpectedly");
  const releases = [],
    queries = [];
  const client = Object.assign(new EventEmitter(), {
    async query(sql) {
      queries.push(sql);
      if (sql === "fixture award") throw original;
      if (sql === "ROLLBACK") {
        client.emit("error", disconnected);
        throw disconnected;
      }
      return { rows: [] };
    },
    release(destroy) {
      releases.push(Boolean(destroy));
    },
  });
  transactionPool.connect = async () => client;
  await assert.rejects(
    withTransaction((value) => value.query("fixture award")),
    (error) => error === original,
  );
  assert.deepEqual(releases, [true], "A failed rollback must evict the connection");
  assert.deepEqual(
    queries,
    ["BEGIN", "fixture award", "ROLLBACK"],
    "Do not reset session state over a dead connection",
  );
  assert.equal(client.listenerCount("error"), 0, "The operation must remove its error listener");
});

test("a failed transaction reset discards its client after a successful commit", async () => {
  const releases = [];
  const client = Object.assign(new EventEmitter(), {
    async query(sql) {
      if (sql.includes("set_config")) throw new Error("fixture reset failed");
      return { rows: [] };
    },
    release(destroy) {
      releases.push(Boolean(destroy));
    },
  });
  transactionPool.connect = async () => client;
  assert.equal(await withTransaction(async () => "committed"), "committed");
  assert.deepEqual(releases, [true]);
  assert.equal(client.listenerCount("error"), 0);
});

test("an ordinary application rollback preserves the connection for reuse", async () => {
  const releases = [],
    queries = [];
  const client = Object.assign(new EventEmitter(), {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
    release(destroy) {
      releases.push(Boolean(destroy));
    },
  });
  transactionPool.connect = async () => client;
  const failure = new Error("fixture validation failed");
  await assert.rejects(
    withTransaction(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(releases, [false]);
  assert.equal(queries[1], "ROLLBACK");
  assert.match(queries[2], /set_config/);
  assert.equal(client.listenerCount("error"), 0);
});
