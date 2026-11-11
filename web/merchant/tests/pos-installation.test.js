import test from "node:test";
import assert from "node:assert/strict";

const model = () => import("../src/pos-installation-model.js");
const profile = { vendor: "odoo", version: "19.0", deployment: "self_hosted", capability: "api", plan: "unknown" };

test("installation routes distinguish native polling from middleware and cloud plan restrictions", async () => {
  const { installationPlan } = await model();
  const loyverse = installationPlan({ vendor: "loyverse" });
  assert.equal(loyverse.mode, "loyverse");
  assert.match(loyverse.detail, /consulta periódica/);
  assert.match(loyverse.prerequisites.join(" "), /customer_id.*phone_number/);
  assert.match(loyverse.prerequisites.join(" "), /moneda y precisión configuradas/);
  for (const plan of ["standard", "free", "unknown"]) {
    const online = installationPlan({ ...profile, deployment: "online", plan });
    assert.equal(online.mode, null);
    assert.match(online.detail, /Custom/);
  }
  assert.equal(installationPlan({ ...profile, deployment: "online", plan: "custom" }).mode, "api");
  assert.equal(installationPlan({ ...profile, deployment: "online", plan: "standard", capability: "csv" }).mode, "csv");
  assert.match(installationPlan(profile).detail, /adaptador/);
  assert.equal(installationPlan({ vendor: "other", capability: "unknown" }).mode, null);
  assert.equal(installationPlan({ vendor: "other", capability: "manual" }).mode, null);
});

test("Odoo prerequisites name the selected version and avoid claiming a tested module", async () => {
  const { installationPlan } = await model();
  assert.match(installationPlan(profile).versionNote, /19\.0.*JSON-2/);
  assert.match(installationPlan({ ...profile, version: "18.0" }).versionNote, /18\.0.*XML-RPC/);
  assert.match(installationPlan({ ...profile, version: "20.0" }).versionNote, /20\.0.*confirmar/i);
  assert.match(installationPlan(profile).prerequisites.join(" "), /no incluye un módulo.*probado/i);
});

test("installation package is an inert versioned handoff with pending acceptance evidence", async () => {
  const { buildInstallationPackage } = await model();
  const pkg = buildInstallationPackage({ ...profile, apiKey: "TOP-SECRET", customerPhone: "PRIVATE-PHONE", connected: true, acceptance: [{ status: "passed" }] });
  assert.equal(pkg.schema, "pf.pos-installation.v1");
  assert.equal(pkg.profile.version, "19.0");
  assert.equal(pkg.status, "preparation_only");
  assert.deepEqual(pkg.configurationTemplate, { mode: "api", enabled: false, automatic: false });
  assert.ok(pkg.acceptance.length >= 6);
  assert.ok(pkg.acceptance.every(step => step.status === "pending" && step.version === "19.0" && !step.completedAt));
  assert.doesNotMatch(JSON.stringify(pkg), /TOP-SECRET|PRIVATE-PHONE|"connected":true|"passed"/);
  assert.match(pkg.offline.requirement, /source.*saleId/);
  assert.match(pkg.offline.boundary, /navegador.*PF/);
  assert.equal(pkg.contract.saleEndpoint, "/api/public/pos/{slug-del-negocio}/sales");
  assert.equal(pkg.contract.refundEndpoint, "/api/public/pos/{slug-del-negocio}/refunds");
  assert.deepEqual(pkg.fixtures.retry, pkg.fixtures.sale);
  assert.equal(pkg.fixtures.refund.originalSaleId, pkg.fixtures.sale.saleId);
  assert.equal(pkg.fixtures.refund.source, pkg.fixtures.sale.source);
});

