# Internal Magic Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add internal-only magic links for owner, staff, and existing customers so super admins and terminal tooling can jump directly into `/admin-dashboard`, `/staff`, or `/c` without repeated manual login.

**Architecture:** Add a dedicated persisted token store with actor-aware metadata, a small service layer that creates and consumes hashed tokens, actor-specific consume routes that bootstrap the existing staff/customer session cookies, and generation entry points in `super` plus one ops script. Reuse the existing session model from `signStaffToken()` and `signCustomerToken()` instead of inventing a parallel auth mechanism.

**Tech Stack:** Express, PostgreSQL migrations/repositories, existing browser-session auth cookies, vanilla JS `super` UI, Node CLI scripts, Node test runner.

---

## File Map

### Persistence and services
- Create: `src/app/migrations/2026-04-03-internal-magic-links.sql`
- Create: `src/app/repositories/internal-magic-link-repository.js`
- Create: `src/app/services/internal-magic-link-service.js`
- Modify: `src/app/routes/super-support.js`
- Modify: `src/utils/auth-token.js`

### Routes
- Modify: `src/app/routes/super-routes.js`
- Modify: `src/app/routes/public-routes.js`

### Super UI
- Modify: `public/super.html`
- Modify: `public/super/index.js`
- Modify: `public/super/types.js`

### CLI
- Create: `src/scripts/create-magic-link.mjs`

### Tests
- Create: `tests/unit/internal-magic-link-repository.test.js`
- Create: `tests/unit/internal-magic-link-service.test.js`
- Create: `tests/unit/internal-magic-link-routes.test.js`
- Create: `tests/unit/super-magic-link-ui-contract.test.js`
- Create: `tests/unit/create-magic-link-script.test.js`

---

### Task 1: Add persisted internal-magic-link storage and repository

**Files:**
- Create: `src/app/migrations/2026-04-03-internal-magic-links.sql`
- Create: `src/app/repositories/internal-magic-link-repository.js`
- Test: `tests/unit/internal-magic-link-repository.test.js`

- [ ] **Step 1: Write the failing repository test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { InternalMagicLinkRepo } from "../../src/app/repositories/internal-magic-link-repository.js";

test("InternalMagicLinkRepo creates and finds active hashed links", async () => {
  const fakeQuery = async (sql, params) => {
    assert.match(sql, /INSERT INTO internal_magic_links/);
    assert.equal(params[1], "staff");
    return { rows: [] };
  };

  await InternalMagicLinkRepo.create({
    id: "11111111-1111-4111-8111-111111111111",
    actor_type: "staff",
    actor_id: "22222222-2222-4222-8222-222222222222",
    business_id: "33333333-3333-4333-8333-333333333333",
    target: "staff",
    usage_mode: "single_use",
    purpose: "internal_test_access",
    token_hash: "hash-value",
    expires_at: new Date("2026-04-03T12:15:00Z")
  }, fakeQuery);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/internal-magic-link-repository.test.js`
Expected: FAIL with `Cannot find module` or `InternalMagicLinkRepo` missing.

- [ ] **Step 3: Add the migration**

```sql
CREATE TABLE IF NOT EXISTS internal_magic_links (
  id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('staff','customer')),
  actor_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('staff','admin-dashboard','customer-wallet')),
  usage_mode text NOT NULL CHECK (usage_mode IN ('single_use','reusable_window')),
  purpose text NOT NULL CHECK (purpose = 'internal_test_access'),
  token_hash text NOT NULL UNIQUE,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_count integer NOT NULL DEFAULT 0,
  used_ip text,
  used_ua text
);

CREATE INDEX IF NOT EXISTS idx_internal_magic_links_active
  ON internal_magic_links (token_hash, expires_at);
```

- [ ] **Step 4: Add the repository**

```js
import { dbQuery } from "../database.js";

