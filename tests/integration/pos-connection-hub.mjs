// Run only inside the disposable POS test stack with a schema-only clone.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { hashPassword } from "../../src/utils/password-hash.js";
import { encryptProgramSecrets } from "../../src/utils/program-secrets.js";
import { createPosIntegrationService } from "../../src/app/services/pos-integration-service.js";
import { withDbClientContext, closeDatabase } from "../../src/app/database.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";

const isolatedPosStack = process.env.DB_NAME === "pos_test" && process.env.DB_HOST === "puntos-pos-test-db" && process.env.DB_USER === "pos_app";
const isolatedPilotStack = process.env.NODE_ENV === "test" && process.env.DB_NAME === "puntos_e2e" && process.env.DB_HOST === "db" && process.env.DB_USER === "loyalty_app";
assert.ok(isolatedPosStack || isolatedPilotStack, "This test requires an explicitly isolated database");
const db = new pg.Client({ host: process.env.DB_HOST, user: process.env.DB_MIGRATIONS_USER || "pos_test", password: process.env.DB_MIGRATIONS_PASSWORD || process.env.DB_PASSWORD, database: process.env.DB_NAME });
const bid = crypto.randomUUID(), cid = crypto.randomUUID(), sid = crypto.randomUUID(), other = crypto.randomUUID();
const slug = `hub-test-${bid.slice(0, 8)}`, otherSlug = `other-${slug}`;
const ownerEmail = `${slug}@example.invalid`;
const baseUrl = process.env.TEST_API_URL || "http://127.0.0.1:3001";
const browserOrigin = new URL(baseUrl).origin;
const forwardedFor = `198.19.${crypto.randomInt(1, 255)}.${crypto.randomInt(1, 255)}`;
const password = crypto.randomBytes(24).toString("hex");
const cookies = new Map();
const checks = [];
const endpoint = `/api/v1/public/pos/${slug}/sales`;
let apiKey;
async function request(path, body, { method = body ? "POST" : "GET", auth = false, csrf = true, headers = {} } = {}) {
  /** @type {Record<string, string>} */
  const h = { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor, ...headers };
  if (auth) {
    h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    h.Origin = browserOrigin;
    if (csrf) h["x-csrf-token"] = decodeURIComponent(cookies.get("pf_csrf") || "");
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (auth) for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(";", 1)[0], separator = first.indexOf("=");
    cookies.set(first.slice(0, separator), first.slice(separator + 1));
  }
  return { status: response.status, body: await response.json() };
}
const admin = (path, body, options = {}) => request(`/api/admin/${path}`, body, { auth: true, ...options });
const sale = { saleId: "000123", source: "register-1", customerPhone: "55554444", amountQ: 40, currency: "GTQ", status: "paid", items: 2 };
const send = (payload, headers = {}) => request(endpoint, payload, { headers: { Authorization: `Bearer ${apiKey}`, ...headers } });
async function balance() { return Number((await db.query("SELECT points FROM customer_balances WHERE customer_id=$1", [cid])).rows[0].points); }
async function program() { return (await db.query("SELECT program_json FROM businesses WHERE id=$1", [bid])).rows[0].program_json; }
const passed = (label) => checks.push(label);

