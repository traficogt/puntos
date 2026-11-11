import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isNativeWalletCode, resolveNativeWalletMembership, verifyNativeWalletAward } from "../../src/app/services/native-wallet/membership.js";
import { issueOfflineGrant, verifyOfflineCaptureGrant } from "../../src/app/services/staff-offline-service.js";
import { awardPointsWithDeps } from "../../src/app/services/staff-award-service.js";
import { lookupCustomerByQrTokenWithDeps } from "../../src/app/services/staff-service.js";
import { AuditRepo } from "../../src/app/repositories/audit-repository.js";
import { NativeWalletRepo } from "../../src/app/repositories/native-wallet-repository.js";

const token = Buffer.alloc(32, 7).toString("base64url");
const code = `PFW1.${token}`;
const staff = { id: "33333333-3333-4333-8333-333333333333", business_id: "11111111-1111-4111-8111-111111111111", branch_id: null };
const customerId = "22222222-2222-4222-8222-222222222222";
const passId = "44444444-4444-4444-8444-444444444444";
const txId = "55555555-5555-4555-8555-555555555555";
const now = new Date(Math.floor(Date.now() / 1000) * 1000);
const customer = { id: customerId, business_id: staff.business_id, deleted_at: null, name: "Ana", phone: "55555555", points: 100, pending_points: 0 };

/** @param {{pass?: any, customer?: any}} [options] */
function membershipFixture(options = {}) {
  const state = {
    pass: Object.hasOwn(options, "pass") ? options.pass : { id: passId, business_id: staff.business_id, customer_id: customerId, revoked_at: null, created_at: new Date(now.getTime() - 60000) },
    customer: Object.hasOwn(options, "customer") ? options.customer : { ...customer },
    finds: [], customerReads: 0
  };
  const deps = {
    repo: { findByMembershipToken: async raw => { state.finds.push(raw); return state.pass; } },
    customerRepo: { getById: async () => { state.customerReads++; return state.customer; } }
  };
  return { state, deps };
}

test("native Wallet detection requires the exact canonical 32-byte membership barcode", () => {
  assert.equal(isNativeWalletCode(code), true);
  for (const value of [null, 123, "", "signed.jwt.token", token, code.toLowerCase(), code + "=", code + "\n", code.slice(0, -1), code + "A", "PFW1." + "A".repeat(42) + "B", "PFW1." + "+".repeat(43)]) {
    assert.equal(isNativeWalletCode(value), false);
  }
});

test("membership lookup strips only the known prefix and returns scoped internal identity", async () => {
  const f = membershipFixture();
  const member = await resolveNativeWalletMembership({ token: code, staff }, f.deps);
  assert.deepEqual(f.state.finds, [token]);
  assert.equal(member.bid, staff.business_id);
  assert.equal(member.cid, customerId);
  assert.equal(member.passId, passId);
  assert.equal(JSON.stringify(member).includes(token), false);
});

test("invalid membership codes never reach the repository", async () => {
  const f = membershipFixture();
  await assert.rejects(resolveNativeWalletMembership({ token: "PFW1.invalid", staff }, f.deps), { statusCode: 400 });
  assert.equal(f.state.finds.length, 0);
});

test("membership lookup rejects unknown, wrong-tenant, revoked and deleted memberships", async () => {
  const missing = membershipFixture({ pass: null });
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff }, missing.deps), { statusCode: 404 });
  const f = membershipFixture();
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff: { ...staff, business_id: randomUUID() } }, f.deps), { statusCode: 403 });
  assert.equal(f.state.customerReads, 0);
  f.state.pass.revoked_at = now;
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff }, f.deps), { statusCode: 403 });
  f.state.pass.revoked_at = null;
  f.state.customer.deleted_at = now;
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff }, f.deps), { statusCode: 404 });
  f.state.customer = null;
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff }, f.deps), { statusCode: 404 });
});

