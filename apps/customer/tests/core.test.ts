import test from "node:test";
import assert from "node:assert/strict";
import {
  businessSlug,
  apiOrigin,
  validQr,
  rewardState,
  safeGoogleUrl,
} from "../src/model.ts";
import { ApiClient, ApiError } from "../src/api.ts";
import { SessionController } from "../src/session.ts";
const snapshot = {
  business: { id: "b1", name: "Café", slug: "cafe" },
  customer: { id: "c1", name: "Ana", phone: "+50255555555", points: 340 },
  rewards: [],
  transactions: [],
  redemptions: [],
  wallet: { providers: { apple: true, google: true }, passes: [] },
};
const session = {
  token: "session-credential",
  expiresAt: "2099-01-01T00:00:00Z",
  customerId: "c1",
  businessId: "b1",
  slug: "cafe",
};
function storage() {
  const m = new Map<string, string>();
  return {
    m,
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async set(key: string, value: string) {
      m.set(key, value);
    },
    async remove(key: string) {
      m.delete(key);
    },
  };
}
test("business entry accepts PF enrollment links and slugs, never another host", () => {
  assert.equal(
    businessSlug(
      "https://app.puntosfieles.com/registro/test-cafe?wallet=google",
    ),
    "test-cafe",
  );
  assert.equal(businessSlug("puntosfieles://negocio/test-cafe"), "test-cafe");
  assert.equal(businessSlug("test-cafe"), "test-cafe");
  for (const value of [
    "https://evil.example/registro/test-cafe",
    "https://app.puntosfieles.com.evil.example/registro/test-cafe",
    "../admin",
    "https://user:pass@app.puntosfieles.com/registro/test-cafe",
  ])
    assert.throws(() => businessSlug(value));
});
test("API origin requires HTTPS and no credentials/path/query", () => {
  assert.equal(
    apiOrigin("https://app.puntosfieles.com/"),
    "https://app.puntosfieles.com",
  );
  for (const value of [
    "http://example.com",
    "https://name:pass@example.com",
    "https://example.com/api",
    "https://example.com?x=1",
  ])
    assert.throws(() => apiOrigin(value));
});
test("expired QR cannot be displayed and offline snapshot never authorizes redemption", () => {
  assert.equal(validQr({ token: "x", exp: 10 }, 10000), false);
  assert.equal(validQr({ token: "x", exp: 11 }, 10000), true);
  assert.equal(
    rewardState(
      { id: "r", name: "Café", points_cost: 300, stock: 0 },
      500,
      false,
    ).available,
    false,
  );
  assert.equal(
    rewardState({ id: "r", name: "Café", points_cost: 300 }, 500, true)
      .available,
    false,
  );
  assert.equal(
    rewardState(
      { id: "r", name: "Café", points_cost: 300, valid_until: "2020-01-01" },
      500,
      false,
    ).available,
    false,
  );
  assert.equal(
    rewardState({ id: "r", name: "Café", points_cost: 300 }, 200, false).label,
    "Te faltan 100 puntos",
  );
});
test("Google handoff accepts only the actual Google Wallet save endpoint", () => {
  assert.equal(
    safeGoogleUrl("https://pay.google.com/gp/v/save/abc"),
    "https://pay.google.com/gp/v/save/abc",
  );
  for (const value of [
    "javascript:alert(1)",
    "https://evil.example/gp/v/save/abc",
    "https://pay.google.com.evil.example/gp/v/save/abc",
  ])
    assert.throws(() => safeGoogleUrl(value));
});
test("API calls browser fetch without an incompatible object receiver", async () => {
  let receiver: unknown;
  const client = new ApiClient("https://app.puntosfieles.com", async function (
    this: unknown,
  ) {
    receiver = this;
    return new Response(JSON.stringify({ ok: true }));
  });
  await client.request("/business/test-cafe");
  assert.equal(receiver, undefined);
});
test("API uses bearer without cookies, exposes safe errors and does not retry mutations", async () => {
  let calls = 0;
  const client = new ApiClient(
    "https://app.puntosfieles.com",
    async (input, init) => {
      calls++;
      assert.equal(init?.credentials, "omit");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer secret",
      );
      assert.equal(
        String(input),
        "https://app.puntosfieles.com/api/mobile/customer/qr",
      );
      return new Response(
        JSON.stringify({ error: "Provider unavailable", code: "UNAVAILABLE" }),
        { status: 503 },
      );
    },
  );
  await assert.rejects(
    client.request("/customer/qr", { method: "POST", token: "secret" }),
    (e: any) =>
      e instanceof ApiError &&
      e.status === 503 &&
      !e.message.includes("Provider"),
  );
  assert.equal(calls, 1);
});
test("signout clears local identity immediately and ignores a late refresh", async () => {
  let resolve: any;
  const secure = storage(),
    cache = storage();
  const api = {
    request: async (path: string) =>
      path === "/customer"
        ? await new Promise((r) => (resolve = r))
        : { ok: true },
  };
  const c = new SessionController(api as any, secure, cache);
  await c.activate(session as any);
  const pending = c.refresh();
  await c.signOut();
  resolve(snapshot);
  await pending;
  assert.equal(c.getState().session, null);
  assert.equal(c.getState().snapshot, null);
  assert.equal(cache.m.size, 0);
  assert.equal(secure.m.size, 0);
});
test("snapshot storage excludes QR, token and customer contact information", async () => {
  const secure = storage(),
    cache = storage();
  const c = new SessionController(
    { request: async () => snapshot } as any,
    secure,
    cache,
  );
  await c.activate(session as any);
  await c.refresh();
  const raw = [...cache.m.values()].join("");
  assert.ok(raw.includes("340"));
  assert.ok(!raw.includes("+502"));
  assert.ok(!raw.includes("session-credential"));
  assert.ok(!raw.includes("Ana"));
});
test("cached account from a different business is discarded", async () => {
  const secure = storage(),
    cache = storage();
  await secure.set("pf.session", JSON.stringify(session));
  await cache.set(
    "pf.snapshot",
    JSON.stringify({
      snapshot: {
        ...snapshot,
        business: { ...snapshot.business, id: "other" },
      },
      syncedAt: Date.now(),
    }),
  );
  const c = new SessionController(
    {
      request: async () => {
        throw new ApiError(0, "Sin conexión");
      },
    } as any,
    secure,
    cache,
  );
  await c.restore();
  assert.equal(c.getState().snapshot, null);
});
test("authentication failure clears the account instead of showing cached data", async () => {
  const secure = storage(),
    cache = storage();
  const c = new SessionController(
    {
      request: async () => {
        throw new ApiError(401, "Vuelve a ingresar");
      },
    } as any,
    secure,
    cache,
  );
  await c.activate(session as any);
  await c.refresh();
  assert.equal(c.getState().session, null);
  assert.equal(cache.m.size, 0);
});
test("secure storage failure cannot leave an apparently signed-in session", async () => {
  const secure = {
    ...storage(),
    set: async () => {
      throw new Error("storage unavailable");
    },
  };
  const c = new SessionController({} as any, secure, storage());
  await assert.rejects(c.activate(session as any));
  assert.equal(c.getState().session, null);
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const sessionB = {
  ...session,
  token: "another-credential",
  customerId: "c2",
  businessId: "b2",
  slug: "other",
};

test("signout during activation cleanup cannot revive the canceled session", async () => {
  const cleared = deferred(),
    release = deferred();
  const secure = storage(),
    cache = storage();
  const originalRemove = secure.remove;
  let removals = 0;
  secure.remove = async (key) => {
    if (++removals === 1) {
      cleared.resolve();
      await release.promise;
    }
    await originalRemove(key);
  };
  const c = new SessionController(
    { request: async () => ({ ok: true }) } as any,
    secure,
    cache,
  );
  const activation = c.activate(session);
  await cleared.promise;
  const signout = c.signOut();
  release.resolve();
  await Promise.all([activation, signout]);
  assert.equal(c.getState().session, null);
  assert.equal(secure.m.size, 0);
});

test("canceling the OTP screen before its queued activation skips credential storage", async () => {
  const cleared = deferred(),
    release = deferred();
  const secure = storage(),
    cache = storage();
  const originalRemove = secure.remove;
  let current = true,
    writes = 0;
  secure.remove = async (key) => {
    cleared.resolve();
    await release.promise;
    await originalRemove(key);
  };
  const originalSet = secure.set;
  secure.set = async (key, value) => {
    writes++;
    await originalSet(key, value);
  };
  const c = new SessionController({} as any, secure, cache);
  const activation = c.activate(session, { isCurrent: () => current });
  await cleared.promise;
  current = false;
  release.resolve();
  await activation;
  assert.equal(writes, 0);
  assert.equal(c.getState().session, null);
  assert.equal(secure.m.size, 0);
});

test("canceling while secure storage is writing removes the unaccepted credential", async () => {
  const started = deferred(),
    release = deferred();
  const secure = storage(),
    cache = storage();
  const originalSet = secure.set;
  secure.set = async (key, value) => {
    started.resolve();
    await release.promise;
    await originalSet(key, value);
  };
  let current = true;
  const c = new SessionController({} as any, secure, cache);
  const activation = c.activate(session, { isCurrent: () => current });
  await started.promise;
  current = false;
  release.resolve();
  await activation;
  assert.equal(c.getState().session, null);
  assert.equal(secure.m.size, 0);
});

test("restoration hydrates identity and cache together before connectivity can refresh", async () => {
  const reading = deferred(),
    cached = deferred<string | null>();
  const secure = storage(),
    cache = storage();
  await secure.set("pf.session", JSON.stringify(session));
  cache.get = async () => {
    reading.resolve();
    return cached.promise;
  };
  let requests = 0;
  const c = new SessionController(
    {
      request: async () => {
        if (++requests > 1) throw new ApiError(503, "No disponible");
        return snapshot;
      },
    } as any,
    secure,
    cache,
  );
  const restore = c.restore();
  await reading.promise;
  const earlySession = c.getState().session;
  c.setOffline(false);
  await c.refresh();
  cached.resolve(
    JSON.stringify({
      snapshot: { ...snapshot, customer: { ...snapshot.customer, points: 10 } },
      syncedAt: Date.now() - 1000,
    }),
  );
  await restore;
  assert.equal(earlySession, null);
  assert.equal(requests, 1);
  assert.equal(c.getState().snapshot?.customer.points, 340);
  assert.equal(c.getState().fresh, true);
});

test("a delayed deletion response for account A cannot clear account B", async () => {
  const response = deferred<unknown>();
  const secure = storage(),
    cache = storage();
  const c = new SessionController(
    { request: async () => response.promise } as any,
    secure,
    cache,
  );
  await c.activate(session);
  const deleting = c.deleteAccount().catch((error) => error);
  await c.activate(sessionB);
  response.resolve({ ok: true });
  await deleting;
  assert.equal(c.getState().session?.token, sessionB.token);
  assert.equal(JSON.parse(secure.m.get("pf.session")!).token, sessionB.token);
});

test("a delayed authentication failure for account A cannot clear account B", async () => {
  const response = deferred<unknown>();
  const c = new SessionController(
    { request: async () => response.promise } as any,
    storage(),
    storage(),
  );
  await c.activate(session);
  const request = c
    .authenticated("/customer/wallet/google", { method: "POST" })
    .catch((error) => error);
  await c.activate(sessionB);
  response.reject(new ApiError(401, "Expiró"));
  assert.ok((await request) instanceof Error);
  assert.equal(c.getState().session?.token, sessionB.token);
  assert.equal(c.getState().error, null);
});

test("authenticated requests reject successful responses belonging to a previous session", async () => {
  const response = deferred<unknown>();
  const c = new SessionController(
    { request: async () => response.promise } as any,
    storage(),
    storage(),
  );
  await c.activate(session);
  const request = c
    .authenticated("/customer/wallet/google", { method: "POST" })
    .catch((error) => error);
  await c.activate(sessionB);
  response.resolve({ url: "https://pay.google.com/gp/v/save/account-a" });
  assert.ok((await request) instanceof Error);
  assert.equal(c.getState().session?.token, sessionB.token);
});

test("all authenticated actions clear expired server sessions and customer-not-found accounts", async (t) => {
  for (const action of ["refresh", "qr", "delete", "wallet"]) {
    for (const failure of [
      new ApiError(401, "Expiró"),
      new ApiError(404, "Eliminada", "CUSTOMER_NOT_FOUND"),
    ]) {
      await t.test(`${action}: ${failure.status}`, async () => {
        const secure = storage(),
          cache = storage();
        const c = new SessionController(
          {
            request: async () => {
              throw failure;
            },
          } as any,
          secure,
          cache,
        );
        await c.activate(session);
        await cache.set("pf.snapshot", "old-account");
        const run =
          action === "refresh"
            ? () => c.refresh()
            : action === "qr"
              ? () => c.issueQr()
              : action === "delete"
                ? () => c.deleteAccount()
                : () =>
                    c.authenticated("/customer/wallet/google", {
                      method: "POST",
                    });
        await run().catch(() => {});
        assert.equal(c.getState().session, null);
        assert.equal(c.getState().fresh, false);
        assert.equal(secure.m.size, 0);
        assert.equal(cache.m.size, 0);
        assert.match(c.getState().error || "", /sesión terminó/);
      });
    }
  }
});

test("foreground refresh expires local sessions even while offline without requesting the API", async () => {
  let requests = 0;
  const secure = storage(),
    cache = storage();
  const c = new SessionController(
    {
      request: async () => {
        requests++;
        return snapshot;
      },
    } as any,
    secure,
    cache,
  );
  await c.activate({ ...session });
  c.getState().session!.expiresAt = "2020-01-01T00:00:00Z";
  c.setOffline(true);
  await c.refresh();
  assert.equal(requests, 0);
  assert.equal(c.getState().session, null);
  assert.equal(c.getState().offline, true);
  assert.match(c.getState().error || "", /sesión terminó/);
});

test("freshness is earned by matching refresh and is independent of connectivity", async () => {
  let fail = false;
  const c = new SessionController(
    {
      request: async () => {
        if (fail) throw new ApiError(503, "Intenta más tarde");
        return snapshot;
      },
    } as any,
    storage(),
    storage(),
  );
  await c.activate(session);
  assert.equal(c.getState().fresh, false);
  await c.refresh();
  assert.equal(c.getState().fresh, true);
  c.setOffline(true);
  assert.equal(c.getState().fresh, false);
  c.setOffline(false);
  assert.equal(c.getState().fresh, false);
  fail = true;
  await c.refresh();
  assert.equal(c.getState().offline, false);
  assert.equal(c.getState().fresh, false);
  assert.equal(c.getState().snapshot?.customer.points, 340);
  fail = false;
  await c.refresh();
  assert.equal(c.getState().fresh, true);
});

test("cached restore after an unavailable server stays stale without implying disconnection", async () => {
  const secure = storage(),
    cache = storage();
  await secure.set("pf.session", JSON.stringify(session));
  await cache.set(
    "pf.snapshot",
    JSON.stringify({ snapshot, syncedAt: Date.now() - 1000 }),
  );
  const c = new SessionController(
    {
      request: async () => {
        throw new ApiError(503, "No disponible");
      },
    } as any,
    secure,
    cache,
  );
  await c.restore();
  assert.equal(c.getState().snapshot?.customer.points, 340);
  assert.equal(c.getState().fresh, false);
  assert.equal(c.getState().offline, false);
});

test("a refresh finishing after loss of connectivity cannot mark its snapshot fresh", async () => {
  const response = deferred<unknown>();
  const c = new SessionController(
    { request: async () => response.promise } as any,
    storage(),
    storage(),
  );
  await c.activate(session);
  const refreshing = c.refresh();
  c.setOffline(true);
  response.resolve(snapshot);
  await refreshing;
  assert.equal(c.getState().offline, true);
  assert.equal(c.getState().fresh, false);
});

test("signout still clears cached data and reports secure deletion failures", async () => {
  const secure = storage(),
    cache = storage();
  const c = new SessionController(
    { request: async () => ({ ok: true }) } as any,
    secure,
    cache,
  );
  await c.activate(session);
  await cache.set("pf.snapshot", "personal-data");
  secure.remove = async () => {
    throw Error("secure storage unavailable");
  };
  await c.signOut().catch(() => {});
  assert.equal(c.getState().session, null);
  assert.equal(cache.m.size, 0);
  assert.match(c.getState().error || "", /borrar|cerrar/);
});

test("cancellation between secure write completion and activation publication removes the credential", async () => {
  const secure = storage();
  const originalSet = secure.set;
  let current = true;
  secure.set = async (key, value) => {
    await originalSet(key, value);
    // Interleave cancellation after the queued write resumes but before its
    // caller publishes the session, without timers or native APIs.
    queueMicrotask(() =>
      queueMicrotask(() => {
        current = false;
      }),
    );
  };
  const c = new SessionController({} as any, secure, storage());
  await c.activate(session, { isCurrent: () => current });
  assert.equal(c.getState().session, null);
  assert.equal(secure.m.size, 0);
});

test("reconnecting during demo updates connectivity for the next live session", async () => {
  let requests = 0;
  const c = new SessionController(
    {
      request: async () => {
        requests++;
        return snapshot;
      },
    } as any,
    storage(),
    storage(),
  );
  c.setOffline(true);
  await c.preview(snapshot);
  c.setOffline(false);
  await c.refresh();
  assert.equal(requests, 0);
  assert.equal(c.getState().demo, true);
  await c.clear();
  await c.activate(session);
  await c.refresh();
  assert.equal(requests, 1);
  assert.equal(c.getState().offline, false);
  assert.equal(c.getState().fresh, true);
  assert.equal(c.getState().snapshot?.customer.points, 340);
});
test("optional notification failures preserve a fresh snapshot but still clear invalid sessions", async () => {
  for (const status of [409, 503, 401]) {
    const api = new ApiClient(
      "https://app.puntosfieles.com",
      async (url) =>
        new Response(
          JSON.stringify(String(url).endsWith("/customer") ? snapshot : {}),
          { status: String(url).endsWith("/customer") ? 200 : status },
        ),
    );
    const auth = new SessionController(api, storage(), storage());
    await auth.activate(session);
    await auth.refresh();
    assert.equal(auth.getState().fresh, true);
    await assert.rejects(
      auth.authenticated(
        "/customer/push-device/test",
        { method: "POST" },
        { invalidateSnapshotOnFailure: false },
      ),
    );
    assert.equal(auth.getState().fresh, status !== 401);
    assert.equal(!!auth.getState().session, status !== 401);
  }
});