await db.connect();
try {
  const hash = await hashPassword(password);
  for (const [id, fixtureSlug] of [[bid, slug], [other, otherSlug]]) await db.query("INSERT INTO businesses (id,name,slug,email,password_hash,plan,program_type,program_json) VALUES ($1,$2,$2,$3,$4,'EMPRESA','SPEND',$5)", [id, fixtureSlug, `${fixtureSlug}@example.invalid`, hash, { points_per_q: 1 }]);
  await db.query("INSERT INTO customers (id,business_id,phone,name) VALUES ($1,$2,'50255554444','Test customer')", [cid, bid]);
  await db.query("INSERT INTO customer_balances (customer_id) VALUES ($1)", [cid]);
  await db.query("INSERT INTO staff_users (id,business_id,name,email,role,password_hash) VALUES ($1,$2,'Owner',$3,'OWNER',$4)", [sid, bid, ownerEmail, hash]);
  assert.equal((await request("/api/admin/pos")).status, 401);
  const login = await request("/api/staff/login", { email: ownerEmail, password }, { auth: true });
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal((await admin("pos")).status, 200);
  assert.equal((await admin("pos", { enabled: true, mode: "api" }, { method: "PUT", csrf: false })).status, 403);
  passed("Real owner session and CSRF protection");
  const settings = await admin("pos", { enabled: true, mode: "api" }, { method: "PUT" });
  assert.equal(settings.status, 200, JSON.stringify(settings));
  assert.equal(settings.body.integration.enabled, true);
  const keyResponse = await admin("pos/key", {});
  assert.equal(keyResponse.status, 200, JSON.stringify(keyResponse));
  apiKey = keyResponse.body.api_key;
  assert.ok(apiKey.length >= 64);
  assert.match((await program()).external_awards.api_key, /^enc:v2:/);
  assert.equal(JSON.stringify((await admin("pos")).body).includes(apiKey), false);
  passed("Owner-generated API key is encrypted and masked");

  const dry = await send({ ...sale, dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry)); assert.equal(dry.body.summary.ready, 1); assert.equal(await balance(), 0);
  const first = await send(sale); assert.equal(first.body.result.awarded, 1, JSON.stringify(first)); assert.equal(await balance(), 40);
  const replay = await send(sale); assert.equal(replay.body.result.duplicates, 1, JSON.stringify(replay)); assert.equal(await balance(), 40);
  assert.equal((await send({ ...sale, amountQ: 41 })).body.result.errors, 1); assert.equal(await balance(), 40);
  passed("Dry run, award, JSONB duplicate detection and conflicting retry");
  assert.equal((await send({ ...sale, saleId: "unpaid", status: "unpaid" })).status, 400);
  assert.equal((await send({ ...sale, saleId: "unknown", customerPhone: "55559999" })).body.result.errors, 1);
  const signed = { ...sale, saleId: "signed", amountQ: 5 };
  const signature = crypto.createHmac("sha256", apiKey).update(JSON.stringify(signed)).digest("hex");
  assert.equal((await request(endpoint, signed, { headers: { "x-signature": signature } })).body.result.awarded, 1);
  assert.equal((await request(endpoint, { ...signed, amountQ: 6 }, { headers: { "x-signature": signature } })).status, 401);
  assert.equal((await request(`/api/public/pos/${otherSlug}/sales`, sale, { headers: { Authorization: `Bearer ${apiKey}` } })).status, 401);
  passed("Paid status, customer match, raw-body HMAC and cross-business credentials");

  apiKey = (await admin("pos/key", {})).body.api_key;
  assert.equal((await request(endpoint, signed, { headers: { "x-signature": signature } })).status, 401);
  assert.equal((await admin("pos", { enabled: true, mode: "csv" }, { method: "PUT" })).status, 200);
  assert.equal((await send({ ...sale, saleId: "wrong-mode" })).status, 403);
  const csv = "Ticket,Phone,Total,State\n001,55554444,10,paid\n002,55554444,20,unpaid\n003,55559999,30,paid";
  const input = { csv, source: "csv:store-1", columns: { saleId: "Ticket", customerPhone: "Phone", amountQ: "Total", status: "State" } };
  assert.deepEqual((await admin("pos/csv/preview", { csv })).body.headers, ["Ticket", "Phone", "Total", "State"]);
  const preview = await admin("pos/csv/preview", input); assert.equal(preview.body.summary.ready, 1); assert.equal(preview.body.summary.ignored, 1); assert.equal(preview.body.summary.errors, 1);
  const imported = await admin("pos/csv/import", input); assert.equal(imported.body.result.awarded, 1, JSON.stringify(imported));
  assert.equal((await admin("pos/csv/import", input)).body.result.duplicates, 1); assert.equal(await balance(), 55);
  passed("Key rotation, mode gating and real CSV inspect/preview/import/retry");

  const native = encryptProgramSecrets({ pos_integration: { enabled: true, mode: "loyverse", automatic: true, revision: "test-revision", connected_at: "2026-11-09T10:00:00.000Z", loyverse: { access_token: "never-return-this-token", merchant_id: "m1", store_id: null } } });
  await db.query("UPDATE businesses SET program_json=program_json || $2::jsonb WHERE id=$1", [bid, native]);
  for (const path of ["/api/admin/program", "/api/staff/program", `/api/public/business/${slug}`]) {
    const out = await request(path, undefined, { auth: true });
    assert.equal(out.status, 200, JSON.stringify(out)); assert.equal(JSON.stringify(out.body).includes("pos_integration"), false); assert.equal(JSON.stringify(out.body).includes("api_key"), false);
  }
  const saved = await admin("program", { program_type: "SPEND", program_json: { points_per_q: 1, pos_integration: { enabled: false }, external_awards: { api_key: "attacker" } } });
  assert.equal(saved.status, 200, JSON.stringify(saved)); assert.equal((await program()).pos_integration.enabled, true); assert.notEqual((await program()).external_awards.api_key, "attacker");
  passed("Program saves preserve connector state and redact secrets");

  let lookup = 0;
  const nativeSale = { ...sale, saleId: "native-sale", source: "loyverse:m1:s1", amountQ: 8, occurredAt: "2026-11-09T10:30:00Z" };
  const service = createPosIntegrationService({ now: () => new Date("2026-11-09T11:00:00Z"), fetchSales: async () => ({ sales: [nativeSale], issues: [], nextCursor: null }) });
  const synced = await service.syncLoyverseBusiness(bid); assert.equal(synced.result.awarded, 1, JSON.stringify(synced));
  assert.equal((await service.syncLoyverseBusiness(bid)).result.duplicates, 1); assert.equal(await balance(), 63);
  const queued = createPosIntegrationService({ now: () => new Date("2026-11-09T12:00:00Z"), fetchSales: async () => ({ sales: lookup++ === 0 ? [{ ...nativeSale, saleId: "recovery", customerPhone: "55558888" }] : [], issues: [], nextCursor: null }), fetchRetrySales: async () => ({ sales: [{ ...nativeSale, saleId: "recovery", customerPhone: "55554444" }], issues: [] }) });
  assert.equal((await queued.syncLoyverseBusiness(bid)).result.errors, 1);
  assert.equal((await queued.syncLoyverseBusiness(bid)).result.awarded, 1); assert.equal(await balance(), 71);
  assert.deepEqual((await program()).pos_integration.pending_receipts, []);
  passed("Native sync persists progress, prevents duplicates and recovers corrected customers");

  await withDbClientContext({ tenantId: bid, platformAdmin: false }, async () => {
    assert.equal(await BusinessRepo.getById(other), null);
    const stale = await BusinessRepo.getById(bid);
    await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{pos_integration,last_sync}', '{\"marker\":\"newer\"}'::jsonb) WHERE id=$1", [bid]);
    await BusinessRepo.updateProgram(bid, { program_type: "SPEND", program_json: stale.program_json });
    assert.equal((await program()).pos_integration.last_sync.marker, "newer");
    assert.equal((await BusinessRepo.getPublicBySlug(slug)).program_json.pos_integration, undefined);
  });
  passed("Database RLS and atomic preservation of a concurrent sync update");
  const concurrentKey = crypto.randomBytes(32).toString("hex");
  const concurrentSettings = createPosIntegrationService({ verifyConnection: async () => {
    const encrypted = encryptProgramSecrets({ external_awards: { api_key: concurrentKey } }).external_awards.api_key;
    await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{external_awards,api_key}',to_jsonb($2::text)) WHERE id=$1", [bid, encrypted]);
    return { merchantId: "m1", merchantName: "Test", storeId: null };
  } });
  await concurrentSettings.configurePosIntegration(bid, { enabled: true, mode: "loyverse" });
  await withDbClientContext({ tenantId: bid, platformAdmin: false }, async () => {
    assert.equal((await BusinessRepo.getById(bid)).program_json.external_awards.api_key, concurrentKey);
  });
  await db.query("UPDATE businesses SET program_json=program_json #- '{external_awards,api_key}' WHERE id=$1", [bid]);
  await concurrentSettings.configurePosIntegration(bid, { enabled: true, mode: "loyverse" });
  await withDbClientContext({ tenantId: bid, platformAdmin: false }, async () => {
    assert.equal((await BusinessRepo.getById(bid)).program_json.external_awards.api_key, concurrentKey);
  });
  const concurrentDisable = createPosIntegrationService({ hasFeature: async () => {
    await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{external_awards,enabled}','false'::jsonb) WHERE id=$1", [bid]);
    return true;
  } });
  await concurrentDisable.rotatePosKey(bid);
  assert.equal((await program()).external_awards.enabled, false);
  passed("Atomic POS settings preserve concurrent key creation, rotation and disable");
  await db.query("UPDATE staff_users SET role='CASHIER' WHERE id=$1", [sid]);
  assert.equal((await admin("pos")).status, 403);
  passed("Existing owner session loses connection access after cashier role change");
  console.log(JSON.stringify({ ok: true, groups: checks.length, checks, finalPoints: await balance() }, null, 2));
} finally {
  try { await db.query("DELETE FROM businesses WHERE id=ANY($1::uuid[])", [[bid, other]]); }
  finally { await db.end(); await closeDatabase(); }
}
