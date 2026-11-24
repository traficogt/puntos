import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIENCE_TECHNICAL_CEILING,
  IMPORT_CHUNK_ROWS,
  IMPORT_FILE_ROWS,
  PREPARATION_CHUNK,
  SYNC_AUDIENCE_LIMIT,
  assertAudienceWithinPlan,
  audienceCeiling,
  importChunk,
  planAudienceLimit,
  scaleLimitsTable,
} from "../../src/app/services/scale-limits.js";
import { migrationLimits } from "../../src/app/services/customer-migration-csv.js";
import { largeImportLimits } from "../../src/app/services/customer-import-job-service.js";

describe("scale limits", () => {
  it("derives the campaign audience limit from the plan's customer soft cap", () => {
    assert.deepEqual(
      scaleLimitsTable().map((row) => [
        row.plan,
        row.name,
        row.audience_limit,
        row.audience_ceiling,
      ]),
      [
        ["EMPRENDEDOR", "Conecta", 300, 300],
        ["NEGOCIO", "Impulsa", 2000, 2000],
        ["EMPRESA", "Expande", null, AUDIENCE_TECHNICAL_CEILING],
      ],
    );
    assert.equal(planAudienceLimit("negocio"), 2000, "plan names are normalized");
    assert.equal(planAudienceLimit("unknown"), 300, "unknown plans fall back to the smallest");
    assert.equal(audienceCeiling("EMPRESA"), 5000);
    assert.equal(AUDIENCE_TECHNICAL_CEILING, 5000, "matches the customer_ids CHECK");
    assert.ok(SYNC_AUDIENCE_LIMIT < PREPARATION_CHUNK, "one worker chunk covers a sync request");
  });

  it("explains a plan limit or the ceiling in Spanish with a stable code", () => {
    assert.doesNotThrow(() => assertAudienceWithinPlan("NEGOCIO", 2000));
    assert.doesNotThrow(() => assertAudienceWithinPlan("EMPRESA", 5000));
    assert.doesNotThrow(() => assertAudienceWithinPlan("EMPRENDEDOR", 300));
    assert.throws(
      () => assertAudienceWithinPlan("NEGOCIO", 2001),
      (/** @type {any} */ error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "PLAN_AUDIENCE_LIMIT");
        assert.match(error.message, /plan Impulsa permite hasta 2,000 clientes por campaña/);
        return true;
      },
    );
    assert.throws(() => assertAudienceWithinPlan("EMPRENDEDOR", 301), /plan Conecta .* 300/);
    assert.throws(
      () => assertAudienceWithinPlan("EMPRESA", 5001),
      (/** @type {any} */ error) => {
        assert.equal(error.code, "AUDIENCE_CEILING");
        assert.match(error.message, /hasta 5,000 clientes/);
        return true;
      },
    );
  });

  it("computes import chunks from the persisted cursor so restarts resume the same rows", () => {
    assert.equal(IMPORT_CHUNK_ROWS, 200);
    assert.deepEqual(importChunk(0, 250), { start: 0, end: 200, index: 1, chunks: 2 });
    assert.deepEqual(importChunk(200, 250), { start: 200, end: 250, index: 2, chunks: 2 });
    assert.deepEqual(importChunk(250, 250), { start: 250, end: 250, index: 2, chunks: 2 });
    assert.deepEqual(importChunk(0, 150), { start: 0, end: 150, index: 1, chunks: 1 });
    // A 2,000-customer Impulsa file is ten chunks, never one request.
    assert.equal(importChunk(0, 2000).chunks, 10);
    assert.equal(importChunk(0, IMPORT_FILE_ROWS).chunks, 25, "stays under the 50 batch_ids CHECK");
    // Replaying the same cursor yields the same window (idempotent resumption).
    assert.deepEqual(importChunk(400, 1000), importChunk(400, 1000));
    assert.deepEqual(importChunk(-5, 10), { start: 0, end: 10, index: 1, chunks: 1 });
  });

  it("keeps one synchronous request at one chunk's worth of rows", () => {
    assert.equal(migrationLimits.rows, IMPORT_CHUNK_ROWS);
    assert.equal(largeImportLimits.rows, IMPORT_FILE_ROWS);
  });
});