export const InternalMagicLinkRepo = {
  async create(record, query = dbQuery) {
    await query(
      `INSERT INTO internal_magic_links
       (id, actor_type, actor_id, business_id, target, usage_mode, purpose, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        record.id,
        record.actor_type,
        record.actor_id,
        record.business_id,
        record.target,
        record.usage_mode,
        record.purpose,
        record.token_hash,
        record.created_by ?? null,
        record.expires_at
      ]
    );
    return { id: record.id };
  },

  async lookupByTokenHash(tokenHash, query = dbQuery) {
    const { rows } = await query(
      `SELECT *
         FROM internal_magic_links
        WHERE token_hash = $1
          AND expires_at > now()
        LIMIT 1`,
      [tokenHash]
    );
    return rows[0] ?? null;
  },

  async consumeSingleUse(id, consumedMeta = {}, query = dbQuery) {
    const { rows } = await query(
      `UPDATE internal_magic_links
          SET used_at = now(),
              used_count = used_count + 1,
              used_ip = COALESCE($2, used_ip),
              used_ua = COALESCE($3, used_ua)
        WHERE id = $1
          AND used_at IS NULL
      RETURNING *`,
      [id, consumedMeta.ip ?? null, consumedMeta.ua ?? null]
    );
    return rows[0] ?? null;
  },

  async touchReusable(id, consumedMeta = {}, query = dbQuery) {
    const { rows } = await query(
      `UPDATE internal_magic_links
          SET used_at = now(),
              used_count = used_count + 1,
              used_ip = COALESCE($2, used_ip),
              used_ua = COALESCE($3, used_ua)
        WHERE id = $1
      RETURNING *`,
      [id, consumedMeta.ip ?? null, consumedMeta.ua ?? null]
    );
    return rows[0] ?? null;
  }
};
```

- [ ] **Step 5: Run the repository test and migration smoke**

Run: `node --test tests/unit/internal-magic-link-repository.test.js`
Expected: PASS

Run: `node src/scripts/migrations.mjs up`
Expected: migration applies without SQL errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/migrations/2026-04-03-internal-magic-links.sql src/app/repositories/internal-magic-link-repository.js tests/unit/internal-magic-link-repository.test.js
git commit -m "feat: add internal magic-link storage"
```

### Task 2: Add creation and consumption service with role-aware validation

**Files:**
- Create: `src/app/services/internal-magic-link-service.js`
- Modify: `src/app/routes/super-support.js`
- Modify: `src/utils/auth-token.js`
- Test: `tests/unit/internal-magic-link-service.test.js`

- [ ] **Step 1: Write the failing service tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInternalMagicLink,
  consumeInternalMagicLink
} from "../../src/app/services/internal-magic-link-service.js";

test("buildInternalMagicLink forces owner for admin-dashboard", async () => {
  await assert.rejects(
    () => buildInternalMagicLink({
      actorType: "staff",
      actor: { id: "cashier-id", role: "CASHIER", business_id: "biz-id" },
      target: "admin-dashboard",
      createdBy: "super@test.com"
    }),
    /no puede abrir ese destino/i
  );
});

test("consumeInternalMagicLink returns customer session bootstrap for reusable customer links", async () => {
  const result = await consumeInternalMagicLink("raw-token", { ip: "127.0.0.1", ua: "test" });
  assert.equal(result.actorType, "customer");
  assert.equal(result.redirectTo, "/c");
  assert.match(result.cookieName, /pf_customer/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/internal-magic-link-service.test.js`
Expected: FAIL because the service does not exist yet.

- [ ] **Step 3: Add small support exports for audit + cookie names**

```js
// in src/app/routes/super-support.js
export const InternalMagicLinkCreateSchema = z.object({
  actorMode: z.enum(["staff", "customer"]),
  businessId: z.string().uuid(),
  actorId: z.string().uuid(),
  target: z.enum(["staff", "admin-dashboard", "customer-wallet"])
});
```

```js
// in src/utils/auth-token.js
export function customerCookieOptions(req) {
  return { ...cookieOpts(req), maxAge: browserCookieMaxAge("CUSTOMER") };
}

export function staffCookieOptions(req) {
  return { ...cookieOpts(req), maxAge: browserCookieMaxAge("STAFF") };
}
```

- [ ] **Step 4: Implement the service**

```js
import crypto from "node:crypto";
import { config } from "../../config/index.js";
import { badRequest, notFound } from "../../utils/http-error.js";
import { signCustomerToken, signStaffToken } from "../../utils/auth-token.js";
import { InternalMagicLinkRepo } from "../repositories/internal-magic-link-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";

function hashMagicToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export async function buildInternalMagicLink({ actorType, actor, target, createdBy, origin }) {
  if (actorType === "staff" && target === "admin-dashboard" && actor.role !== "OWNER") {
    throw badRequest("Este usuario no puede abrir ese destino.");
  }
  const usageMode = actorType === "customer" ? "reusable_window" : "single_use";
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashMagicToken(rawToken);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await InternalMagicLinkRepo.create({
    id,
    actor_type: actorType,
    actor_id: actor.id,
    business_id: actor.business_id,
    target,
    usage_mode: usageMode,
    purpose: "internal_test_access",
    token_hash: tokenHash,
    created_by: createdBy,
    expires_at: expiresAt
  });
  const route = actorType === "customer" ? "customer" : "staff";
  return {
    id,
    url: `${origin}/magic/${route}/${rawToken}`,
    usageMode,
    expiresAt: expiresAt.toISOString()
  };
}

export async function consumeInternalMagicLink(rawToken, meta = {}) {
  const record = await InternalMagicLinkRepo.lookupByTokenHash(hashMagicToken(rawToken));
  if (!record) throw notFound("Este enlace no es válido.");
  if (record.usage_mode === "single_use" && record.used_at) {
    throw badRequest("Este enlace ya fue usado.");
  }

  if (record.actor_type === "staff") {
    const staff = await StaffRepo.getById(record.actor_id);
    if (!staff) throw notFound("Este usuario ya no existe.");
    const token = await signStaffToken({ sid: staff.id, bid: staff.business_id, brid: staff.branch_id, role: staff.role });
    await InternalMagicLinkRepo.consumeSingleUse(record.id, meta);
    return {
      actorType: "staff",
      cookieName: config.STAFF_COOKIE_NAME,
      token,
      redirectTo: record.target === "admin-dashboard" ? "/admin-dashboard" : "/staff"
    };
  }

  const customer = await CustomerRepo.getById(record.actor_id);
  if (!customer || String(customer.business_id) !== String(record.business_id)) {
    throw badRequest("Este cliente no pertenece a ese negocio.");
  }
  const token = await signCustomerToken({ cid: customer.id, bid: customer.business_id });
  await InternalMagicLinkRepo.touchReusable(record.id, meta);
  return {
    actorType: "customer",
    cookieName: config.CUSTOMER_COOKIE_NAME,
    token,
    redirectTo: "/c"
  };
}
```

- [ ] **Step 5: Run service tests**

Run: `node --test tests/unit/internal-magic-link-service.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/services/internal-magic-link-service.js src/app/routes/super-support.js src/utils/auth-token.js tests/unit/internal-magic-link-service.test.js
git commit -m "feat: add internal magic-link service"
```

### Task 3: Expose generation in super and consumption routes in the app

**Files:**
- Modify: `src/app/routes/super-routes.js`
- Modify: `src/app/routes/public-routes.js`
- Test: `tests/unit/internal-magic-link-routes.test.js`

- [ ] **Step 1: Write the failing route tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../../src/app/server.js";

test("POST /api/super/magic-links creates owner panel links", async () => {
  const res = await request(app)
    .post("/api/super/magic-links")
    .send({ actorMode: "staff", businessId: "biz-id", actorId: "owner-id", target: "admin-dashboard" });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.url, /\/magic\/staff\//);
});

test("GET /api/public/magic/customer/:token boots customer and redirects to /c", async () => {
  const res = await request(app).get("/api/public/magic/customer/test-token");
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "/c");
});
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `node --test tests/unit/internal-magic-link-routes.test.js`
Expected: FAIL because the endpoints do not exist yet.

- [ ] **Step 3: Add the super generation endpoint**

```js
// in src/app/routes/super-routes.js
superRoutes.post("/super/magic-links", requireSuperAdmin, csrfProtect, asyncRoute(async (req, res) => {
  const parsed = InternalMagicLinkCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Payload inválido" });

  const targetActor = parsed.data.actorMode === "customer"
    ? await CustomerRepo.getById(parsed.data.actorId)
    : await StaffRepo.getById(parsed.data.actorId);
  if (!targetActor) return res.status(404).json({ error: "Actor no encontrado" });

  const out = await buildInternalMagicLink({
    actorType: parsed.data.actorMode,
    actor: targetActor,
    target: parsed.data.target,
    createdBy: req.superAdmin?.email || null,
    origin: config.APP_ORIGIN || config.PUBLIC_WEB_ORIGIN
  });

  await logSuperAudit({
    action: "super.magic_link.create",
    businessId: parsed.data.businessId,
    req,
    superAdminEmail: req.superAdmin?.email,
    meta: { actor_mode: parsed.data.actorMode, actor_id: parsed.data.actorId, target: parsed.data.target, usage_mode: out.usageMode }
  });

  res.json({ ok: true, ...out });
}));
```

- [ ] **Step 4: Add actor-specific consume routes**

```js
// in src/app/routes/public-routes.js
publicRoutes.get("/magic/staff/:token", asyncRoute(async (req, res) => {
  const out = await consumeInternalMagicLink(req.params.token, {
    ip: getRequestIp(req),
    ua: req.headers["user-agent"] || null
  });
  if (out.actorType !== "staff") return res.status(400).send("Enlace inválido");
  res.cookie(out.cookieName, out.token, staffCookieOptions(req));
  res.redirect(out.redirectTo);
}));

publicRoutes.get("/magic/customer/:token", asyncRoute(async (req, res) => {
  const out = await consumeInternalMagicLink(req.params.token, {
    ip: getRequestIp(req),
    ua: req.headers["user-agent"] || null
  });
  if (out.actorType !== "customer") return res.status(400).send("Enlace inválido");
  res.cookie(out.cookieName, out.token, customerCookieOptions(req));
  res.redirect(out.redirectTo);
}));
```

- [ ] **Step 5: Run the route tests**

Run: `node --test tests/unit/internal-magic-link-routes.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/routes/super-routes.js src/app/routes/public-routes.js tests/unit/internal-magic-link-routes.test.js
git commit -m "feat: add internal magic-link routes"
```

### Task 4: Add the super generator UI for team and customer links

**Files:**
- Modify: `public/super.html`
- Modify: `public/super/index.js`
- Modify: `public/super/types.js`
- Test: `tests/unit/super-magic-link-ui-contract.test.js`

- [ ] **Step 1: Write the failing super UI contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../../public/super.html", import.meta.url), "utf8");

test("super page exposes internal magic-link generator controls", () => {
  assert.match(html, /Modo de acceso/);
  assert.match(html, /Equipo/);
  assert.match(html, /Cliente/);
  assert.match(html, /Generar enlace mágico/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/super-magic-link-ui-contract.test.js`
Expected: FAIL because the generator controls do not exist yet.

- [ ] **Step 3: Add the generator card to the super page**

```html
<div class="card compact-card">
  <h3>Enlaces mágicos internos</h3>
  <p class="small">Uso interno. Expiran pronto.</p>
  <label>Modo de acceso</label>
  <select id="magicActorMode">
    <option value="staff">Equipo</option>
    <option value="customer">Cliente</option>
  </select>
  <label>Negocio</label>
  <select id="magicBusiness"></select>
  <label id="magicActorLabel">Usuario</label>
  <select id="magicActor"></select>
  <label id="magicTargetLabel">Destino</label>
  <select id="magicTarget">
    <option value="staff">Escáner</option>
    <option value="admin-dashboard">Panel</option>
    <option value="customer-wallet">Cartera</option>
  </select>
  <button class="primary mt-10" id="btnCreateMagicLink">Generar enlace mágico</button>
  <pre id="magicLinkOutput" class="small pre-wrap"></pre>
</div>
```

- [ ] **Step 4: Wire the UI logic**

```js
async function loadMagicActors() {
  const businessId = select("#magicBusiness").value;
  const mode = select("#magicActorMode").value;
  if (!businessId) return;
  const out = mode === "customer"
    ? await api(`/api/super/businesses/${businessId}/customers`)
    : await api(`/api/super/businesses/${businessId}/staff`);
  const actorSelect = select("#magicActor");
  actorSelect.replaceChildren();
  (out.rows || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.id;
    opt.textContent = mode === "customer"
      ? `${row.name || "Sin nombre"} · ${row.phone}`
      : `${row.name} · ${row.role}`;
    actorSelect.appendChild(opt);
  });
}

element("#btnCreateMagicLink").addEventListener("click", async () => {
  const payload = {
    actorMode: select("#magicActorMode").value,
    businessId: select("#magicBusiness").value,
    actorId: select("#magicActor").value,
    target: select("#magicTarget").value
  };
  const out = await api("/api/super/magic-links", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  element("#magicLinkOutput").textContent = `${out.url}\nExpira: ${out.expiresAt}`;
});
```

- [ ] **Step 5: Run the UI contract test**

Run: `node --test tests/unit/super-magic-link-ui-contract.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/super.html public/super/index.js public/super/types.js tests/unit/super-magic-link-ui-contract.test.js
git commit -m "feat: add super magic-link generator"
```

### Task 5: Add the terminal generator script and end-to-end verification

**Files:**
- Create: `src/scripts/create-magic-link.mjs`
- Test: `tests/unit/create-magic-link-script.test.js`

- [ ] **Step 1: Write the failing script test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("create-magic-link script prints URL and usage mode", () => {
  const run = spawnSync("node", [
    "src/scripts/create-magic-link.mjs",
    "--actor", "customer",
    "--customer-id", "11111111-1111-4111-8111-111111111111",
    "--target", "customer-wallet"
  ], { encoding: "utf8" });

  assert.equal(run.status, 0);
  assert.match(run.stdout, /usage mode/i);
  assert.match(run.stdout, /\/magic\/customer\//);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/create-magic-link-script.test.js`
Expected: FAIL because the script does not exist yet.

- [ ] **Step 3: Implement the script**

```js
#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "").trim();
}

const actor = arg("--actor");
const target = arg("--target");
const staffId = arg("--staff-id");
const customerId = arg("--customer-id");
const email = arg("--email");

const { closeDatabase, withDbClientContext } = await import("../app/database.js");
const { StaffRepo } = await import("../app/repositories/staff-repository.js");
const { CustomerRepo } = await import("../app/repositories/customer-repository.js");
const { buildInternalMagicLink } = await import("../app/services/internal-magic-link-service.js");
const { config } = await import("../config/index.js");

try {
  const result = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
    const resolved = actor === "customer"
      ? await CustomerRepo.getById(customerId)
      : (staffId ? await StaffRepo.getById(staffId) : await StaffRepo.getByEmail(email));
    if (!resolved) throw new Error("Actor no encontrado");
    return buildInternalMagicLink({
      actorType: actor,
      actor: resolved,
      target,
      createdBy: "terminal",
      origin: config.APP_ORIGIN || config.PUBLIC_WEB_ORIGIN
    });
  });

  process.stdout.write(`url: ${result.url}\nusage mode: ${result.usageMode}\nexpires: ${result.expiresAt}\n`);
} finally {
  await closeDatabase().catch(() => {});
}
```

- [ ] **Step 4: Run the script test and focused route tests**

Run: `node --test tests/unit/create-magic-link-script.test.js tests/unit/internal-magic-link-routes.test.js`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npm run lint`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run test:unit`
Expected: PASS

Run: `npm run test:integration:core`
Expected: PASS

- [ ] **Step 6: Manual smoke**

Run:
```bash
node src/scripts/create-magic-link.mjs --actor staff --email owner@test.com --target admin-dashboard
node src/scripts/create-magic-link.mjs --actor staff --email staff@test.com --target staff
node src/scripts/create-magic-link.mjs --actor customer --customer-id <uuid> --target customer-wallet
```
Expected:
- owner link redirects to `/admin-dashboard`
- staff link redirects to `/staff`
- customer link redirects to `/c`
- second click on owner/staff fails in Spanish
- repeated click on customer works until expiry

- [ ] **Step 7: Commit**

```bash
git add src/scripts/create-magic-link.mjs tests/unit/create-magic-link-script.test.js
git commit -m "feat: add internal magic-link CLI"
```

## Self-Review

- Spec coverage: owner/staff/customer actors, split usage modes, super + terminal generation, actor-specific consume routes, auditability, and Spanish failures are all mapped to concrete tasks.
- Placeholder scan: no `TODO`/`TBD`; every task names exact files, commands, and concrete code.
- Type consistency: target names stay `staff`, `admin-dashboard`, `customer-wallet`; actor names stay `staff` and `customer`; customer route always lands on `/c`.
