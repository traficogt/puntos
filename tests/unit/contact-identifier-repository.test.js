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
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/i);
  assert.deepEqual(calls[0].params, ["business-1", "loyalty_card", "ABC123"]);
});

test("contact identifier lookup can include inactive rows when needed", async () => {
  const calls = [];
  const row = {
    id: "identifier-1",
    business_id: "business-1",
    identifier_type: "loyalty_card",
    identifier_value: "ABC123",
    active: false
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const found = await ContactIdentifierRepo.getAnyByBusinessTypeAndValue(
    client,
    "business-1",
    "loyalty_card",
    " ABC123 "
  );

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM contact_identifiers/i);
  assert.doesNotMatch(calls[0].sql, /AND active = true/i);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/i);
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
  assert.match(calls[0].sql, /WITH target AS/i);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/i);
  assert.match(calls[0].sql, /UPDATE contact_identifiers/i);
  assert.match(calls[0].sql, /SET active = false/i);
  assert.match(calls[0].sql, /updated_at = now\(\)/i);
  assert.deepEqual(calls[0].params, ["business-1", "loyalty_card", "ABC123"]);
});

test("contact identifier listing stays business scoped", async () => {
  const calls = [];
  const rows = [
    {
      id: "identifier-1",
      business_id: "business-1",
      customer_id: "customer-1"
    }
  ];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };

  const found = await ContactIdentifierRepo.listByCustomer(
    client,
    "business-1",
    "customer-1"
  );

  assert.equal(found, rows);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE business_id = \$1/i);
  assert.match(calls[0].sql, /AND customer_id = \$2/i);
  assert.deepEqual(calls[0].params, ["business-1", "customer-1"]);
});

test("contact identifier migrations sort table before dedicated RLS", () => {
  // Fixed repository migration paths; no user-controlled filesystem input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = fs.readdirSync(new URL("../../src/app/migrations", import.meta.url))
    .filter((file) => file.includes("contact-identifiers"))
    .sort();

  assert.deepEqual(files, [
    "2026-04-15-contact-identifiers.sql",
    "2026-04-15-contact-identifiers_rls.sql",
    "2026-04-16-contact-identifiers-trim.sql"
  ]);
});

test("contact identifier RLS lives in the dedicated migration", () => {
  // Fixed repository migration paths; no user-controlled filesystem input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const tableSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-contact-identifiers.sql", import.meta.url),
    "utf8"
  );
  // Fixed repository migration paths; no user-controlled filesystem input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
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

test("contact identifier trim hardening lives in a later migration", () => {
  // Fixed repository migration paths; no user-controlled filesystem input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const trimSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-16-contact-identifiers-trim.sql", import.meta.url),
    "utf8"
  );

  assert.match(trimSource, /ALTER TABLE contact_identifiers/i);
  assert.match(trimSource, /NOT VALID/i);
  assert.match(trimSource, /UPDATE contact_identifiers/i);
  assert.match(trimSource, /VALIDATE CONSTRAINT/i);
  assert.match(trimSource, /RAISE EXCEPTION/i);
  assert.match(trimSource, /COUNT\(DISTINCT customer_id\)/i);
  assert.match(trimSource, /row_number\(\) OVER \([\s\S]*PARTITION BY[\s\S]*business_id[\s\S]*identifier_type[\s\S]*customer_id/i);
  assert.match(trimSource, /DELETE FROM contact_identifiers/i);
  assert.match(trimSource, /regexp_replace\(/i);
  assert.match(trimSource, /\[\[:space:\]\]/i);
  assert.doesNotMatch(trimSource, /btrim/i);
});
