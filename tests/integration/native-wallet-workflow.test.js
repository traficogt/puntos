/* eslint-disable security/detect-non-literal-fs-filename -- Repository-owned schema paths only. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { orderMigrations } from "../../src/app/db/migration-order.js";
import { HttpError } from "../../src/utils/http-error.js";

const databaseUrl = process.env.NATIVE_WALLET_TEST_DATABASE_URL ?? process.env.WALLET_ENGAGEMENT_TEST_DATABASE_URL;
const role = "native_wallet_workflow_test";

function latch() {
  let release = () => {};
  const promise = new Promise(resolve => { release = () => resolve(undefined); });
  return { promise, release };
}

async function within(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

test("native Wallet service workflows with real RLS, provider locks and durable delivery", {
  skip: !databaseUrl, timeout: 30000
}, async t => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  if (process.env.WALLET_ENGAGEMENT_TEST_DATABASE_URL && !process.env.NATIVE_WALLET_TEST_DATABASE_URL) {
    assert.equal(url.pathname, "/activation_wallet_test"); assert.equal(url.port, "55451");
  } else assert.match(url.pathname, /^\/native_wallet_test(?:_[a-z0-9_]+)?$/);
  // Import the application's pools only after excluding all host DB settings.
  Object.assign(process.env, {
    DB_HOST: url.hostname.replace(/^\[|\]$/g, ""), DB_PORT: url.port || "5432",
    DB_NAME: url.pathname.slice(1), DB_USER: role, DB_PASSWORD: "wallet-workflow-test-only",
    DB_MIGRATIONS_USER: decodeURIComponent(url.username), DB_MIGRATIONS_PASSWORD: decodeURIComponent(url.password),
    JWT_SECRET: "native-wallet-workflow-test-signing-key-only",
    WEBHOOK_SECRET_ENC_KEY: "native-wallet-workflow-test-encryption-key-only"
  });
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  let closeDatabase;
  try {
    const others = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
    assert.equal(others.rows[0].count, 0, "workflow tests require exclusive use of this disposable database");
    await admin.query("DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public");
    await admin.query(await readFile(new URL("../../src/app/schema.sql", import.meta.url), "utf8"));
    await admin.query(await readFile(new URL("../../src/app/schema-extensions.sql", import.meta.url), "utf8"));
    const directory = new URL("../../src/app/migrations/", import.meta.url);
    for (const file of orderMigrations((await readdir(directory)).filter(value => value.endsWith(".sql")))) {
      await admin.query(await readFile(new URL(file, directory), "utf8"));
    }
    await admin.query(`DO $$ BEGIN CREATE ROLE ${role} LOGIN PASSWORD 'wallet-workflow-test-only' NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    const { buildGrantPlan } = await import("../../src/scripts/create-app-role.mjs");
    const plan = buildGrantPlan({ appDbUser: role, dbName: url.pathname.slice(1) });
    for (const statement of plan.statements) await admin.query(statement);
    await admin.query(plan.grantFunctionsSql);
    const db = await import("../../src/app/database.js");
    closeDatabase = db.closeDatabase;
    const { NativeWalletRepo: repo } = await import("../../src/app/repositories/native-wallet-repository.js");
    const { CustomerRepo: customerRepo } = await import("../../src/app/repositories/customer-repository.js");
    const { createNativeWalletService } = await import("../../src/app/services/native-wallet/service.js");
    const { createGoogleProvider } = await import("../../src/app/services/native-wallet/google.js");
    const { resolveNativeWalletMembership } = await import("../../src/app/services/native-wallet/membership.js");
    const { awardPoints } = await import("../../src/app/services/staff-award-service.js");
    const { issueOfflineGrant } = await import("../../src/app/services/staff-offline-service.js");
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const globalContext = fn => db.withDbClientContext({ tenantId: null, platformAdmin: true }, fn);
    const withPassLock = (id, fn) => db.withTransaction(async client => {
      // Match runtime.js: Google class writes share the business lock, then all
      // provider writes lock their pass before reading its authoritative snapshot.
      const row = await client.query("SELECT business_id, provider FROM native_wallet_passes WHERE id=$1", [id]);
      if (row.rows[0]?.provider === "google") {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('native-wallet-business'),hashtext($1))", [row.rows[0].business_id]);
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext('native-wallet-provider'),hashtext($1))", [id]);
      return fn();
    });

    async function fixture(st) {
      const businessId = crypto.randomUUID(), customerId = crypto.randomUUID(), staffId = crypto.randomUUID();
      await admin.query("INSERT INTO businesses (id,name,slug,email,password_hash,plan,program_type,program_json) VALUES ($1,'Workflow shop',$2,$3,'test-only','EMPRESA','SPEND',$4)",
        [businessId, businessId, `${businessId}@example.invalid`, { points_per_q: 2, round: "floor", pending_points_hold_days: 0 }]);
      await admin.query("INSERT INTO staff_users (id,business_id,name,role,password_hash) VALUES ($1,$2,'Workflow cashier','CASHIER','test-only')", [staffId, businessId]);
      await admin.query("INSERT INTO customers (id,business_id,phone,name) VALUES ($1,$2,'50255554444','Ana')", [customerId, businessId]);
      await admin.query("INSERT INTO customer_balances (customer_id,points,pending_points) VALUES ($1,10,3)", [customerId]);
      st.after(async () => {
        await admin.query("DELETE FROM businesses WHERE id=$1", [businessId]);
        await admin.query("DELETE FROM native_wallet_passes WHERE business_id=$1", [businessId]);
      });
      const auth = { id: customerId, business_id: businessId };
      const staff = { id: staffId, business_id: businessId, branch_id: null, role: "CASHIER" };
      const tenant = fn => db.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
      const objects = new Map(), classes = new Map(), writes = [], applePasses = [], pushes = [];
      const controls = { saveHook: null, failUpdates: 0 };
      const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      const google = createGoogleProvider({ issuerId: "1234567890", serviceAccountEmail: "wallet@workflow.iam.gserviceaccount.com", privateKey, appOrigin: "https://wallet.puntosfieles.com" }, {
        fetchImpl: async (address, request) => {
          if (address === "https://oauth2.googleapis.com/token") return response({ access_token: "workflow-access-token", expires_in: 3600, token_type: "Bearer" });
          const [, resource, id] = new URL(address).pathname.match(/\/v1\/(loyaltyClass|loyaltyObject)(?:\/(.+))?$/) || [];
          assert.ok(resource, "the test must intercept every provider network request");
          const store = resource === "loyaltyClass" ? classes : objects;
          if (request.method === "GET") return store.has(id) ? response(store.get(id)) : response({}, 404);
          const body = JSON.parse(request.body);
          if (request.method === "POST" && store.has(body.id)) return response({}, 409);
          store.set(body.id, { ...store.get(body.id), ...body });
          return response(store.get(body.id));
        }
      });
      const providers = {
        google: {
          savePass: async snapshot => {
            if (controls.saveHook) await controls.saveHook(snapshot);
            const result = await google.savePass(snapshot);
            writes.push({ operation: "save", ...snapshot });
            return result;
          },
          updatePass: async snapshot => {
            if (controls.failUpdates > 0) { controls.failUpdates--; throw new Error("simulated transient provider failure"); }
            await google.updatePass(snapshot);
            writes.push({ operation: "update", ...snapshot });
          }
        },
        apple: {
          generatePass: async snapshot => {
            const pass = { serialNumber: snapshot.serial_number, voided: Boolean(snapshot.revoked_at),
              barcodes: [{ message: snapshot.barcode }], points: snapshot.points, revision: snapshot.revision };
            applePasses.push(pass);
            return Buffer.from(JSON.stringify(pass));
          },
          pushUpdate: async token => { pushes.push(token); return { invalidToken: false }; }
        }
      };
      const settings = { apple: { ready: true, config: { passTypeIdentifier: "pass.com.puntos.workflow" } }, google: { ready: true, config: {} } };
      const service = createNativeWalletService({ repo, customerRepo, providers, globalContext, withPassLock, settings });
      const passes = () => tenant(() => repo.getCustomerPasses(businessId, customerId));
      const snapshot = id => tenant(() => repo.getSnapshot(id));
      const remote = id => objects.get(`1234567890.pf_${id.replaceAll("-", "")}`);
      const resolve = token => tenant(() => resolveNativeWalletMembership({ token, staff }));
      return { auth, staff, tenant, service, passes, snapshot, remote, controls, settings, writes, applePasses, pushes, resolve, businessId, customerId };
    }

    async function waitForProviderLock() {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event='advisory' AND query LIKE 'SELECT pg_advisory_xact_lock%'", [role]);
        if (result.rowCount) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error("the worker did not wait on the in-flight provider write");
    }

    await t.test("concurrent issuance creates one active pass per provider and both barcodes resolve the same customer", async st => {
      const f = await fixture(st);
      const issued = await Promise.all([
        ...Array.from({ length: 4 }, () => f.tenant(() => f.service.issue(f.auth, "google"))),
        ...Array.from({ length: 3 }, () => f.tenant(() => f.service.issue(f.auth, "apple")))
      ]);
      assert.ok(issued.every(result => typeof result.url === "string"));
      const passes = await f.passes();
      assert.equal(passes.length, 2);
      for (const pass of passes) {
        const snapshot = await f.snapshot(pass.id);
        const barcode = pass.provider === "google" ? f.remote(pass.id).barcode.value : f.applePasses[0].barcodes[0].message;
        assert.equal(barcode, snapshot.barcode);
        assert.equal((await f.resolve(barcode)).cid, f.customerId);
      }
      const status = await f.tenant(() => f.service.status(f.auth));
      assert.equal(status.passes.length, 2);
      assert.equal(JSON.stringify(status).includes("membership"), false);
      assert.equal(JSON.stringify(status).includes("authentication"), false);
      assert.equal(f.remote(passes.find(row => row.provider === "google").id).loyaltyPoints.balance.int, 10);
    });

    await t.test("native memberships credit real online and offline purchases once, remain reusable, and preserve receipts after revocation", async st => {
      const f = await fixture(st);
      await admin.query("UPDATE customer_balances SET points=0,pending_points=0,lifetime_points=0 WHERE customer_id=$1", [f.customerId]);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      const pass = await f.snapshot((await f.passes())[0].id);
      await f.service.processDue();
      const baseline = await f.snapshot(pass.id);
      assert.equal(baseline.revision, baseline.synced_revision);
      const award = args => f.tenant(() => awardPoints({ staff: f.staff, customerQrToken: pass.barcode, ...args }));
      const first = { txId: crypto.randomUUID(), amount_q: 5, visits: 1, items: 1 };
      const duplicate = await Promise.all([award(first), award(first)]);
      assert.equal(duplicate.filter(result => result.replay === true).length, 1);
      assert.ok(duplicate.every(result => result.transactionId === first.txId && result.pointsAwarded === 10));
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM transactions WHERE id=$1", [first.txId])).rows[0].count, 1);
      const dirty = await f.snapshot(pass.id);
      assert.equal(dirty.points, 10);
      assert.ok(BigInt(dirty.revision) > BigInt(dirty.synced_revision));

      const second = { ...first, txId: crypto.randomUUID(), amount_q: 7 };
      const nextPurchase = await award(second);
      assert.equal(nextPurchase.pointsAwarded, 14);
      assert.equal(nextPurchase.newBalance, 24);
      assert.notEqual(nextPurchase.replay, true);
      const grant = await f.tenant(() => issueOfflineGrant(f.staff));
      const offline = { txId: crypto.randomUUID(), amount_q: 11, visits: 1, items: 1,
        source: "offline", offlineGrant: grant.grant, meta: { client_ts: new Date().toISOString() } };
      const offlineDuplicate = await Promise.all([award(offline), award(offline)]);
      assert.equal(offlineDuplicate.filter(result => result.replay === true).length, 1);
      assert.ok(offlineDuplicate.every(result => result.pointsAwarded === 22 && result.newBalance === 46));
      const captured = (await admin.query("SELECT source,meta FROM transactions WHERE id=$1", [offline.txId])).rows[0];
      assert.equal(captured.source, "offline");
      assert.equal(captured.meta.client_ts, offline.meta.client_ts);

      const expired = await f.tenant(() => issueOfflineGrant(f.staff, { now: new Date(Date.now() - 25 * 60 * 60 * 1000) }));
      assert.equal((await award({ ...offline, offlineGrant: expired.grant })).replay, true);
      await assert.rejects(award({ ...offline, txId: crypto.randomUUID(), offlineGrant: expired.grant }), { statusCode: 403 });
      await assert.rejects(award({ ...offline, txId: crypto.randomUUID(), offlineGrant: null }), { statusCode: 403 });
      const balance = (await admin.query("SELECT points,pending_points,lifetime_points FROM customer_balances WHERE customer_id=$1", [f.customerId])).rows[0];
      assert.deepEqual(balance, { points: 46, pending_points: 0, lifetime_points: 46 });
      const ledger = (await admin.query("SELECT count(*)::int AS count,sum(points)::int AS points FROM transactions WHERE customer_id=$1", [f.customerId])).rows[0];
      assert.deepEqual(ledger, { count: 3, points: 46 });
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM qr_tokens WHERE customer_id=$1", [f.customerId])).rows[0].count, 3);
      assert.ok(BigInt((await f.snapshot(pass.id)).revision) > BigInt(baseline.revision));
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.equal(f.remote(pass.id).loyaltyPoints.balance.int, 46);

      await f.tenant(() => f.service.revoke(f.auth));
      await assert.rejects(award({ ...first, txId: crypto.randomUUID() }), { statusCode: 403 });
      await assert.rejects(award({ ...offline, txId: crypto.randomUUID() }), { statusCode: 403 });
      assert.equal((await award(first)).replay, true);
      assert.equal((await award(offline)).replay, true);
      await assert.rejects(award({ ...first, amount_q: 6 }), { statusCode: 409 });
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM transactions WHERE customer_id=$1", [f.customerId])).rows[0].count, 3);
      assert.equal((await admin.query("SELECT points FROM customer_balances WHERE customer_id=$1", [f.customerId])).rows[0].points, 46);
    });

    await t.test("balance-triggered updates survive a provider failure and recover after durable backoff", async st => {
      const f = await fixture(st);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      await f.tenant(() => f.service.issue(f.auth, "apple"));
      const passes = await f.passes();
      const google = passes.find(row => row.provider === "google"), apple = passes.find(row => row.provider === "apple");
      await f.tenant(() => repo.registerDevice({ passId: apple.id, deviceId: "phone", pushToken: "aa".repeat(32) }));
      assert.deepEqual(await f.service.processDue(), { delivered: 2, failed: 0 });
      f.controls.failUpdates = 1;
      await f.tenant(() => customerRepo.setPoints(f.customerId, 45));
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 1 });
      const failed = await f.snapshot(google.id);
      assert.equal(failed.attempts, 1);
      assert.ok(BigInt(failed.revision) > BigInt(failed.synced_revision));
      assert.ok(failed.next_attempt_at.getTime() > Date.now());
      assert.equal(failed.locked_until, null);
      assert.deepEqual(await f.service.processDue(), { delivered: 0, failed: 0 });
      await admin.query("UPDATE native_wallet_passes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [google.id]);
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.equal(f.remote(google.id).loyaltyPoints.balance.int, 45);
      const recovered = await f.snapshot(google.id);
      assert.equal(recovered.attempts, 0);
      assert.equal(recovered.synced_revision, recovered.revision);
      assert.equal(f.pushes.length, 2);
    });

    await t.test("installing an older Apple download queues a refresh even after a no-device delivery was acknowledged", async st => {
      const f = await fixture(st);
      await f.tenant(() => f.service.issue(f.auth, "apple"));
      const download = JSON.parse((await f.tenant(() => f.service.downloadApple(f.auth))).toString());
      assert.equal(download.points, 10);
      const pass = (await f.passes())[0];
      await f.tenant(() => customerRepo.setPoints(f.customerId, 35));
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.equal(f.pushes.length, 0);
      const acknowledged = await f.snapshot(pass.id);
      assert.equal(acknowledged.revision, acknowledged.synced_revision);
      assert.ok(BigInt(acknowledged.revision) > BigInt(download.revision));

      const registration = { passId: pass.id, deviceId: "late-install", pushToken: "cc".repeat(32) };
      await f.tenant(() => repo.registerDevice(registration));
      const registered = await f.snapshot(pass.id);
      assert.ok(BigInt(registered.revision) > BigInt(registered.synced_revision), "installation must request a current pass");
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.deepEqual(f.pushes, [registration.pushToken]);
      const authenticated = await f.service.authenticateApple("pass.com.puntos.workflow", registered.serial_number,
        `ApplePass ${registered.authentication_token}`);
      assert.equal(JSON.parse((await f.service.updatedApplePass(authenticated)).bytes.toString()).points, 35);

      await f.tenant(() => repo.registerDevice(registration));
      assert.equal((await f.snapshot(pass.id)).revision, registered.revision, "an identical registration must remain idempotent");
      assert.deepEqual(await f.service.processDue(), { delivered: 0, failed: 0 });
      const rotated = { ...registration, pushToken: "dd".repeat(32) };
      await f.tenant(() => repo.registerDevice(rotated));
      assert.ok(BigInt((await f.snapshot(pass.id)).revision) > BigInt(registered.revision));
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.deepEqual(f.pushes, [registration.pushToken, rotated.pushToken]);
    });

    for (const action of ["balance", "revoke"]) {
      await t.test(`an in-flight Google save cannot overwrite the worker's newer ${action} state`, async st => {
        const f = await fixture(st);
        await f.tenant(() => f.service.issue(f.auth, "google"));
        await f.service.processDue();
        const pass = (await f.passes())[0];
        const entered = latch(), release = latch();
        f.controls.saveHook = async () => { entered.release(); await release.promise; };
        const issue = f.tenant(() => f.service.issue(f.auth, "google"));
        let worker;
        try {
          await within(entered.promise, "Google save did not start");
          if (action === "balance") await f.tenant(() => customerRepo.setPoints(f.customerId, 70));
          else await f.tenant(() => f.service.revoke(f.auth));
          worker = f.service.processDue();
          await waitForProviderLock();
          release.release();
          await within(issue, "the save did not release its transaction");
          assert.deepEqual(await within(worker, "the worker did not resume"), { delivered: 1, failed: 0 });
          assert.deepEqual(f.writes.slice(-2).map(row => row.operation), ["save", "update"]);
          assert.equal(f.remote(pass.id).state, action === "revoke" ? "INACTIVE" : "ACTIVE");
          if (action === "balance") assert.equal(f.remote(pass.id).loyaltyPoints.balance.int, 70);
          const persisted = await f.snapshot(pass.id);
          assert.equal(persisted.synced_revision, persisted.revision);
        } finally {
          release.release();
          await Promise.allSettled([issue, worker].filter(Boolean));
        }
      });
    }

    await t.test("revocation updates installed passes, invalidates old memberships and reissues fresh identities", async st => {
      const f = await fixture(st);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      await f.tenant(() => f.service.issue(f.auth, "apple"));
      const original = await f.passes();
      const apple = await f.snapshot(original.find(row => row.provider === "apple").id);
      const google = await f.snapshot(original.find(row => row.provider === "google").id);
      await f.tenant(() => repo.registerDevice({ passId: apple.id, deviceId: "phone", pushToken: "bb".repeat(32) }));
      await f.service.processDue();
      await f.tenant(() => f.service.revoke(f.auth));
      await assert.rejects(f.resolve(google.barcode), error => error instanceof HttpError && error.statusCode === 403);
      await assert.rejects(f.resolve(apple.barcode), error => error instanceof HttpError && error.statusCode === 403);
      assert.deepEqual(await f.service.processDue(), { delivered: 2, failed: 0 });
      assert.equal(f.remote(google.id).state, "INACTIVE");
      assert.notEqual(f.remote(google.id).accountName, google.customer_name);
      assert.equal(f.remote(google.id).loyaltyPoints.balance.int, 0);
      const tombstone = await f.snapshot(google.id);
      assert.equal(tombstone.customer_name, null);
      assert.equal(tombstone.pending_points, 0);
      assert.equal(tombstone.lifetime_points, 0);
      assert.equal(f.pushes.length, 2);
      const callbackPass = await f.service.authenticateApple("pass.com.puntos.workflow", apple.serial_number, `ApplePass ${apple.authentication_token}`);
      const updated = await f.service.updatedApplePass(callbackPass);
      assert.equal(JSON.parse(updated.bytes.toString()).voided, true);
      assert.equal(JSON.parse(updated.bytes.toString()).points, 0);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      await f.tenant(() => f.service.issue(f.auth, "apple"));
      const current = (await f.passes()).filter(row => !row.revoked_at);
      assert.equal(current.length, 2);
      for (const pass of current) {
        assert.ok(!original.some(old => old.id === pass.id));
        const snapshot = await f.snapshot(pass.id);
        assert.notEqual(snapshot.barcode, apple.barcode);
        assert.notEqual(snapshot.barcode, google.barcode);
        assert.equal((await f.resolve(snapshot.barcode)).cid, f.customerId);
      }
      await assert.rejects(f.resolve(google.barcode), error => error instanceof HttpError && error.statusCode === 403);
      assert.equal(f.remote(google.id).state, "INACTIVE");
    });

    await t.test("soft-deleting a customer queues void updates and stops new issuance", async st => {
      const f = await fixture(st);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      const pass = (await f.passes())[0];
      await f.service.processDue();
      await f.tenant(() => customerRepo.softDelete(f.customerId));
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.equal(f.remote(pass.id).state, "INACTIVE");
      await assert.rejects(f.tenant(() => f.service.issue(f.auth, "google")), error => error instanceof HttpError && error.statusCode === 404);
    });

    await t.test("issued passes remain visible and revocable while both providers are disabled", async st => {
      const f = await fixture(st);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      await f.tenant(() => f.service.issue(f.auth, "apple"));
      const original = await f.passes();
      const google = await f.snapshot(original.find(row => row.provider === "google").id);
      await f.service.processDue();
      f.settings.apple.ready = false;
      f.settings.google.ready = false;
      const status = await f.tenant(() => f.service.status(f.auth));
      assert.deepEqual(status.providers, { apple: false, google: false });
      assert.equal(status.passes.length, 2, "provider availability must not hide existing membership revocation controls");
      await assert.rejects(f.tenant(() => f.service.issue(f.auth, "google")), error => error instanceof HttpError && error.statusCode === 503);
      await f.tenant(() => f.service.revoke(f.auth));
      await assert.rejects(f.resolve(google.barcode), error => error instanceof HttpError && error.statusCode === 403);
      assert.deepEqual((await f.tenant(() => f.service.status(f.auth))).passes, []);
      assert.deepEqual(await f.service.processDue(), { delivered: 0, failed: 0 });
      f.settings.apple.ready = true;
      f.settings.google.ready = true;
      assert.deepEqual(await f.service.processDue(), { delivered: 2, failed: 0 });
      assert.equal(f.remote(google.id).state, "INACTIVE");
    });

    await t.test("hard-deleting a business still delivers a final inactive Google tombstone", async st => {
      const f = await fixture(st);
      await f.tenant(() => f.service.issue(f.auth, "google"));
      const pass = (await f.passes())[0];
      await f.service.processDue();
      await admin.query("DELETE FROM businesses WHERE id=$1", [f.businessId]);
      assert.deepEqual(await f.service.processDue(), { delivered: 1, failed: 0 });
      assert.equal(f.remote(pass.id).state, "INACTIVE");
    });
  } finally {
    if (closeDatabase) await closeDatabase();
    await admin.end();
  }
});
