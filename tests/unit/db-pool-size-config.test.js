import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { config } from "../../src/config/index.js";
import { pool, transactionPool } from "../../src/app/db/pools.js";

function loadPools(overrides = {}) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, NODE_OPTIONS: "", NODE_ENV: "test" };
  delete env.DB_POOL_MAX;
  delete env.DB_TX_POOL_MAX;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        "const { config } = await import('./src/config/index.js');",
        "const { pool, transactionPool } = await import('./src/app/db/pools.js');",
        "process.stdout.write(JSON.stringify({",
        "  configured: [config.DB_POOL_MAX, config.DB_TX_POOL_MAX],",
        "  max: [pool.options.max, transactionPool.options.max],",
        "}));",
      ].join("\n"),
    ],
    { cwd: process.cwd(), env: { ...env, ...overrides }, encoding: "utf8" },
  );
}

test("pool ceilings in this process match the configured values", () => {
  assert.equal(pool.options.max, config.DB_POOL_MAX);
  assert.equal(transactionPool.options.max, config.DB_TX_POOL_MAX);
});

test("DB_POOL_MAX and DB_TX_POOL_MAX default to 20 and 10, including when left empty", () => {
  for (const overrides of [{}, { DB_POOL_MAX: "", DB_TX_POOL_MAX: "" }]) {
    const result = loadPools(overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { configured: [20, 10], max: [20, 10] });
  }
});

test("DB_POOL_MAX and DB_TX_POOL_MAX size the request and transaction pools", () => {
  const result = loadPools({ DB_POOL_MAX: "7", DB_TX_POOL_MAX: "3" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { configured: [7, 3], max: [7, 3] });
});

test("a pool ceiling that is not a positive integer stops startup", () => {
  for (const [name, value] of [
    ["DB_POOL_MAX", "abc"],
    ["DB_TX_POOL_MAX", "0"],
    ["DB_POOL_MAX", "2.5"],
  ]) {
    const result = loadPools({ [name]: value });
    assert.notEqual(result.status, 0, `${name}=${value}`);
    assert.match(result.stderr, new RegExp(`${name} must be a positive integer`));
  }
});
