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
  assert.match(calls[0].sql, /WHERE token_hash = \$1/i);
  assert.match(calls[0].sql, /AND expires_at > now\(\)/i);
  assert.match(calls[0].sql, /LIMIT 1/i);
  assert.deepEqual(calls[0].params, ["hashed-token"]);
});

test("internal magic link repository returns null when lookup finds no active row", async () => {
  const query = async () => ({ rows: [], rowCount: 0 });

  const found = await InternalMagicLinkRepo.lookupByTokenHash("missing-token", query);

  assert.equal(found, null);
});

test("internal magic link repository consumeSingleUse only updates active single-use rows", async () => {
  const calls = [];
  const row = { id: "link-1" };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [row], rowCount: 1 };
  };

  const found = await InternalMagicLinkRepo.consumeSingleUse("link-1", {
    ip: "127.0.0.1",
    ua: "test-agent"
  }, query);

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE internal_magic_links/i);
  assert.match(calls[0].sql, /WHERE id = \$1/i);
  assert.match(calls[0].sql, /AND usage_mode = 'single_use'/i);
  assert.match(calls[0].sql, /AND expires_at > now\(\)/i);
  assert.match(calls[0].sql, /AND used_at IS NULL/i);
  assert.deepEqual(calls[0].params, ["link-1", "127.0.0.1", "test-agent"]);
});

test("internal magic link repository consumeSingleUse returns null when no row is updated", async () => {
  const query = async () => ({ rows: [], rowCount: 0 });

  const found = await InternalMagicLinkRepo.consumeSingleUse("missing-link", {}, query);

  assert.equal(found, null);
});

test("internal magic link repository touchReusable only updates active reusable rows", async () => {
  const calls = [];
  const row = { id: "link-2" };
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [row], rowCount: 1 };
  };

  const found = await InternalMagicLinkRepo.touchReusable("link-2", {
    used_ip: "10.0.0.2",
    used_ua: "browser"
  }, query);

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE internal_magic_links/i);
  assert.match(calls[0].sql, /WHERE id = \$1/i);
  assert.match(calls[0].sql, /AND usage_mode = 'reusable_window'/i);
  assert.match(calls[0].sql, /AND expires_at > now\(\)/i);
  assert.doesNotMatch(calls[0].sql, /AND used_at IS NULL/i);
  assert.deepEqual(calls[0].params, ["link-2", "10.0.0.2", "browser"]);
});

test("internal magic link repository touchReusable returns null when no row is updated", async () => {
  const query = async () => ({ rows: [], rowCount: 0 });

  const found = await InternalMagicLinkRepo.touchReusable("missing-link", {}, query);

  assert.equal(found, null);
});
