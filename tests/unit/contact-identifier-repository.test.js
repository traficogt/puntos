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

test("contact identifier create trims values and passes meta as json", async () => {
  const calls = [];
  const row = {
    id: "identifier-1",
    business_id: "business-1",
    customer_id: "customer-1",
    identifier_type: "loyalty_card",
    identifier_value: "ABC123",
    label: "VIP",
    active: true,
    meta: { source: "api" }
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const created = await ContactIdentifierRepo.create(client, {
    id: "identifier-1",
    business_id: "business-1",
    customer_id: "customer-1",
    identifier_type: "loyalty_card",
    identifier_value: " ABC123 ",
    label: "VIP",
    meta: { source: "api" }
  });

  assert.equal(created, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO contact_identifiers/i);
  assert.deepEqual(calls[0].params, [
    "identifier-1",
    "business-1",
    "customer-1",
    "loyalty_card",
    "ABC123",
    "VIP",
    true,
    { source: "api" }
  ]);
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

test("contact identifier migrations sort table before dedicated RLS", () => {
  const files = [
    "2026-04-15-contact-identifiers.sql",
    "2026-04-15-contact-identifiers_rls.sql"
  ];

  assert.deepEqual([...files].sort(), files);
});

test("contact identifier RLS lives in the dedicated migration", () => {
  const tableSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-contact-identifiers.sql", import.meta.url),
    "utf8"
  );
  const rlsSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-contact-identifiers_rls.sql", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(tableSource, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(tableSource, /CREATE POLICY tenant_isolation ON contact_identifiers/i);
  assert.match(rlsSource, /ENABLE ROW LEVEL SECURITY/);
  assert.match(rlsSource, /FORCE ROW LEVEL SECURITY/);
  assert.match(rlsSource, /CREATE POLICY tenant_isolation ON contact_identifiers/i);
});
