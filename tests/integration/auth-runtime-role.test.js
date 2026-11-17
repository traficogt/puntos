import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

// Account recovery, TOTP and security events through the HTTP routes, with the
// application pool connected as a LOGIN NOSUPERUSER NOBYPASSRLS role, as in
// production (`puntos_app`). The admin client only creates fixtures and reads
// results; every exercised path runs as the runtime role.
const databaseUrl = process.env.AUTH_RUNTIME_TEST_DB_URL;
const role = "auth_runtime_app";
const rolePassword = "auth-runtime-test-only";
// Synthetic account passwords below end in "!", like the browser tests' fixture
// passwords, so secret scanners do not read them as credentials.

const sha256 = value => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const rawToken = () => crypto.randomBytes(32).toString("base64url");

test("staff and super account security works under the NOBYPASSRLS runtime role", { skip: !databaseUrl, timeout: 90000 }, async t => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.ok(url.port && url.port !== "5432", "Use an explicit non-default PostgreSQL port for the disposable test database");
  assert.equal(url.pathname, "/auth_runtime_test");
  // Configure the application's pools before any application module loads.
  Object.assign(process.env, {
    DB_HOST: url.hostname.replace(/^\[|\]$/g, ""), DB_PORT: url.port, DB_NAME: url.pathname.slice(1),
    DB_USER: role, DB_PASSWORD: rolePassword, DB_PASSWORD_FILE: "",
    DB_MIGRATIONS_USER: decodeURIComponent(url.username), DB_MIGRATIONS_PASSWORD: decodeURIComponent(url.password),
    JWT_SECRET: "auth-runtime-test-signing-key-only-0123456789",
    WEBHOOK_SECRET_ENC_KEY: "auth-runtime-test-encryption-key-only",
    RATE_LIMIT_DRIVER: "memory", MESSAGE_PROVIDER: "dev"
  });

  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  let server, closeDatabase;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (closeDatabase) await closeDatabase();
    await admin.end();
  });

  await admin.query(`DO $$ BEGIN CREATE ROLE ${role} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  const { buildGrantPlan } = await import("../../src/scripts/create-app-role.mjs");
  const plan = buildGrantPlan({ appDbUser: role, dbName: url.pathname.slice(1) });
  for (const statement of plan.statements) await admin.query(statement);
  await admin.query(plan.grantFunctionsSql);

  const { hashPassword, verifyPassword } = await import("../../src/utils/password-hash.js");
  const { encryptSecret } = await import("../../src/utils/secret-crypto.js");
  const { generateBase32Secret, totp } = await import("../../src/utils/totp.js");

  const businessId = crypto.randomUUID(), otherBusinessId = crypto.randomUUID();
  const staffId = crypto.randomUUID(), customerId = crypto.randomUUID();
  const staffEmail = `cajero-${businessId.slice(0, 8)}@example.test`;
  const superEmail = `plataforma-${businessId.slice(0, 8)}@example.test`;
  await admin.query(
    `INSERT INTO businesses (id, name, slug, email, password_hash, plan, program_type, program_json)
     VALUES ($1, 'Cafetería Runtime', $2, $3, 'fixture', 'EMPRESA', 'SPEND', '{"points_per_q":1}'),
            ($4, 'Otra Runtime', $5, $6, 'fixture', 'EMPRESA', 'SPEND', '{}')`,
    [businessId, `runtime-${businessId}`, `${businessId}@example.test`, otherBusinessId, `runtime-${otherBusinessId}`, `${otherBusinessId}@example.test`]
  );
  await admin.query(
    `INSERT INTO staff_users (id, business_id, name, email, role, password_hash, active)
     VALUES ($1, $2, 'Ana Runtime', $3, 'OWNER', $4, true)`,
    [staffId, businessId, staffEmail, await hashPassword("Volcan-Agua-Inicial-4821!")]
  );
  await admin.query("INSERT INTO customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Cliente Runtime')", [customerId, businessId, `502${String(Date.now()).slice(-8)}`]);
  await admin.query(
    `INSERT INTO super_admin_auth_settings (singleton, email, password_hash) VALUES (true, $1, $2)
     ON CONFLICT (singleton) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash`,
    [superEmail, await hashPassword("Lago-Atitlan-Plataforma-9157!")]
  );

  const db = await import("../../src/app/database.js");
  closeDatabase = db.closeDatabase;
  const identity = (await db.pool.query("SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user")).rows[0];
  assert.deepEqual(identity, { rolsuper: false, rolbypassrls: false }, "the application pool must run as the restricted runtime role");

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { withPgClient } = await import("../../src/middleware/pg-client.js");
  const { errorHandler } = await import("../../src/middleware/common.js");
  const { publicRoutes } = await import("../../src/app/routes/public-routes.js");
  const { staffRoutes } = await import("../../src/app/routes/staff-routes.js");
  const { superRoutes } = await import("../../src/app/routes/super-routes.js");
  const { reauthenticateStaffSession, requestStaffEmailChange } = await import("../../src/app/services/account-security-service.js");
  const { awardPointsWithDeps } = await import("../../src/app/services/staff-award-service.js");
  const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
  const { signSuperToken } = await import("../../src/utils/auth-token.js");
  const { config } = await import("../../src/config/index.js");

  // The production request middleware: a dedicated client with no tenant and no platform flag.
  const app = express();
  app.use(cookieParser());
  app.use(withPgClient);
  app.use(express.json());
  app.use("/api", publicRoutes, staffRoutes, superRoutes);
  app.use(errorHandler);
  server = await new Promise(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  /** @param {string} path @param {{ body?: any, method?: string, cookie?: string }} [options] */
  const call = async (path, { body, method = body ? "POST" : "GET", cookie } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const insertToken = async ({ actorType = "STAFF", actorId = staffId, actorEmail, business = businessId, purpose, token, requestId = null, payload = {} }) => {
    await admin.query(
      `INSERT INTO auth_action_tokens (id, request_id, actor_type, actor_id, actor_email, business_id, purpose, token_hash, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '30 minutes')`,
      [crypto.randomUUID(), requestId, actorType, actorId, actorEmail, business, purpose, sha256(token), payload]
    );
  };
  const tokenRow = async token => (await admin.query("SELECT * FROM auth_action_tokens WHERE token_hash = $1", [sha256(token)])).rows[0];
  const staffRow = async () => (await admin.query("SELECT * FROM staff_users WHERE id = $1", [staffId])).rows[0];
  const eventCount = async (eventType, extra = "") => Number((await admin.query(`SELECT count(*)::int AS n FROM security_events WHERE event_type = $1 ${extra}`, [eventType])).rows[0].n);

  await t.test("staff password reset completes from the public route and its token is single use", async () => {
    assert.equal((await call("/api/public/staff/password-reset/request", { body: { email: staffEmail } })).status, 200);
    const issued = (await admin.query(
      "SELECT id, business_id FROM auth_action_tokens WHERE actor_id = $1 AND purpose = 'STAFF_PASSWORD_RESET' AND used_at IS NULL",
      [staffId]
    )).rows;
    assert.equal(issued.length, 1, "the request route issues one reset token");
    assert.equal(issued[0].business_id, businessId);
    const token = rawToken(), older = rawToken();
    await admin.query("UPDATE auth_action_tokens SET token_hash = $2 WHERE id = $1", [issued[0].id, sha256(token)]);
    await insertToken({ actorEmail: staffEmail, purpose: "STAFF_PASSWORD_RESET", token: older });

    const done = await call("/api/public/staff/password-reset/confirm", { body: { token, newPassword: "Cerro-Verde-Nuevo-7350!" } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await verifyPassword("Cerro-Verde-Nuevo-7350!", (await staffRow()).password_hash), true);
    assert.equal((await tokenRow(token)).consumed_meta.completed, true);
    const invalidated = await tokenRow(older);
    assert.ok(invalidated.used_at, "an older outstanding reset link is invalidated");
    assert.equal(invalidated.consumed_meta.invalidated, true);

    assert.equal((await call("/api/public/staff/password-reset/confirm", { body: { token, newPassword: "Otra-Clave-Distinta-1185!" } })).status, 400);
    assert.equal((await call("/api/public/staff/password-reset/confirm", { body: { token: older, newPassword: "Otra-Clave-Distinta-1185!" } })).status, 400);
    assert.equal(await verifyPassword("Cerro-Verde-Nuevo-7350!", (await staffRow()).password_hash), true);
  });

  await t.test("concurrent confirmations of one reset token apply it exactly once", async () => {
    const token = rawToken();
    await insertToken({ actorEmail: staffEmail, purpose: "STAFF_PASSWORD_RESET", token });
    const passwords = ["Rio-Dulce-Primera-2290!", "Rio-Dulce-Segunda-6604!"];
    const results = await Promise.all(passwords.map(newPassword => call("/api/public/staff/password-reset/confirm", { body: { token, newPassword } })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    const winner = passwords[results.findIndex(result => result.status === 200)];
    assert.equal(await verifyPassword(winner, (await staffRow()).password_hash), true);
    // Restore the known password for the remaining checks.
    const reset = rawToken();
    await insertToken({ actorEmail: staffEmail, purpose: "STAFF_PASSWORD_RESET", token: reset });
    assert.equal((await call("/api/public/staff/password-reset/confirm", { body: { token: reset, newPassword: "Cerro-Verde-Nuevo-7350!" } })).status, 200);
  });

  await t.test("a TOTP code accepted at login cannot be replayed", async () => {
    const secret = generateBase32Secret();
    await admin.query("UPDATE staff_users SET mfa_enabled = true, mfa_secret_enc = $2, mfa_last_totp_step = NULL WHERE id = $1", [staffId, encryptSecret(secret)]);
    const mfaCode = totp(secret);
    const first = await call("/api/staff/login", { body: { email: staffEmail, password: "Cerro-Verde-Nuevo-7350!", mfaCode } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.ok(Number((await staffRow()).mfa_last_totp_step) > 0, "the accepted time step is recorded");
    const replay = await call("/api/staff/login", { body: { email: staffEmail, password: "Cerro-Verde-Nuevo-7350!", mfaCode } });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error, "MFA_REQUIRED");
    await assert.rejects(db.withDbClientContext({ tenantId: businessId }, () => reauthenticateStaffSession({
      staff: { id: staffId }, password: "Cerro-Verde-Nuevo-7350!", mfaCode, sessionId: crypto.randomUUID()
    })), { statusCode: 401, message: "Invalid MFA code" }, "re-authentication refuses the same code");
    await admin.query("UPDATE staff_users SET mfa_enabled = false, mfa_secret_enc = NULL WHERE id = $1", [staffId]);
  });

  await t.test("staff email change applies after both confirmations and revokes older links", async () => {
    const newEmail = `ana-nueva-${businessId.slice(0, 8)}@example.test`;
    const { requestId } = await db.withDbClientContext({ tenantId: businessId }, () => requestStaffEmailChange({ staff: { id: staffId }, newEmail }));
    const oldToken = rawToken(), newToken = rawToken(), pendingReset = rawToken();
    await admin.query("UPDATE auth_action_tokens SET token_hash = CASE purpose WHEN 'STAFF_EMAIL_CHANGE_OLD' THEN $2 ELSE $3 END WHERE request_id = $1", [requestId, sha256(oldToken), sha256(newToken)]);
    await insertToken({ actorEmail: staffEmail, purpose: "STAFF_PASSWORD_RESET", token: pendingReset });

    const results = await Promise.all([oldToken, newToken].map(token => call("/api/public/staff/email-change/confirm", { body: { token } })));
    assert.deepEqual(results.map(result => result.status), [200, 200], JSON.stringify(results.map(result => result.body)));
    assert.deepEqual(results.map(result => result.body.applied).sort(), [false, true], "the second confirmation sees the first and applies the change once");
    assert.equal((await staffRow()).email, newEmail);
    assert.equal((await tokenRow(pendingReset)).consumed_meta.invalidated, true);
    assert.equal((await call("/api/public/staff/password-reset/confirm", { body: { token: pendingReset, newPassword: "Antigua-Guatemala-3361!" } })).status, 400);
    assert.equal((await call("/api/public/staff/email-change/confirm", { body: { token: newToken } })).status, 400);
    const login = await call("/api/staff/login", { body: { email: newEmail, password: "Cerro-Verde-Nuevo-7350!" } });
    assert.equal(login.status, 200, "the staff login index follows the new address");
  });

  await t.test("super admin reset is bound to the current address and revokes older links", async () => {
    assert.equal((await call("/api/public/super/password-reset/request", { body: { email: superEmail } })).status, 200);
    const issued = (await admin.query("SELECT id FROM auth_action_tokens WHERE actor_type = 'SUPER' AND purpose = 'SUPER_PASSWORD_RESET' AND used_at IS NULL")).rows;
    assert.equal(issued.length, 1);
    const token = rawToken(), older = rawToken(), formerAddress = rawToken();
    await admin.query("UPDATE auth_action_tokens SET token_hash = $2 WHERE id = $1", [issued[0].id, sha256(token)]);
    await insertToken({ actorType: "SUPER", actorId: null, actorEmail: superEmail, business: null, purpose: "SUPER_PASSWORD_RESET", token: older });
    await insertToken({ actorType: "SUPER", actorId: null, actorEmail: "anterior@example.test", business: null, purpose: "SUPER_PASSWORD_RESET", token: formerAddress });

    assert.equal((await call("/api/public/super/password-reset/confirm", { body: { token: formerAddress, newPassword: "Tikal-Templo-Mayor-5508!" } })).status, 400);
    const done = await call("/api/public/super/password-reset/confirm", { body: { token, newPassword: "Tikal-Templo-Mayor-5508!" } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const settings = (await admin.query("SELECT password_hash FROM super_admin_auth_settings WHERE singleton = true")).rows[0];
    assert.equal(await verifyPassword("Tikal-Templo-Mayor-5508!", settings.password_hash), true);
    assert.equal((await tokenRow(older)).consumed_meta.invalidated, true);
    assert.equal((await call("/api/public/super/password-reset/confirm", { body: { token: older, newPassword: "Otra-Super-Clave-2741!" } })).status, 400);
    assert.equal((await call("/api/public/super/password-reset/confirm", { body: { token, newPassword: "Otra-Super-Clave-2741!" } })).status, 400);
  });

  await t.test("context-free security events persist and appear in the super security posture", async () => {
    const before = {
      super: await eventCount("super_login_failed"),
      staff: await eventCount("staff_login_failed", "AND business_id IS NULL"),
      csrf: await eventCount("csrf_denied"),
      replay: await eventCount("qr_replay_blocked", `AND business_id = '${businessId}'`)
    };
    assert.equal((await call("/api/super/login", { body: { email: superEmail, password: "Clave-Incorrecta-0000!" } })).status, 401);
    assert.equal((await call("/api/staff/login", { body: { email: "nadie@example.test", password: "Clave-Incorrecta-0000!" } })).status, 401);
    // csrfProtect runs before requireSuperAdmin on this route: no actor or tenant exists yet.
    assert.equal((await call("/api/super/businesses", { body: { name: "x" } })).status, 403);

    const jti = `replayed-${crypto.randomUUID()}`;
    await admin.query("INSERT INTO qr_tokens (jti, business_id, customer_id, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')", [jti, businessId, customerId]);
    await assert.rejects(db.withDbClientContext({ tenantId: businessId }, () => awardPointsWithDeps({
      verifyQrToken: async () => ({ bid: businessId, cid: customerId, jti, exp: Math.floor(Date.now() / 1000) + 300 }),
      BusinessRepo,
      computePoints: () => 10,
      planLimits: () => ({ activeCustomers: 1000 }),
      withTransaction: db.withTransaction,
      enqueueWebhookEvent: async () => {}
    }, { staff: { id: staffId, business_id: businessId, branch_id: null, role: "OWNER" }, customerQrToken: "fixture", amount_q: 10 })), { statusCode: 409 });

    assert.equal(await eventCount("super_login_failed"), before.super + 1);
    assert.equal(await eventCount("staff_login_failed", "AND business_id IS NULL"), before.staff + 1);
    assert.equal(await eventCount("csrf_denied"), before.csrf + 1);
    assert.equal(await eventCount("qr_replay_blocked", `AND business_id = '${businessId}'`), before.replay + 1, "the replay event survives the rolled-back award");

    const session = await signSuperToken({ email: superEmail, reauthVerified: true });
    const posture = await call("/api/super/security/posture", { cookie: `${config.SUPER_COOKIE_NAME}=${session}` });
    assert.equal(posture.status, 200, JSON.stringify(posture.body));
    for (const key of ["super_login_failed", "staff_login_failed", "csrf_denied", "qr_replay_blocked"]) {
      assert.ok(posture.body.counts[key] >= 1, `${key} is counted in the posture report`);
    }
  });
});
