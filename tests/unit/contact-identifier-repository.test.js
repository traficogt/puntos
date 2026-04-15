import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ContactIdentifierRepo } from "../../src/app/repositories/contact-identifier-repository.js";

test("contact identifier lookup only returns active rows", async () => {
  const calls = [];
  const row = {
    id: "identifier-1",
    business_id: "business-1",
    identifier_type: "loyalty_card",
    identifier_value: "ABC123",
    active: true
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const found = await ContactIdentifierRepo.getByBusinessTypeAndValue(
    client,
    "business-1",
    "loyalty_card",
    " ABC123 "
  );

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM contact_identifiers/i);
  assert.match(calls[0].sql, /AND active = true/i);
  assert.deepEqual(calls[0].params, ["business-1", "loyalty_card", "ABC123"]);
});

test("contact identifier deactivation marks rows inactive", async () => {
  const calls = [];
  const row = { id: "identifier-1", active: false };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const found = await ContactIdentifierRepo.deactivate(
    client,
    "business-1",
    "loyalty_card",
    " ABC123 "
  );

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE contact_identifiers/i);
  assert.match(calls[0].sql, /SET active = false/i);
  assert.match(calls[0].sql, /updated_at = now\(\)/i);
  assert.deepEqual(calls[0].params, ["business-1", "loyalty_card", "ABC123"]);
});

test("contact identifier table migration enables row level security inline", () => {
  const source = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-contact-identifiers.sql", import.meta.url),
    "utf8"
  );

  assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /FORCE ROW LEVEL SECURITY/);
  assert.match(source, /CREATE POLICY tenant_isolation ON contact_identifiers/i);
});
