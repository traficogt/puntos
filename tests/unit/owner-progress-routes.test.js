import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { errorHandler } from "../../src/middleware/common.js";
import { createOwnerProgressRoutes } from "../../src/app/routes/owner-progress-routes.js";

async function boot({ mode = "full" } = {}) {
  const calls = [];
  const progress = { mode, variant: "treatment", launch: { total: 5 }, new_milestones: [] };
  const record = (name) => async (/** @type {any} */ input) => {
    calls.push({ name, input });
    return name === "getOwnerProgress"
      ? progress
      : { ok: true, ...(name === "acknowledge" ? { acknowledged: input.keys } : {}), progress };
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    "/api",
    createOwnerProgressRoutes({
      staffAuth: (req, res, next) => {
        if (!req.get("x-role")) return res.sendStatus(401);
        req.staff = { id: "owner", business_id: "own", role: req.get("x-role") };
        return next();
      },
      getSettings: async () => ({ mode, holdout_pct: 0 }),
      service: /** @type {any} */ ({
        getOwnerProgress: record("getOwnerProgress"),
        acknowledgeOwnerProgressMilestones: record("acknowledge"),
        setOwnerProgressGoal: record("goal"),
        recordOwnerProgressReview: record("review"),
        setOwnerProgressVisibility: record("visibility"),
      }),
    }),
  );
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const request = (path = "", { role = "OWNER", body = undefined, csrf = true } = {}) =>
    fetch(`${origin}/api/admin/owner-progress${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(role ? { "x-role": role } : {}),
        "content-type": "application/json",
        origin,
        ...(csrf ? { cookie: "pf_csrf=test-token", "x-csrf-token": "test-token" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const close = async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  return { request, calls, close };
}

test("owner progress routes require an authenticated owner and a non-off platform mode", async () => {
  const { request, calls, close } = await boot();
  try {
    for (const path of ["", "/acknowledge", "/goal", "/review", "/visibility"]) {
      const body = path ? { keys: ["primer_cliente"] } : undefined;
      assert.equal((await request(path, { role: "", body })).status, 401, path);
      for (const role of ["CASHIER", "MANAGER"])
        assert.equal((await request(path, { role, body })).status, 403, `${role} ${path}`);
    }
    assert.deepEqual(calls, []);
    const ok = await request();
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal((await ok.json()).variant, "treatment");
    assert.deepEqual(calls.at(-1).input, {
      businessId: "own",
      settings: { mode: "full", holdout_pct: 0 },
    });
    assert.equal((await request("?business_id=other")).status, 400);
  } finally {
    await close();
  }
  const off = await boot({ mode: "off" });
  try {
    assert.equal((await off.request()).status, 404);
    assert.equal((await off.request()).headers.get("cache-control"), "no-store");
    assert.equal((await off.request("/visibility", { body: { hidden: true } })).status, 404);
    assert.deepEqual(off.calls, []);
  } finally {
    await off.close();
  }
});

test("owner progress writes need CSRF, validate strictly and acknowledge idempotently", async () => {
  const { request, calls, close } = await boot();
  try {
    assert.equal(
      (await request("/acknowledge", { body: { keys: ["primer_cliente"] }, csrf: false })).status,
      403,
    );
    for (const [path, body] of /** @type {Array<[string, any]>} */ ([
      ["/acknowledge", {}],
      ["/acknowledge", { keys: [] }],
      ["/acknowledge", { keys: ["not_a_milestone"] }],
      ["/acknowledge", { keys: ["primer_cliente"], extra: 1 }],
      ["/goal", {}],
      ["/goal", { key: "launch", dismiss: "launch" }],
      ["/goal", { key: "unknown" }],
      ["/review", { decision: "maybe" }],
      ["/review", { decision: "keep", note: "x".repeat(501) }],
      ["/visibility", { hidden: "yes" }],
    ])) {
      const response = await request(path, { body });
      assert.equal(response.status, 400, `${path} ${JSON.stringify(body)}`);
      assert.equal((await response.json()).code, "VALIDATION_ERROR");
    }
    assert.deepEqual(calls, []);
    const first = await request("/acknowledge", { body: { keys: ["primer_cliente", "pionero"] } });
    const second = await request("/acknowledge", { body: { keys: ["primer_cliente", "pionero"] } });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual((await first.json()).acknowledged, ["primer_cliente", "pionero"]);
    assert.deepEqual((await second.json()).acknowledged, ["primer_cliente", "pionero"]);
    assert.equal(calls.filter((c) => c.name === "acknowledge").length, 2);
    assert.equal(calls[0].input.businessId, "own");
    assert.equal(calls[0].input.staffId, "owner");
    assert.equal((await request("/goal", { body: { dismiss: "launch" } })).status, 200);
    assert.deepEqual(
      { key: calls.at(-1).input.key, dismiss: calls.at(-1).input.dismiss },
      { key: undefined, dismiss: "launch" },
    );
    assert.equal((await request("/goal", { body: { key: "returning_5" } })).status, 200);
    assert.equal(calls.at(-1).input.key, "returning_5");
    assert.equal(
      (await request("/review", { body: { decision: "adjust", note: " Revisar costo " } })).status,
      200,
    );
    assert.equal(calls.at(-1).input.decision, "adjust");
    assert.equal(calls.at(-1).input.note, "Revisar costo");
    const hidden = await request("/visibility", { body: { hidden: true } });
    assert.equal(hidden.status, 200);
    assert.equal(calls.at(-1).input.hidden, true);
    assert.equal((await hidden.json()).progress.variant, "treatment");
    assert.equal((await request("/visibility?x=1", { body: { hidden: false } })).status, 400);
  } finally {
    await close();
  }
});