test("package export requires a version and safe bounded metadata but permits unresolved methods", async () => {
  const { buildInstallationPackage } = await model();
  for (const patch of [{ version: "" }, { version: "a".repeat(101) }, { version: "19\nHeader" }, { vendor: "unknown" }, { deployment: "invented" }])
    assert.throws(() => buildInstallationPackage({ ...profile, ...patch }));
  const pkg = buildInstallationPackage({ ...profile, deployment: "online", plan: "standard" });
  assert.equal(pkg.configurationTemplate, null);
  assert.equal(pkg.status, "preparation_only");
});

test("local fixture validation checks only the contract and does not make network requests", async () => {
  const { validateInstallationFixture, installationFixtures } = await model();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Fixture validation must remain local");
  try {
    const result = validateInstallationFixture(JSON.stringify(installationFixtures().sale));
    assert.equal(result.valid, true);
    assert.match(result.message, /no confirma.*cliente.*conexión/i);
    assert.equal(result.customerPhone, undefined);
  } finally { globalThis.fetch = oldFetch; }
});

test("local validator rejects bad currency, amounts, payment state, identities and secret fields", async () => {
  const { validateInstallationFixture, installationFixtures } = await model();
  const sale = installationFixtures().sale;
  for (const patch of [{ currency: "USD" }, { amountQ: -10 }, { amountQ: 0.001 }, { status: "draft" }, { items: 0.5 }, { saleId: "" }, { customerPhone: "NIT-123" }, { apiKey: "never-export" }, { items: undefined }]) {
    const result = validateInstallationFixture(JSON.stringify({ ...sale, ...patch }));
    assert.equal(result.valid, false, JSON.stringify(patch));
    assert.doesNotMatch(JSON.stringify(result), /never-export/);
  }
  for (const text of ["[]", "null", "{", " ".repeat(20001)])
    assert.equal(validateInstallationFixture(text).valid, false);
});

test("human-readable handoff includes the same version-specific pending acceptance and official sources", async () => {
  const { buildInstallationPackage } = await model();
  const { buildPosHandoff } = await import("../src/pos-handoff-model.js");
  const installation = buildInstallationPackage(profile);
  const text = buildPosHandoff({ vendor: "Odoo", version: "19.0", deployment: "Servidor propio", capability: "API", installation });
  assert.match(text, /REQUISITOS DE ESTA INSTALACIÓN/);
  assert.match(text, /JSON-2/);
  assert.match(text, /PENDIENTE.*19\.0/);
  assert.match(text, /https:\/\/www\.odoo\.com\/documentation\/19\.0/);
});

test('installable addon is offered only for Odoo 18.0 module-capable hosting and API workflow', async () => {
  const { installationPlan, buildInstallationPackage } = await model();
  const supported = { ...profile, version:'18.0', deployment:'self_hosted' };
  const plan = installationPlan(supported);
  assert.equal(plan.addon.version, '18.0.2.0.0');
  assert.equal(plan.addon.downloadUrl, '/api/public/integrations/odoo/18/pf_pos_connector.zip');
  assert.match(plan.detail, /instalable/);
  assert.match(plan.offline, /servidor Odoo/);
  assert.equal(buildInstallationPackage(supported).addon.enabled, false);
  for (const patch of [{version:'19.0'},{version:'18.1'},{deployment:'online',plan:'custom'},{capability:'csv'},{capability:'manual'}]) {
    assert.equal(installationPlan({...supported,...patch}).addon, undefined);
  }
});


test("installation examples and validation preserve the configured currency precision", async () => {
  const { buildInstallationPackage, installationFixtures, validateInstallationFixture } = await model();
  const region = { currency: "CLP", minorUnits: 0 };
  const fixtures = installationFixtures(region);
  assert.equal(fixtures.sale.currency, "CLP");
  assert.equal(fixtures.refund.currency, "CLP");
  assert.equal(buildInstallationPackage(profile, region).fixtures.sale.currency, "CLP");
  assert.equal(validateInstallationFixture(JSON.stringify({ ...fixtures.sale, amountQ: 75 }), region).valid, true);
  assert.equal(validateInstallationFixture(JSON.stringify({ ...fixtures.sale, amountQ: 75.5 }), region).valid, false);
});
