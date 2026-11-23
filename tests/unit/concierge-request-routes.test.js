import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";

import { createConciergeRoutes } from "../../src/app/routes/admin/concierge.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { AuditRepo } from "../../src/app/repositories/audit-repository.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";

const businessId = randomUUID();
const staffId = randomUUID();
let role;
let audits;
let sent;
let server;
let origin;
let cookie;
const originals = {
  staff: StaffRepo.getById,
  business: BusinessRepo.getById,
  audit: AuditRepo.log,
};

before(async () => {
  StaffRepo.getById = async () => ({
    id: staffId,
    business_id: businessId,
    role,
    branch_id: null,
    active: true,
    email: "owner@example.com",
  });
  BusinessRepo.getById = async () => ({
    id: businessId,
    name: "Café Prueba",
    slug: "cafe-prueba",
    plan: "EMPRENDEDOR",
  });
  AuditRepo.log = async (entry) => {
    audits.push(entry);
  };
  const session = await createBrowserSession({
    actorType: "STAFF",
    actorId: staffId,
    businessId,
    role: "OWNER",
  });
  cookie = `${config.STAFF_COOKIE_NAME}=${session.token}`;
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // The mailer is injected so the test never touches SMTP and can assert exactly what would be sent.
  app.use(
    "/api",
    createConciergeRoutes({
      sendEmail: async (payload) => {
        sent.push(payload);
      },
    }),
  );
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  role = "OWNER";
  audits = [];
  sent = [];
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  StaffRepo.getById = originals.staff;
  BusinessRepo.getById = originals.business;
  AuditRepo.log = originals.audit;
});

async function post(body, { authenticated = true, csrf = true } = {}) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/json", origin };
  if (authenticated) headers.cookie = csrf ? `${cookie}; pf_csrf=test-token` : cookie;
  if (csrf) headers["x-csrf-token"] = "test-token";
  const response = await fetch(`${origin}/api/admin/concierge-request`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}
const good = {
  phone: "+502 5555 1234",
  business_type: "Cafetería",
  preferred_time: "por la tarde",
  note: "Abrimos una segunda sucursal en enero.",
};

describe("done-for-you concierge request", () => {
  it("requires an authenticated owner", async () => {
    assert.equal((await post(good, { authenticated: false })).status, 401);
    role = "CASHIER";
    assert.equal((await post(good)).status, 403);
    assert.equal(sent.length, 0);
  });
  it("requires the CSRF double-submit token", async () => {
    assert.equal((await post(good, { csrf: false })).status, 403);
    assert.equal(sent.length, 0);
  });
  it("rejects incomplete or unknown fields before anything is sent", async () => {
    assert.equal((await post({ ...good, phone: "123" })).status, 400);
    assert.equal((await post({ ...good, extra: true })).status, 400);
    assert.equal(sent.length, 0);
    assert.equal(audits.length, 0);
  });
  it("sends a clearly labelled request with server-side identity and audits it", async () => {
    const response = await post({ ...good, business_type: "Salón" });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.ok, true);
    assert.equal(sent.length, 1);
    const [email] = sent;
    assert.equal(email.subject, "Configuración acompañada — Café Prueba");
    assert.equal(email.business, "Café Prueba"); // from the database, never from the client
    assert.match(email.contact, /\+502 5555 1234/);
    assert.match(email.contact, /owner@example\.com/);
    assert.match(email.message, /Tipo de negocio: Salón/);
    assert.match(email.message, /Plan actual: EMPRENDEDOR/);
    assert.match(email.message, /segunda sucursal/);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "concierge.request");
    assert.equal(audits[0].business_id, businessId);
    assert.equal(audits[0].meta.business_type, "Salón");
  });
});
