import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProbeErrorBody, createCachedMetricSection } from "../../src/app/routes/observability-shared.js";

describe("observability metric cache", () => {
  it("reuses metric snapshots within the TTL", async () => {
    let now = 1_000;
    let calls = 0;
    const getMetrics = createCachedMetricSection(async () => {
      calls += 1;
      return [`metric_value ${calls}`];
    }, {
      ttlMs: 60_000,
      now: () => now
    });

    assert.deepEqual(await getMetrics(), ["metric_value 1"]);
    assert.deepEqual(await getMetrics(), ["metric_value 1"]);
    assert.equal(calls, 1);

    now += 60_001;
    assert.deepEqual(await getMetrics(), ["metric_value 2"]);
    assert.equal(calls, 2);
  });

  it("deduplicates concurrent refreshes", async () => {
    let calls = 0;
    /** @type {(value?: unknown) => void} */
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const getMetrics = createCachedMetricSection(async () => {
      calls += 1;
      await gate;
      return ["metric_value 1"];
    }, {
      ttlMs: 0,
      now: () => 1_000
    });

    const pendingA = getMetrics();
    const pendingB = getMetrics();
    release();

    assert.deepEqual(await pendingA, ["metric_value 1"]);
    assert.deepEqual(await pendingB, ["metric_value 1"]);
    assert.equal(calls, 1);
  });
});

describe("observability probe helpers", () => {
  it("wraps probe failures in the standard unavailable payload", () => {
    const body = buildProbeErrorBody({ ready: false });
    assert.equal(body.ready, false);
    assert.equal(body.error, "Service unavailable");
    assert.equal(typeof body.timestamp, "string");
    assert.ok(body.timestamp.length > 0);
  });
});