test("replay-only membership resolution still requires the same tenant and an active customer", async () => {
  const f = membershipFixture();
  f.state.pass.revoked_at = now;
  assert.equal((await resolveNativeWalletMembership({ token: code, staff, allowRevoked: true }, f.deps)).cid, customerId);
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff: { ...staff, business_id: randomUUID() }, allowRevoked: true }, f.deps), { statusCode: 403 });
  f.state.customer.deleted_at = now;
  await assert.rejects(resolveNativeWalletMembership({ token: code, staff, allowRevoked: true }, f.deps), { statusCode: 404 });
});

test("each purchase gets a unique synthetic jti while retries retain the same jti", async () => {
  const f = membershipFixture();
  const args = { token: code, staff, txId, now };
  const first = await verifyNativeWalletAward(args, f.deps);
  const retry = await verifyNativeWalletAward({ ...args, txId: txId.toUpperCase(), now: new Date(now.getTime() + 3600000) }, f.deps);
  const next = await verifyNativeWalletAward({ ...args, txId: randomUUID() }, f.deps);
  assert.equal(first.jti, retry.jti);
  assert.notEqual(first.jti, next.jti);
  assert.match(first.jti, /^pfw1_[a-f0-9]{64}$/);
  assert.ok(first.exp > now.getTime() / 1000);
});

test("native Wallet earning requires a stable UUID transaction id before repository access", async () => {
  const f = membershipFixture();
  for (const tx of [null, undefined, "", "tx-1", "../../other", "55555555-5555-4555-8555-555555555555\n"]) {
    await assert.rejects(verifyNativeWalletAward({ token: code, staff, txId: tx, now }, f.deps), { statusCode: 400 });
  }
  assert.equal(f.state.finds.length, 0);
});

test("the reusable offline grant validator returns the signed capture window", async () => {
  const grant = await issueOfflineGrant(staff, { now });
  const capture = new Date(now.getTime() + 1000);
  const authorized = await verifyOfflineCaptureGrant({ grant: grant.grant, staff, capturedAt: capture.toISOString(), now: new Date(now.getTime() + 3600000) });
  assert.equal(authorized.captured, capture.getTime());
  assert.equal(authorized.issued, now.getTime());
  assert.equal(authorized.expires - authorized.issued, 24 * 3600000);
});

test("offline membership earning accepts a capture authorized by that staff and created after membership issuance", async () => {
  const f = membershipFixture();
  const grant = await issueOfflineGrant(staff, { now });
  const out = await verifyNativeWalletAward({ token: code, staff, txId, source: "offline", grant: grant.grant,
    capturedAt: new Date(now.getTime() + 1000).toISOString(), now: new Date(now.getTime() + 3600000) }, f.deps);
  assert.equal(out.cid, customerId);
});

test("offline memberships require a valid grant and a capture within the 24-hour authorization", async () => {
  const f = membershipFixture();
  const grant = await issueOfflineGrant(staff, { now });
  const args = { token: code, staff, txId, source: "offline", grant: grant.grant, capturedAt: now.toISOString(), now: new Date(now.getTime() + 3600000) };
  for (const patch of [{ grant: null }, { grant: "invalid" }, { capturedAt: "invalid" },
    { capturedAt: new Date(now.getTime() - 1000).toISOString() },
    { capturedAt: new Date(now.getTime() + 7200000).toISOString() },
    { now: new Date(now.getTime() + 25 * 3600000) }, { staff: { ...staff, id: randomUUID() } }]) {
    await assert.rejects(verifyNativeWalletAward({ ...args, ...patch }, f.deps));
  }
});

test("a membership created after offline capture cannot authorize a new purchase", async () => {
  const f = membershipFixture();
  f.state.pass.created_at = new Date(now.getTime() + 2000);
  const grant = await issueOfflineGrant(staff, { now });
  await assert.rejects(verifyNativeWalletAward({ token: code, staff, txId, source: "offline", grant: grant.grant,
    capturedAt: now.toISOString(), now: new Date(now.getTime() + 3600000) }, f.deps), { statusCode: 403 });
});

test("staff lookup recognizes native memberships and returns the existing customer projection", async () => {
  const f = membershipFixture();
  const out = await lookupCustomerByQrTokenWithDeps({
    verifyQrToken: async () => { assert.fail("membership barcode is not a signed QR JWT"); },
    resolveNativeWalletMembership: args => resolveNativeWalletMembership(args, f.deps),
    CustomerRepo: f.deps.customerRepo
  }, { staff, customerQrToken: code });
  assert.deepEqual(out, { customer: { id: customerId, name: "Ana", phone: "55555555", points: 100, pending_points: 0 } });
});

