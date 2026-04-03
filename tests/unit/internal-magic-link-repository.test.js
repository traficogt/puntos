import { test } from "node:test";
import assert from "node:assert/strict";

import { InternalMagicLinkRepo } from "../../src/app/repositories/internal-magic-link-repository.js";

test("internal magic link repository creates rows in internal_magic_links", async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 1 };
  };

  const result = await InternalMagicLinkRepo.create({
    id: "b8a08e7e-4ed4-4d0c-8bcb-1e4dd72f1d6f",
    actor_type: "staff",
    actor_id: "5e9c2c48-b72d-4e7f-9608-5eb5d6b2d4d1",
    business_id: "18f4bd6c-84c7-4f87-a66b-16f8e1f5e0ed",
    target: "staff",
    usage_mode: "single_use",
    purpose: "internal_test_access",
    token_hash: "hashed-token",
    created_by: "test-suite",
    expires_at: "2026-04-04T00:00:00.000Z"
  }, query);

  assert.deepEqual(result, {
    id: "b8a08e7e-4ed4-4d0c-8bcb-1e4dd72f1d6f"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO internal_magic_links/i);
  assert.deepEqual(calls[0].params, [
    "b8a08e7e-4ed4-4d0c-8bcb-1e4dd72f1d6f",
    "staff",
    "5e9c2c48-b72d-4e7f-9608-5eb5d6b2d4d1",
    "18f4bd6c-84c7-4f87-a66b-16f8e1f5e0ed",
    "staff",
    "single_use",
    "internal_test_access",
    "hashed-token",
    "test-suite",
    "2026-04-04T00:00:00.000Z"
  ]);
});

test("internal magic link repository looks up rows by token hash", async () => {
  const calls = [];
  const row = {
    id: "b8a08e7e-4ed4-4d0c-8bcb-1e4dd72f1d6f",
    token_hash: "hashed-token",
    actor_type: "staff"
  };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [row], rowCount: 1 };
  };

  const found = await InternalMagicLinkRepo.lookupByTokenHash("hashed-token", query);

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM internal_magic_links/i);
  assert.deepEqual(calls[0].params, ["hashed-token"]);
});
