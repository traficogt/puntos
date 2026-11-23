import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  supportCreateSchema,
  supportDiagnosticsSchema,
  canTransitionSupport,
  publicSupportCase,
  hashSupportSecret,
} from "../../src/app/services/support-case-service.js";
const valid = () => ({
  requestId: randomUUID(),
  trackingToken: randomBytes(32).toString("base64url"),
  name: "Persona de prueba",
  email: "persona@example.test",
  category: "access",
  description: "No puedo entrar a mi tarjeta.",
});
test("support accepts bounded contact input, rejects spoofed membership and unsafe diagnostics", () => {
  assert.equal(supportCreateSchema.safeParse(valid()).success, true);
  for (const patch of [
    { email: "bad\r\n@x" },
    { description: "short" },
    { businessId: randomUUID() },
    { password: "secret" },
    { trackingToken: "short" },
    { diagnostics: { url: "https://x/?token=secret" } },
  ])
    assert.equal(supportCreateSchema.safeParse({ ...valid(), ...patch }).success, false);
  assert.equal(
    supportDiagnosticsSchema.safeParse({
      screen: "support",
      online: true,
      browser: "Firefox",
      device: "mobile",
      language: "es",
      viewport: "390x844",
    }).success,
    true,
  );
  assert.equal(
    supportDiagnosticsSchema.safeParse({ screen: "/c/token", online: true }).success,
    false,
  );
});
test("support status transitions and public projection protect internal data", () => {
  assert.equal(canTransitionSupport("new", "open"), true);
  assert.equal(canTransitionSupport("closed", "waiting"), false);
  const out = publicSupportCase(
    {
      id: "private",
      reference: "PF-123",
      status: "open",
      description: "help",
      email: "private@example.test",
      diagnostics: {},
      assigned_to: "staff",
      version: 3,
      created_at: "now",
      updated_at: "now",
    },
    [
      { visibility: "internal", message: "secret" },
      {
        visibility: "public",
        kind: "response",
        message: "We can help",
        created_at: "now",
        actor_email: "private",
      },
    ],
  );
  assert.equal(JSON.stringify(out).includes("private"), false);
  assert.equal(JSON.stringify(out).includes("secret"), false);
  assert.equal(out.events.length, 1);
  assert.equal(hashSupportSecret("abc").length, 64);
  assert.notEqual(hashSupportSecret("abc"), hashSupportSecret("abd"));
});
test("support grant plan never broadens immutable case fields or event history", async () => {
  const { APP_TABLE_PRIVILEGES, buildGrantPlan } =
    await import("../../src/scripts/create-app-role.mjs");
  assert.deepEqual(APP_TABLE_PRIVILEGES.support_cases, ["SELECT", "INSERT"]);
  assert.deepEqual(APP_TABLE_PRIVILEGES.support_case_events, ["SELECT", "INSERT"]);
  assert.deepEqual(APP_TABLE_PRIVILEGES.support_case_attachments, ["SELECT", "INSERT", "DELETE"]);
  assert.match(
    buildGrantPlan({ appDbUser: "puntos_app", dbName: "fixture" }).statements.join("\n"),
    /GRANT UPDATE \(status, assigned_to, version, updated_at\) ON TABLE public\."support_cases"/,
  );
});