function awardFixture(t) {
  t.mock.method(AuditRepo, "log", async () => {});
  const f = membershipFixture();
  const state = { ...f.state, awards: new Map(), qr: new Set(), writes: 0, webhookCalls: 0, balance: 100, passUnavailableAtCommit: false, sql: [] };
  const deps = {
    verifyNativeWalletAward: args => verifyNativeWalletAward({ ...args, now }, f.deps),
    verifyQrToken: async () => ({ bid: staff.business_id, cid: customerId, jti: "ordinary-qr-jti", exp: Math.floor(now.getTime() / 1000) + 60 }),
    verifyQrSignature: async () => { assert.fail("native membership cannot use JWT signature fallback"); },
    BusinessRepo: { getById: async () => ({ id: staff.business_id, plan: "EMPRESA", program_json: {} }), activeCustomerCount: async () => 1 },
    computePoints: () => 10, planLimits: () => ({ activeCustomers: 100 }),
    withTransaction: async fn => {
      const before = { awards: new Map(state.awards), qr: new Set(state.qr), balance: state.balance, writes: state.writes };
      try { return await fn({ query: async (sql, params) => {
      state.sql.push(sql);
      if (sql.includes("SELECT id, business_id") && sql.includes("FROM transactions")) return { rows: state.awards.has(params[0]) ? [state.awards.get(params[0])] : [] };
      if (sql.includes("SELECT points, pending_points FROM customer_balances")) return { rows: [{ points: state.balance, pending_points: 0 }] };
      if (sql.includes("FROM customers WHERE")) return { rows: f.state.customer?.deleted_at ? [] : [{ id: customerId }], rowCount: 1 };
      if (sql.includes("FROM native_wallet_passes")) return { rows: state.passUnavailableAtCommit || f.state.pass.revoked_at ? [] : [{ id: passId }], rowCount: 1 };
      if (sql.includes("INSERT INTO qr_tokens")) {
        const existed = state.qr.has(params[0]);
        state.qr.add(params[0]);
        return { rows: [], rowCount: existed ? 0 : 1 };
      }
      if (sql.includes("INSERT INTO transactions")) {
        state.writes++;
        state.awards.set(params[0], { id: params[0], business_id: params[1], customer_id: params[3], staff_user_id: params[4], amount_q: params[5], visits: params[6], items: params[7], points: params[8], status: params[9], available_at: params[10], meta: params[12] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE customer_balances")) { state.balance += params[1]; return { rows: [{ points: state.balance, pending_points: 0 }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
      } }); }
      catch (error) { Object.assign(state, before); throw error; }
    },
    enqueueWebhookEvent: async () => { state.webhookCalls++; },
    isSourceTransactionActive: async () => false
  };
  const args = { staff, customerQrToken: code, txId, amount_q: 10, visits: 1, items: 1 };
  return { state, membership: f, deps, args };
}

test("membership awards support separate purchases while retries credit only once", async t => {
  const f = awardFixture(t);
  await awardPointsWithDeps(f.deps, f.args);
  const retry = await awardPointsWithDeps(f.deps, f.args);
  await awardPointsWithDeps(f.deps, { ...f.args, txId: randomUUID() });
  assert.equal(retry.replay, true);
  assert.equal(f.state.writes, 2);
  assert.equal(f.state.qr.size, 2);
  assert.equal(f.state.balance, 120);
  assert.equal(f.state.webhookCalls, 2);
});

test("revoked membership can acknowledge only an identical committed purchase", async t => {
  const f = awardFixture(t);
  await awardPointsWithDeps(f.deps, f.args);
  f.membership.state.pass.revoked_at = now;
  assert.equal((await awardPointsWithDeps(f.deps, f.args)).replay, true);
  for (const changed of [{ amount_q: 11 }, { visits: 2 }, { items: 2 }, { staff: { ...staff, id: randomUUID() } }]) {
    await assert.rejects(awardPointsWithDeps(f.deps, { ...f.args, ...changed }), { statusCode: 409 });
  }
  await assert.rejects(awardPointsWithDeps(f.deps, { ...f.args, txId: randomUUID() }), { statusCode: 403 });
  assert.equal(f.state.writes, 1);
});

test("native membership replay requires the exact stored fingerprint even on legacy rows", async t => {
  const f = awardFixture(t);
  await awardPointsWithDeps(f.deps, f.args);
  f.state.awards.get(txId).meta = {};
  f.membership.state.pass.revoked_at = now;
  await assert.rejects(awardPointsWithDeps(f.deps, f.args), { statusCode: 409 });
  assert.equal(f.state.writes, 1);
});

test("expired offline authorization acknowledges a committed capture but cannot create a new award", async t => {
  const f = awardFixture(t);
  const captured = new Date(now.getTime() - 60000);
  f.membership.state.pass.created_at = new Date(captured.getTime() - 1000);
  const grant = await issueOfflineGrant(staff, { now: captured });
  const args = { ...f.args, source: "offline", offlineGrant: grant.grant, meta: { client_ts: captured.toISOString() } };
  await awardPointsWithDeps(f.deps, args);
  f.deps.verifyNativeWalletAward = data => verifyNativeWalletAward({ ...data, now: new Date(now.getTime() + 25 * 3600000) }, f.membership.deps);
  assert.equal((await awardPointsWithDeps(f.deps, args)).replay, true);
  await assert.rejects(awardPointsWithDeps(f.deps, { ...args, txId: randomUUID() }), { statusCode: 403 });
  assert.equal(f.state.writes, 1);
});

test("missing offline grant cannot create a membership award", async t => {
  const f = awardFixture(t);
  await assert.rejects(awardPointsWithDeps(f.deps, { ...f.args, source: "offline", meta: { client_ts: now.toISOString() } }), { statusCode: 403 });
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.qr.size, 0);
});

test("membership revocation between resolution and the ledger transaction cannot create an award", async t => {
  const f = awardFixture(t);
  f.state.passUnavailableAtCommit = true;
  await assert.rejects(awardPointsWithDeps(f.deps, f.args), { statusCode: 403 });
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.qr.size, 0);
  assert.equal(f.state.balance, 100);
});

test("membership recheck follows the balance lock order used by Wallet update triggers", async t => {
  const f = awardFixture(t);
  await awardPointsWithDeps(f.deps, f.args);
  const balanceUpdate = f.state.sql.findIndex(sql => sql.includes("UPDATE customer_balances"));
  const membershipCheck = f.state.sql.findIndex(sql => sql.includes("FROM native_wallet_passes"));
  assert.ok(balanceUpdate >= 0 && membershipCheck > balanceUpdate);
  assert.match(f.state.sql[membershipCheck], /FOR SHARE/);
});

test("wrong-tenant and deleted-customer membership retries cannot acknowledge or create transactions", async t => {
  const f = awardFixture(t);
  await awardPointsWithDeps(f.deps, f.args);
  await assert.rejects(awardPointsWithDeps(f.deps, { ...f.args, staff: { ...staff, business_id: randomUUID() } }), { statusCode: 403 });
  f.membership.state.customer.deleted_at = now;
  await assert.rejects(awardPointsWithDeps(f.deps, f.args), { statusCode: 404 });
  assert.equal(f.state.writes, 1);
});

test("ordinary QR paths retain existing dependency seams and never query Wallet membership", async t => {
  const f = awardFixture(t);
  t.mock.method(NativeWalletRepo, "findByMembershipToken", async () => { assert.fail("ordinary QR must not query Wallet"); });
  const { verifyNativeWalletAward: _unused, ...oldDeps } = f.deps;
  const out = await awardPointsWithDeps(oldDeps, { ...f.args, customerQrToken: "ordinary.jwt.token" });
  assert.equal(out.pointsAwarded, 10);
  await lookupCustomerByQrTokenWithDeps({ verifyQrToken: f.deps.verifyQrToken, CustomerRepo: f.membership.deps.customerRepo }, { staff, customerQrToken: "ordinary.jwt.token" });
  assert.equal(f.membership.state.finds.length, 0);
});
