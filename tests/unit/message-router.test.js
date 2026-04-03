import test from "node:test";
import assert from "node:assert/strict";

import { createMessageRouter } from "../../src/app/services/messaging/message-router.js";

test("message router tries eligible providers in order and stops on first success", async () => {
  const attempts = [];
  const router = createMessageRouter({
    order: ["waha", "smtp_email"],
    providers: {
      waha: {
        name: "waha",
        canSend: () => true,
        send: async () => {
          attempts.push("waha");
          throw new Error("down");
        }
      },
      smtp_email: {
        name: "smtp_email",
        canSend: () => true,
        send: async () => {
          attempts.push("smtp_email");
          return { ok: true, providerId: "smtp-1" };
        }
      }
    }
  });

  const out = await router.send({
    channel: "verify",
    body: "hola",
    destinations: { phone: "+50255555555", email: "cliente@test.com" }
  });

  assert.equal(out.ok, true);
  assert.equal(out.provider, "smtp_email");
  assert.deepEqual(attempts, ["waha", "smtp_email"]);
});

test("message router skips providers that cannot send the available destination type", async () => {
  const router = createMessageRouter({
    order: ["smtp_email", "whatsapp_cloud"],
    providers: {
      smtp_email: {
        name: "smtp_email",
        canSend: ({ destinations }) => Boolean(destinations.email),
        send: async () => ({ ok: true, providerId: "smtp-1" })
      },
      whatsapp_cloud: {
        name: "whatsapp_cloud",
        canSend: ({ destinations }) => Boolean(destinations.phone),
        send: async () => ({ ok: true, providerId: "wa-1" })
      }
    }
  });

  const out = await router.send({
    channel: "verify",
    body: "hola",
    destinations: { phone: "+50255555555", email: null }
  });

  assert.equal(out.ok, true);
  assert.equal(out.provider, "whatsapp_cloud");
  assert.deepEqual(out.attempts, ["whatsapp_cloud"]);
});
