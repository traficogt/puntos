import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PushController,
  notificationRoute,
  encodeInstallationSecret,
} from "../src/push.ts";
import type { Session } from "../src/model.ts";
const session: Session = {
  token: "session-a",
  customerId: "customer-a",
  businessId: "business-a",
  expiresAt: "2099-01-01T00:00:00.000Z",
  slug: "cafe",
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function harness(saved = new Map<string, string>()) {
  const calls: { path: string; body?: unknown }[] = [];
  let offline = false;
  let permission = "granted" as "granted" | "denied" | "undetermined";
  let prompts = 0,
    clears = 0;
  let prompt = async () => permission;
  let register = async () => ({
    enabled: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const native = {
    supported: true,
    permission: async () => permission,
    requestPermission: async () => {
      prompts++;
      return prompt();
    },
    token: async () => "a".repeat(64),
    clear: async () => {
      clears++;
    },
    createInstallation: async () => ({
      installationId: "11111111-1111-4111-8111-111111111111",
      installationSecret: "A".repeat(43),
    }),
    hash: async (v: string) => createHash("sha256").update(v).digest("hex"),
  };
  const push = new PushController({
    native,
    storage: {
      get: async (k) => saved.get(k) ?? null,
      set: async (k, v) => {
        saved.set(k, v);
      },
      remove: async (k) => {
        saved.delete(k);
      },
    },
    request: async (path, options) => {
      calls.push({ path, body: options?.body });
      if (offline) throw Error("offline");
      if (path.endsWith("push-status")) return { available: true };
      if (path.endsWith("/revoke")) return { ok: true };
      if (path.endsWith("/test")) return { sent: true };
      return register();
    },
  });
  return {
    push,
    native,
    calls,
    saved,
    get prompts() {
      return prompts;
    },
    get clears() {
      return clears;
    },
    setPermission: (p: typeof permission) => {
      permission = p;
    },
    setOffline: (v: boolean) => {
      offline = v;
    },
    setPrompt: (fn: typeof prompt) => {
      prompt = fn;
    },
    setRegister: (fn: typeof register) => {
      register = fn;
    },
  };
}
test("requires explicit consent and persists only secure installation credentials and session hash", async () => {
  const h = harness();
  await h.push.sync(session, false);
  assert.equal(h.prompts, 0);
  assert.equal(h.calls.filter((c) => c.path.endsWith("push-device")).length, 0);
  await h.push.enable();
  assert.equal(h.push.getState().enabled, true);
  assert.equal(h.calls.filter((c) => c.path.endsWith("push-device")).length, 1);
  const raw = [...h.saved.values()].join("");
  assert.ok(raw.includes("installationSecret"));
  assert.ok(!raw.includes('"token"'));
  assert.ok(!raw.includes('"sessionToken"'));
  assert.ok(!raw.includes(session.token));
});
test("permission denial never registers, and disabled accounts do not auto-enable after permission changes", async () => {
  const h = harness();
  h.setPermission("denied");
  await h.push.sync(session, false);
  await h.push.enable();
  assert.equal(h.push.getState().permission, "denied");
  assert.equal(h.calls.filter((c) => c.path.endsWith("push-device")).length, 0);
  h.setPermission("granted");
  await h.push.reconcile();
  assert.equal(h.push.getState().enabled, false);
});
test("late permission response after signout cannot register an old account", async () => {
  const h = harness();
  h.setPermission("undetermined");
  const d = deferred<"granted">();
  h.setPrompt(() => d.promise);
  await h.push.sync(session, false);
  const enabling = h.push.enable();
  await new Promise((r) => setImmediate(r));
  const signout = h.push.sync(null, false);
  d.resolve("granted");
  await Promise.all([enabling, signout]);
  assert.equal(h.calls.filter((c) => c.path.endsWith("push-device")).length, 0);
  assert.equal(h.push.getState().enabled, false);
});
test("logout while registration is in flight follows it with revocation", async () => {
  const h = harness();
  const d = deferred<{ enabled: boolean; expiresAt: string }>();
  h.setRegister(() => d.promise);
  await h.push.sync(session, false);
  const enabling = h.push.enable();
  await new Promise((r) => setImmediate(r));
  const logout = h.push.sync(null, false);
  d.resolve({ enabled: true, expiresAt: "2099-01-01" });
  await Promise.all([enabling, logout]);
  assert.deepEqual(
    h.calls.filter((c) => !c.path.endsWith("push-status")).map((c) => c.path),
    ["/customer/push-device", "/customer/push-device/revoke"],
  );
  assert.equal(h.push.getState().enabled, false);
  assert.ok(h.clears > 0);
});
test("offline logout persists revocation and retries after restart without an old bearer", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  h.setOffline(true);
  await h.push.sync(null, true);
  assert.equal(h.push.getState().enabled, false);
  const restored = harness(h.saved);
  await restored.push.sync(null, false);
  assert.deepEqual(
    restored.calls.map((c) => c.path),
    ["/customer/push-device/revoke"],
  );
  assert.equal(restored.push.getState().pendingRevoke, false);
});
test("switching accounts clears previous consent and revokes before a new opt-in", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  await h.push.sync(
    { ...session, token: "session-b", customerId: "customer-b" },
    false,
  );
  assert.equal(h.push.getState().enabled, false);
  assert.equal(h.calls.at(-1)?.path, "/customer/push-status");
  assert.ok(h.calls.some((c) => c.path.endsWith("/revoke")));
  assert.equal(h.calls.filter((c) => c.path.endsWith("push-device")).length, 1);
});
test("restoring the same session refreshes consent without prompting; removing OS permission revokes", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  const restored = harness(h.saved);
  await restored.push.sync(session, false);
  assert.equal(restored.push.getState().enabled, true);
  assert.equal(restored.prompts, 0);
  restored.setPermission("denied");
  await restored.push.reconcile();
  assert.equal(restored.push.getState().enabled, false);
  assert.ok(restored.calls.some((c) => c.path.endsWith("/revoke")));
});
test("new login to the same customer requires fresh consent", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  const restored = harness(h.saved);
  await restored.push.sync({ ...session, token: "new-session" }, false);
  assert.equal(restored.push.getState().enabled, false);
  assert.ok(restored.calls.some((c) => c.path.endsWith("/revoke")));
});
test("test notification requires active consent and explicit action", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.test();
  assert.ok(!h.calls.some((c) => c.path.endsWith("/test")));
  await h.push.enable();
  await h.push.test();
  assert.equal(h.calls.filter((c) => c.path.endsWith("/test")).length, 1);
});
test("unsupported platforms do not read storage, prompt, or call push APIs", async () => {
  const h = harness();
  h.native.supported = false;
  await h.push.sync(session, false);
  await h.push.enable();
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.size, 0);
  assert.equal(h.prompts, 0);
});
test("notification routing accepts only known destinations for current identity", () => {
  assert.equal(
    notificationRoute(
      {
        kind: "rewards",
        customerId: session.customerId,
        businessId: session.businessId,
      },
      session,
    ),
    "/(tabs)/rewards",
  );
  assert.equal(
    notificationRoute(
      {
        kind: "card",
        customerId: session.customerId,
        businessId: session.businessId,
        url: "https://evil.test",
      },
      session,
    ),
    "/(tabs)/card",
  );
  assert.equal(
    notificationRoute(
      { kind: "rewards", customerId: "other", businessId: session.businessId },
      session,
    ),
    null,
  );
  assert.equal(
    notificationRoute(
      {
        kind: "https://evil.test",
        customerId: session.customerId,
        businessId: session.businessId,
      },
      session,
    ),
    null,
  );
  assert.equal(notificationRoute({}, null), null);
});
test("token rotation uses the supplied native token without asking for another token", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  h.native.token = async () => {
    throw Error("must not refetch");
  };
  await h.push.tokenChanged("b".repeat(64));
  assert.equal(
    (h.calls.at(-1)?.body as { token: string }).token,
    "b".repeat(64),
  );
});
test("an ambiguous failed registration is revoked by a later opt-out", async () => {
  const h = harness();
  h.setRegister(async () => {
    throw Error("connection lost");
  });
  await h.push.sync(session, false);
  await h.push.enable();
  await h.push.disable();
  assert.ok(h.calls.some((c) => c.path.endsWith("/revoke")));
  assert.equal(h.push.getState().enabled, false);
});
test("restoring valid consent preserves the notification that opened the app", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  const restored = harness(h.saved);
  await restored.push.sync(session, false);
  assert.equal(restored.clears, 0);
});
test("token rotation after iOS permission removal revokes rather than registering", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  h.setPermission("denied");
  await h.push.tokenChanged("b".repeat(64));
  assert.equal(h.calls.at(-1)?.path, "/customer/push-device/revoke");
  assert.equal(h.push.getState().enabled, false);
});
test("ambiguous activation retains visible consent so the user can opt out", async () => {
  const h = harness();
  h.setRegister(async () => {
    throw Error("lost reply");
  });
  await h.push.sync(session, false);
  await h.push.enable();
  assert.equal(h.push.getState().consented, true);
  assert.equal(h.push.getState().enabled, false);
  await h.push.disable();
  assert.equal(h.push.getState().consented, false);
});
test("offline restore retains the opt-out affordance for existing consent", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  const restored = harness(h.saved);
  await restored.push.sync(session, true);
  assert.equal(restored.push.getState().consented, true);
  await restored.push.disable();
  assert.equal(restored.push.getState().pendingRevoke, true);
});
test("removing OS permission offline persists revocation before reconnection", async () => {
  const h = harness();
  await h.push.sync(session, false);
  await h.push.enable();
  h.setPermission("denied");
  h.setOffline(true);
  await h.push.sync(session, true);
  assert.equal(h.push.getState().enabled, false);
  assert.equal(h.push.getState().pendingRevoke, true);
  const restored = harness(h.saved);
  await restored.push.sync(null, false);
  assert.equal(restored.calls.at(-1)?.path, "/customer/push-device/revoke");
});
test("native token events emitted during an explicit token fetch do not duplicate registration", async () => {
  const h = harness();
  h.native.token = async () => {
    void h.push.tokenChanged("a".repeat(64));
    return "a".repeat(64);
  };
  await h.push.sync(session, false);
  await h.push.enable();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.filter((c) => c.path.endsWith("push-device")).length, 1);
});

test("installation credential encoding matches canonical base64url without browser globals", () => {
  for (let seed = 0; seed < 64; seed++) {
    const bytes = Uint8Array.from(
      { length: 32 },
      (_, i) => (seed * 31 + i * 7) % 256,
    );
    assert.equal(
      encodeInstallationSecret(bytes),
      Buffer.from(bytes).toString("base64url"),
    );
    assert.equal(encodeInstallationSecret(bytes).length, 43);
  }
  assert.throws(() => encodeInstallationSecret(new Uint8Array(31)));
});
