/* eslint-disable security/detect-non-literal-fs-filename -- Repository-owned schema paths only. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { orderMigrations } from "../../src/app/db/migration-order.js";

// Opt in only with a dedicated, disposable database. Never use DB_* defaults.
const databaseUrl = process.env.NATIVE_WALLET_TEST_DATABASE_URL ?? process.env.WALLET_ENGAGEMENT_TEST_DATABASE_URL;

test("native Wallet storage, tenant isolation and durable updates", { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  if (process.env.WALLET_ENGAGEMENT_TEST_DATABASE_URL && !process.env.NATIVE_WALLET_TEST_DATABASE_URL) {
    assert.equal(url.pathname, "/activation_wallet_test"); assert.equal(url.port, "55451");
  } else assert.match(url.pathname, /^\/native_wallet_test(?:_[a-z0-9_]+)?$/);
  const migration = await readFile(new URL("../../src/app/migrations/2026-11-09-native-wallet.sql", import.meta.url), "utf8")
    .catch(() => "");
  assert.ok(migration.length, "the native Wallet migration must exist");
  const { NativeWalletRepo: repo } = await import("../../src/app/repositories/native-wallet-repository.js");
  const { runWithDbContext } = await import("../../src/app/database.js");
  const admin = new pg.Client({ connectionString: databaseUrl });
  const client = new pg.Client({ connectionString: databaseUrl });
  const peer = new pg.Client({ connectionString: databaseUrl });
  const businessId = crypto.randomUUID(), otherBusinessId = crypto.randomUUID();
  const customerId = crypto.randomUUID(), otherCustomerId = crypto.randomUUID();
  const role = "native_wallet_storage_test";
  const passInput = (provider = "apple", overrides = {}) => ({
    id: crypto.randomUUID(), businessId, customerId, provider,
    membershipToken: crypto.randomBytes(32).toString("base64url"),
    authenticationToken: crypto.randomBytes(32).toString("base64url"), ...overrides
  });
  async function context(tenantId, fn, connection = client, platformAdmin = false) {
    await connection.query("SELECT set_config('app.current_tenant', $1, false), set_config('app.platform_admin', $2, false)",
      [tenantId || "", platformAdmin ? "true" : ""]);
    return runWithDbContext({ client: connection, tenantId, platformAdmin }, fn);
  }
  await admin.connect();
  await client.connect();
  await peer.connect();
  try {
    await admin.query("DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public");
    await admin.query(await readFile(new URL("../../src/app/schema.sql", import.meta.url), "utf8"));
    await admin.query(await readFile(new URL("../../src/app/migrations/2026-02-27-tenant-rls_canonical.sql", import.meta.url), "utf8"));
    await admin.query(migration);
    await admin.query(await readFile(new URL("../../src/app/migrations/2026-11-11-reward-promises-hospitality.sql", import.meta.url), "utf8"));
    await admin.query(await readFile(new URL("../../src/app/migrations/2026-11-11-wallet-engagement.sql", import.meta.url), "utf8"));
    await admin.query("CREATE TABLE wallet_passes (legacy_marker text); INSERT INTO wallet_passes VALUES ('untouched')");
    await admin.query(migration);
    await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await admin.query(`GRANT USAGE ON SCHEMA public, app TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(`SET ROLE ${role}`);
    await peer.query(`SET ROLE ${role}`);
    for (const id of [businessId, otherBusinessId]) {
      await admin.query("INSERT INTO businesses (id, name, slug, email, password_hash) VALUES ($1::uuid, 'Test shop', $1::text, $1::text || '@example.invalid', 'test-only')", [id]);
    }
    for (const [id, tenant] of [[customerId, businessId], [otherCustomerId, otherBusinessId]]) {
      await admin.query("INSERT INTO customers (id, business_id, phone, name) VALUES ($1, $2, '50255554444', 'Ana')", [id, tenant]);
      await admin.query("INSERT INTO customer_balances (customer_id, points) VALUES ($1, 10)", [id]);
    }

    let apple, google;
    await t.test("fresh and repeat migration leave the optional legacy tables untouched", async () => {
      assert.equal((await admin.query("SELECT legacy_marker FROM wallet_passes")).rows[0].legacy_marker, "untouched");
      const { rows } = await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('native_wallet_passes', 'native_wallet_registrations')");
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
    });

    await t.test("issuance is idempotent, encrypts credentials and rejects cross-tenant customer pairing", async () => {
      const input = passInput();
      apple = await context(businessId, () => repo.ensurePass(input));
      assert.equal(apple.id, input.id);
      assert.equal(apple.serial_number, input.id);
      assert.equal(apple.membership_token, input.membershipToken);
      assert.equal(apple.authentication_token, input.authenticationToken);
      assert.equal(apple.barcode, `PFW1.${input.membershipToken}`);
      const repeat = await context(businessId, () => repo.ensurePass(passInput()));
      assert.equal(repeat.id, apple.id);
      assert.equal(repeat.membership_token, input.membershipToken);
      const stored = (await admin.query("SELECT * FROM native_wallet_passes WHERE id=$1", [apple.id])).rows[0];
      assert.match(stored.membership_token, /^enc:v2:/);
      assert.match(stored.authentication_token, /^enc:v2:/);
      assert.equal(stored.membership_hash, crypto.createHash("sha256").update(input.membershipToken).digest("hex"));
      assert.ok(stored.created_at);
      assert.equal(await context(businessId, () => repo.ensurePass(passInput("google", { customerId: otherCustomerId }))), null);
      google = await context(businessId, () => repo.ensurePass(passInput("google")));
      const list = await context(businessId, () => repo.getCustomerPasses(businessId, customerId));
      assert.equal(list.length, 2);
      for (const row of list) {
        assert.equal("membership_token" in row, false);
        assert.equal("authentication_token" in row, false);
        assert.equal("membership_hash" in row, false);
      }
      assert.equal((await context(businessId, () => repo.findByMembershipToken(input.membershipToken))).id, apple.id);
      assert.equal((await context(businessId, () => repo.getBySerial(apple.serial_number, "apple"))).id, apple.id);
      assert.equal(await context(businessId, () => repo.getBySerial(apple.serial_number, "google")), null);
    });

    await t.test("RLS denies other tenants, missing tenant context and foreign registration rows", async () => {
      assert.equal(await context(otherBusinessId, () => repo.getSnapshot(apple.id)), null);
      assert.equal(await context(null, () => repo.getBySerial(apple.serial_number)), null);
      assert.equal(await context(otherBusinessId, () => repo.findByMembershipToken(apple.membership_token)), null);
      assert.deepEqual(await context(otherBusinessId, () => repo.getCustomerPasses(businessId, customerId)), []);
      assert.equal(await context(otherBusinessId, () => repo.registerDevice({ passId: apple.id, deviceId: "foreign", pushToken: "foreign" })), null);
      const global = await context(null, () => repo.getSnapshot(apple.id), client, true);
      assert.equal(global.customer_name, "Ana");
      assert.equal(global.points, 10);
      assert.equal(global.business_name, "Test shop");
      assert.equal(global.is_voided, false);
    });

    await t.test("device registration is idempotent and returns monotonic update tags", async () => {
      const registration = { passId: apple.id, deviceId: "device-one", pushToken: "push-one" };
      const created = await context(businessId, () => repo.registerDevice(registration));
      assert.equal(created.created, true);
      const repeated = await context(businessId, () => repo.registerDevice({ ...registration, pushToken: "push-new" }));
      assert.equal(repeated.created, false);
      assert.equal((await context(businessId, () => repo.listRegistrations(apple.id))).length, 1);
      assert.equal((await context(businessId, () => repo.listRegistrations(apple.id)))[0].push_token, "push-new");
      const updates = await context(null, () => repo.getDeviceUpdates("device-one", "apple"), client, true);
      assert.deepEqual(updates.serial_numbers, [apple.serial_number]);
      assert.ok(BigInt(updates.last_updated) >= BigInt(apple.revision));
      assert.deepEqual((await context(null, () => repo.getDeviceUpdates("device-one", "apple", updates.last_updated), client, true)).serial_numbers, []);
      assert.deepEqual((await context(otherBusinessId, () => repo.getDeviceUpdates("device-one", "apple"))).serial_numbers, []);
    });

    await t.test("Apple update tags cannot skip revisions whose transactions commit out of order", async () => {
      const second = await context(otherBusinessId, () => repo.ensurePass(passInput("apple", {
        businessId: otherBusinessId, customerId: otherCustomerId
      })));
      await context(otherBusinessId, () => repo.registerDevice({ passId: second.id, deviceId: "device-one", pushToken: "push-one" }));
      const baseline = await context(null, () => repo.getDeviceUpdates("device-one", "apple"), peer, true);
      const pid = (await peer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await client.query("BEGIN");
      let pending;
      try {
        await context(businessId, () => client.query("UPDATE customer_balances SET points=11 WHERE customer_id=$1", [customerId]));
        await context(otherBusinessId, () => peer.query("UPDATE customer_balances SET points=12 WHERE customer_id=$1", [otherCustomerId]), peer);
        let settled = false;
        pending = context(null, () => repo.getDeviceUpdates("device-one", "apple", baseline.last_updated), peer, true)
          .then(value => { settled = true; return value; });
        // Wait for either the old implementation's early response or PostgreSQL's
        // row lock, so the test does not depend on a fixed delay before COMMIT.
        const deadline = Date.now() + 2000;
        while (!settled && Date.now() < deadline) {
          const activity = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
          if (activity.rows[0]?.wait_event_type === "Lock") break;
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        await client.query("COMMIT");
        const result = await pending;
        assert.deepEqual(result.serial_numbers.sort(), [apple.serial_number, second.serial_number].sort());
      } finally {
        await client.query("ROLLBACK");
        await pending;
        await admin.query("DELETE FROM native_wallet_passes WHERE id=$1", [second.id]);
      }
    });

    await t.test("issuance and customer deletion cannot commit an unrevoked orphan pass", async () => {
      await client.query("BEGIN");
      let pass, deletion;
      try {
        pass = await context(otherBusinessId, () => repo.ensurePass(passInput("apple", {
          businessId: otherBusinessId, customerId: otherCustomerId
        })));
        const pid = (await peer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        let settled = false;
        deletion = context(otherBusinessId, () => peer.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [otherCustomerId]), peer)
          .then(value => { settled = true; return value; });
        const deadline = Date.now() + 2000;
        while (!settled && Date.now() < deadline) {
          const activity = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
          if (activity.rows[0]?.wait_event_type === "Lock") break;
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        await client.query("COMMIT");
        await deletion;
        const persisted = (await admin.query("SELECT revoked_at FROM native_wallet_passes WHERE id=$1", [pass.id])).rows[0];
        assert.ok(persisted.revoked_at, "concurrent deletion must enqueue a voided pass");
      } finally {
        await client.query("ROLLBACK");
        await deletion;
        if (pass) await admin.query("DELETE FROM native_wallet_passes WHERE id=$1", [pass.id]);
        await admin.query("UPDATE customers SET deleted_at=NULL WHERE id=$1", [otherCustomerId]);
      }
    });

    await t.test("a pending writer allocates its revision only after acquiring the pass row lock", async () => {
      const pass = await context(otherBusinessId, () => repo.ensurePass(passInput("apple", {
        businessId: otherBusinessId, customerId: otherCustomerId
      })));
      const before = (await admin.query("SELECT last_value FROM native_wallet_revision_seq")).rows[0].last_value;
      const pid = (await peer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await client.query("BEGIN");
      let update;
      try {
        await context(otherBusinessId, () => client.query("SELECT id FROM native_wallet_passes WHERE id=$1 FOR SHARE", [pass.id]));
        update = context(otherBusinessId, () => peer.query("UPDATE customer_balances SET points=points+1 WHERE customer_id=$1", [otherCustomerId]), peer);
        const deadline = Date.now() + 2000;
        let waiting = false;
        while (!waiting && Date.now() < deadline) {
          const activity = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
          waiting = activity.rows[0]?.wait_event_type === "Lock";
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.equal(waiting, true);
        const during = (await admin.query("SELECT last_value FROM native_wallet_revision_seq")).rows[0].last_value;
        assert.equal(during, before, "blocked updates must not reserve an older Apple update tag");
      } finally {
        await client.query("ROLLBACK");
        await update;
        await admin.query("DELETE FROM native_wallet_passes WHERE id=$1", [pass.id]);
      }
    });

    await t.test("device registration is capped at twenty with concurrent inserts and still permits token refresh", async () => {
      for (let index = 0; index < 18; index++) {
        await context(businessId, () => repo.registerDevice({ passId: apple.id, deviceId: `cap-${index}`, pushToken: "capped" }));
      }
      const attempts = await Promise.allSettled([
        context(businessId, () => repo.registerDevice({ passId: apple.id, deviceId: "cap-race-a", pushToken: "capped" })),
        context(businessId, () => repo.registerDevice({ passId: apple.id, deviceId: "cap-race-b", pushToken: "capped" }), peer)
      ]);
      assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
      const rejected = attempts.find(result => result.status === "rejected");
      assert.match(rejected.reason.message, /device limit/i);
      assert.equal((await context(businessId, () => repo.listRegistrations(apple.id))).length, 20);
      assert.equal((await context(businessId, () => repo.registerDevice({ passId: apple.id, deviceId: "device-one", pushToken: "refreshed" }))).created, false);
      await admin.query("DELETE FROM native_wallet_registrations WHERE pass_id=$1 AND device_id LIKE 'cap-%'", [apple.id]);
    });

    await t.test("balance, customer and branding changes enqueue updates; old completion cannot lose a new revision", async () => {
      const claims = await context(null, () => repo.claimDue(20, ["apple", "google"]), client, true);
      assert.equal(claims.length, 2);
      const claim = claims.find(row => row.id === apple.id);
      assert.ok(claim.lock_token);
      assert.deepEqual(await context(null, () => repo.claimDue(20, ["apple", "google"]), peer, true), []);
      await context(businessId, () => client.query("UPDATE customer_balances SET points=42, tier='gold' WHERE customer_id=$1", [customerId]));
      const changed = await context(businessId, () => repo.getSnapshot(apple.id));
      assert.equal(changed.points, 42);
      assert.ok(BigInt(changed.revision) > BigInt(claim.revision));
      await context(null, () => repo.markSynced(apple.id, claim.revision, claim.lock_token), client, true);
      const pending = (await context(null, () => repo.claimDue(20, ["apple"]), client, true))[0];
      assert.equal(pending.id, apple.id);
      assert.equal(pending.revision, changed.revision);
      await context(null, () => repo.markSynced(apple.id, pending.revision, pending.lock_token), client, true);
      assert.deepEqual(await context(null, () => repo.claimDue(20, ["apple"]), client, true), []);
      await context(businessId, () => client.query("UPDATE customers SET name='Ana María' WHERE id=$1", [customerId]));
      const renamed = await context(businessId, () => repo.getSnapshot(apple.id));
      assert.ok(BigInt(renamed.revision) > BigInt(changed.revision));
      await context(businessId, () => client.query("UPDATE businesses SET customer_branding_json=$2 WHERE id=$1", [businessId, { accent_color: "#123456" }]));
      const branded = await context(businessId, () => repo.getSnapshot(apple.id));
      assert.ok(BigInt(branded.revision) > BigInt(renamed.revision));
      assert.equal(branded.customer_name, "Ana María");
      assert.equal(branded.customer_branding_json.accent_color, "#123456");
      const updates = await context(null, () => repo.getDeviceUpdates("device-one", "apple", apple.revision), client, true);
      assert.deepEqual(updates.serial_numbers, [apple.serial_number]);
      assert.ok(BigInt(updates.last_updated) > BigInt(apple.revision));
      const googleClaim = claims.find(row => row.id === google.id);
      await context(null, () => repo.markSynced(google.id, googleClaim.revision, googleClaim.lock_token), client, true);
    });

    await t.test("failed delivery uses durable bounded backoff and expired leases are fenced", async () => {
      const first = (await context(null, () => repo.claimDue(1, ["apple"]), client, true))[0];
      await context(null, () => repo.markFailed(first.id, first.lock_token), client, true);
      let row = (await admin.query("SELECT * FROM native_wallet_passes WHERE id=$1", [first.id])).rows[0];
      assert.equal(row.attempts, 1);
      assert.equal(row.locked_until, null);
      assert.ok(row.next_attempt_at.getTime() > Date.now());
      assert.deepEqual(await context(null, () => repo.claimDue(1, ["apple"]), client, true), []);
      await admin.query("UPDATE native_wallet_passes SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [first.id]);
      const expired = (await context(null, () => repo.claimDue(1, ["apple"]), client, true))[0];
      await admin.query("UPDATE native_wallet_passes SET locked_until=now()-interval '1 second' WHERE id=$1", [first.id]);
      const replacement = (await context(null, () => repo.claimDue(1, ["apple"]), peer, true))[0];
      assert.notEqual(expired.lock_token, replacement.lock_token);
      assert.equal(await context(null, () => repo.markSynced(first.id, expired.revision, expired.lock_token), client, true), null);
      assert.equal(await context(null, () => repo.markFailed(first.id, expired.lock_token), client, true), null);
      await admin.query("UPDATE native_wallet_passes SET attempts=100 WHERE id=$1", [first.id]);
      await context(null, () => repo.markFailed(first.id, replacement.lock_token), client, true);
      row = (await admin.query("SELECT * FROM native_wallet_passes WHERE id=$1", [first.id])).rows[0];
      assert.ok(row.next_attempt_at.getTime() - Date.now() <= 60 * 60 * 1000);
      assert.ok(row.next_attempt_at.getTime() - Date.now() > 59 * 60 * 1000);
    });

    await t.test("revocation permits a fresh pass while old devices receive a voided update", async () => {
      await context(businessId, () => repo.revokeCustomerPasses(businessId, customerId));
      const revoked = await context(businessId, () => repo.getSnapshot(apple.id));
      assert.ok(revoked.revoked_at);
      assert.equal(revoked.is_voided, true);
      const reissued = await context(businessId, () => repo.ensurePass(passInput()));
      assert.notEqual(reissued.id, apple.id);
      assert.notEqual(reissued.membership_token, apple.membership_token);
      await context(businessId, () => client.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [customerId]));
      const deleted = await context(businessId, () => repo.getSnapshot(reissued.id));
      assert.equal(deleted.is_voided, true);
      assert.ok(deleted.revoked_at);
      assert.equal(await context(businessId, () => repo.ensurePass(passInput())), null);
      await admin.query("DELETE FROM customers WHERE id=$1", [customerId]);
      assert.equal((await context(null, () => repo.getSnapshot(reissued.id), client, true)).is_voided, true);
      await context(businessId, () => repo.unregisterDevice(apple.id, "device-one"));
      assert.deepEqual(await context(businessId, () => repo.listRegistrations(apple.id)), []);
      await context(businessId, () => repo.registerDevice({ passId: apple.id, deviceId: "device-two", pushToken: "discard" }));
      await context(null, () => repo.deletePushToken("discard"), client, true);
      assert.deepEqual(await context(businessId, () => repo.listRegistrations(apple.id)), []);
      await admin.query("DELETE FROM businesses WHERE id=$1", [businessId]);
      assert.equal((await context(null, () => repo.getSnapshot(reissued.id), client, true)).is_voided, true);
    });

    await t.test("full historical migrations install native Wallet alongside the optional legacy extension", async () => {
      const directory = new URL("../../src/app/migrations/", import.meta.url);
      const files = orderMigrations((await readdir(directory)).filter(file => file.endsWith(".sql")));
      await admin.query("DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public");
      await admin.query(await readFile(new URL("../../src/app/schema.sql", import.meta.url), "utf8"));
      await admin.query(await readFile(new URL("../../src/app/schema-extensions.sql", import.meta.url), "utf8"));
      for (const file of files) {
        await admin.query("BEGIN");
        try {
          await admin.query(await readFile(new URL(file, directory), "utf8"));
          await admin.query("COMMIT");
        } catch (error) {
          await admin.query("ROLLBACK");
          throw new Error(`Historical migration ${file} failed: ${error.message}`, { cause: error });
        }
      }
      await admin.query(migration);
      const state = (await admin.query("SELECT to_regclass('native_wallet_passes') AS native, to_regclass('wallet_passes') AS legacy")).rows[0];
      assert.equal(state.native, "native_wallet_passes");
      assert.equal(state.legacy, "wallet_passes");
    });
  } finally {
    await Promise.all([admin.end(), client.end(), peer.end()]);
  }
});
