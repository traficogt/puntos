import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Same harness as customer-auth-entry-behavior.test.js: the browser module is loaded from a data
// URL with /lib.js stubbed and its relative imports pointed at the repository files.
const data = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const source = await fs.readFile(new URL("../../public/trial-signup.js", import.meta.url), "utf8");
const { initTrialSignup } = await import(
  data(
    source
      .replace(
        '"/lib.js"',
        JSON.stringify(
          data(
            "export const api=(...a)=>globalThis.__trial.api(...a);export const $=key=>globalThis.__trial.$(key);export const toast=message=>globalThis.__trial.messages.push(message);export const setHidden=(el,value)=>{if(el)el.hidden=value;};export const hydrateShellLinks=()=>{};export const isStrongPassword=value=>String(value).length>=12;export const passwordRequirementsText=()=>'Usa 8 a 128 caracteres.';",
          ),
        ),
      )
      .replace(
        '"./otp-cooldown.js"',
        JSON.stringify(new URL("../../public/otp-cooldown.js", import.meta.url).href),
      )
      .replace(
        '"./trial-signup-model.js"',
        JSON.stringify(new URL("../../public/trial-signup-model.js", import.meta.url).href),
      ),
  )
);

const VALUES = {
  "#businessName": "Café Prueba",
  "#ownerName": "Ana",
  "#email": "ana@example.com",
  "#password": "OrchardLanternMarble2026!",
  "#category": "cafe",
  "#website": "",
  "#phone": "5555 1234",
  "#code": "123456",
};

function setup(t) {
  const events = {},
    elements = {};
  const h = {
    calls: [],
    messages: [],
    assigned: "",
    config: { challengeRequired: false, siteKey: "" },
    /** @type {Record<string, unknown>} path → Error to throw */
    failures: {},
    grant: "grant-abc",
    api: async (path, options) => {
      h.calls.push({
        path,
        body: options?.body ? JSON.parse(options.body) : undefined,
        method: options?.method || "GET",
      });
      if (h.failures[path]) throw h.failures[path];
      if (path === "/api/public/trial/config") return h.config;
      if (path === "/api/public/trial/request-code") return { ok: true };
      if (path === "/api/public/trial/verify") return { ok: true, grant: h.grant };
      if (path === "/api/public/trial/signup")
        return { ok: true, business: { id: "b1", slug: "cafe-prueba", name: "Café Prueba" } };
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    },
    $: (key) =>
      (elements[key] ||= {
        value: VALUES[key] ?? "",
        hidden: false,
        disabled: false,
        textContent: "",
        attributes: {},
        classes: new Set(),
        classList: {
          toggle(name, force) {
            if (force) elements[key].classes.add(name);
            else elements[key].classes.delete(name);
          },
          add(name) {
            elements[key].classes.add(name);
          },
          remove(name) {
            elements[key].classes.delete(name);
          },
          contains(name) {
            return elements[key].classes.has(name);
          },
        },
        setAttribute(name, value) {
          elements[key].attributes[name] = value;
        },
        removeAttribute(name) {
          delete elements[key].attributes[name];
        },
        getAttribute(name) {
          return elements[key].attributes[name] ?? null;
        },
        focus() {
          h.focused = key;
        },
        addEventListener: (event, callback) => {
          events[`${key}:${event}`] = callback;
        },
      }),
  };
  for (const [key, value] of Object.entries({
    __trial: h,
    location: {
      pathname: "/prueba/",
      search: "",
      origin: "https://app.example",
      href: "",
      assign(url) {
        h.assigned = url;
      },
    },
    document: {
      createElement: () => ({ addEventListener() {}, dataset: {} }),
      head: { appendChild() {} },
    },
    window: {
      addEventListener: (event, callback) => {
        events[`window:${event}`] = callback;
      },
    },
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    });
  }
  t.mock.method(globalThis, "setTimeout", /** @type {any} */ ((fn) => (fn(), 1)));
  t.mock.method(globalThis, "setInterval", /** @type {any} */ (() => 1));
  return { h, events, elements };
}

const error = (status, code = "", message = "error") =>
  Object.assign(new Error(message), { status, code });
const stage = (h, step) =>
  ({
    datos: "#trialDatosStage",
    telefono: "#trialPhoneStage",
    codigo: "#trialCodeStage",
    crear: "#trialCreateStage",
    listo: "#trialDoneStage",
  })[step] &&
  h.$(
    {
      datos: "#trialDatosStage",
      telefono: "#trialPhoneStage",
      codigo: "#trialCodeStage",
      crear: "#trialCreateStage",
      listo: "#trialDoneStage",
    }[step],
  );

async function reachCodeStep(h, events) {
  await initTrialSignup({ redirectDelayMs: 0 });
  await events["#trialDatosForm:submit"]({ preventDefault() {} });
  await events["#trialPhoneForm:submit"]({ preventDefault() {} });
  // Sending a code clears the input; the owner types the received code afterwards.
  h.$("#code").value = VALUES["#code"];
}

test("the happy path posts the three documented bodies and hands off to /negocio/", async (t) => {
  const { h, events } = setup(t);
  await initTrialSignup({ redirectDelayMs: 0 });
  assert.equal(stage(h, "datos").hidden, false);
  assert.equal(stage(h, "telefono").hidden, true);
  await events["#trialDatosForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "datos").hidden, true);
  assert.equal(stage(h, "telefono").hidden, false);
  assert.equal(h.$("#stepTelefono").attributes["aria-current"], "step");
  await events["#trialPhoneForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "codigo").hidden, false);
  assert.equal(h.$("#btnResendCode").disabled, true, "resend waits for the cooldown");
  assert.match(h.$("#verificationPhone").textContent, /\+502 ···· 1234/);
  assert.equal(h.$("#code").value, "", "the code field is empty until the owner types the code");
  h.$("#code").value = VALUES["#code"];
  await events["#trialCodeForm:submit"]({ preventDefault() {} });
  const posts = h.calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    posts.map((call) => call.path),
    ["/api/public/trial/request-code", "/api/public/trial/verify", "/api/public/trial/signup"],
  );
  assert.deepEqual(posts[0].body, { phone: "50255551234" });
  assert.deepEqual(posts[1].body, { phone: "50255551234", code: "123456" });
  assert.deepEqual(posts[2].body, {
    grant: "grant-abc",
    businessName: "Café Prueba",
    email: "ana@example.com",
    password: "OrchardLanternMarble2026!",
    category: "cafe",
    ownerName: "Ana",
  });
  assert.equal(stage(h, "listo").hidden, false);
  assert.equal(h.$("#joinUrl").textContent, "https://app.example/registro/cafe-prueba");
  assert.match(h.$("#doneText").textContent, /14 días/);
  assert.equal(h.assigned, "/negocio/");
  assert.equal(h.calls[0].path, "/api/public/trial/config");
});

test("step 1 rejects a weak password and an invalid e-mail before any request leaves the page", async (t) => {
  const { h, events, elements } = setup(t);
  await initTrialSignup({ redirectDelayMs: 0 });
  elements["#password"].value = "short";
  await events["#trialDatosForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "datos").hidden, false);
  assert.equal(h.$("#password").attributes["aria-invalid"], "true");
  assert.equal(h.$("#trialDatosFeedback").textContent, "Usa 8 a 128 caracteres.");
  assert.equal(h.focused, "#password");
  elements["#password"].value = VALUES["#password"];
  elements["#email"].value = "ana@";
  await events["#trialDatosForm:submit"]({ preventDefault() {} });
  assert.equal(h.$("#email").attributes["aria-invalid"], "true");
  assert.equal(h.calls.filter((call) => call.method === "POST").length, 0);
});

test("a server without the trial API explains it and offers the contact path", async (t) => {
  const { h, events } = setup(t);
  h.failures["/api/public/trial/config"] = error(404);
  h.failures["/api/public/support/config"] = error(404);
  h.failures["/api/public/trial/request-code"] = error(404);
  await reachCodeStep(h, events);
  assert.equal(stage(h, "telefono").hidden, false);
  assert.match(h.$("#trialPhoneFeedback").textContent, /todavía no está disponible/);
  assert.equal(h.$("#trialUnavailable").hidden, false);
  assert.equal(h.$("#btnCode").disabled, false);
});

test("an invalid phone never reaches the server", async (t) => {
  const { h, events, elements } = setup(t);
  elements["#phone"] = undefined;
  await initTrialSignup({ redirectDelayMs: 0 });
  elements["#phone"].value = "1234";
  await events["#trialDatosForm:submit"]({ preventDefault() {} });
  await events["#trialPhoneForm:submit"]({ preventDefault() {} });
  assert.equal(
    h.calls.some((call) => call.path.endsWith("/request-code")),
    false,
  );
  assert.equal(h.$("#phone").attributes["aria-invalid"], "true");
  assert.match(h.$("#trialPhoneFeedback").textContent, /8 dígitos/);
});

test("a wrong code keeps the code step with Spanish copy and never creates the business", async (t) => {
  const { h, events } = setup(t);
  h.failures["/api/public/trial/verify"] = error(400, "INVALID_CODE");
  await reachCodeStep(h, events);
  await events["#trialCodeForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "codigo").hidden, false);
  assert.match(h.$("#trialCodeFeedback").textContent, /no coincide/);
  assert.equal(
    h.calls.some((call) => call.path.endsWith("/signup")),
    false,
  );
  assert.equal(h.$("#btnVerify").disabled, false);
});

test("a duplicate e-mail returns to step 1, keeps the grant and reuses it after the fix", async (t) => {
  const { h, events, elements } = setup(t);
  h.failures["/api/public/trial/signup"] = error(409, "EMAIL_ALREADY_USED");
  await reachCodeStep(h, events);
  await events["#trialCodeForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "datos").hidden, false);
  assert.match(h.$("#trialDatosFeedback").textContent, /correo ya tiene una cuenta/);
  assert.equal(h.$("#email").attributes["aria-invalid"], "true");
  assert.equal(h.focused, "#email");
  delete h.failures["/api/public/trial/signup"];
  elements["#email"].value = "otra@example.com";
  await events["#trialDatosForm:submit"]({ preventDefault() {} });
  const signups = h.calls.filter((call) => call.path.endsWith("/signup"));
  assert.equal(signups.length, 2, "the kept grant is reused without a second code");
  assert.equal(signups[1].body.email, "otra@example.com");
  assert.equal(signups[1].body.grant, "grant-abc");
  assert.equal(h.calls.filter((call) => call.path.endsWith("/verify")).length, 1);
  assert.equal(h.assigned, "/negocio/");
});

test("an expired grant sends the owner back to verify the phone", async (t) => {
  const { h, events } = setup(t);
  h.failures["/api/public/trial/signup"] = error(401, "GRANT_EXPIRED");
  await reachCodeStep(h, events);
  await events["#trialCodeForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "telefono").hidden, false);
  assert.match(h.$("#trialPhoneFeedback").textContent, /Vuelve a verificar/);
  assert.equal(h.focused, "#phone");
});

test("a network failure while creating offers an explicit retry that completes the signup", async (t) => {
  const { h, events } = setup(t);
  h.failures["/api/public/trial/signup"] = new Error("Failed to fetch");
  await reachCodeStep(h, events);
  await events["#trialCodeForm:submit"]({ preventDefault() {} });
  assert.equal(stage(h, "crear").hidden, false);
  assert.equal(h.$("#btnRetrySignup").hidden, false);
  assert.match(h.$("#trialCreateFeedback").textContent, /conexión/);
  delete h.failures["/api/public/trial/signup"];
  await events["#btnRetrySignup:click"]();
  assert.equal(h.calls.filter((call) => call.path.endsWith("/signup")).length, 2);
  assert.equal(stage(h, "listo").hidden, false);
});

test("changing the phone resets the code step and editing data goes back to step 1", async (t) => {
  const { h, events } = setup(t);
  await reachCodeStep(h, events);
  await events["#btnChangePhone:click"]();
  assert.equal(stage(h, "telefono").hidden, false);
  assert.equal(stage(h, "codigo").hidden, true);
  assert.equal(h.$("#code").value, "");
  await events["#btnEditDatos:click"]();
  assert.equal(stage(h, "datos").hidden, false);
  assert.equal(h.$("#stepDatos").attributes["aria-current"], "step");
});

test("the resend button honours the cooldown and browser back restores it once elapsed", async (t) => {
  const { h, events } = setup(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await reachCodeStep(h, events);
  await events["#btnResendCode:click"]();
  assert.equal(
    h.calls.filter((call) => call.path.endsWith("/request-code")).length,
    1,
    "cooldown blocks the resend",
  );
  events["window:pagehide"]();
  now += 61_000;
  await events["window:pageshow"]({ persisted: true });
  assert.equal(h.$("#btnResendCode").disabled, false);
  await events["#btnResendCode:click"]();
  assert.equal(h.calls.filter((call) => call.path.endsWith("/request-code")).length, 2);
});

test("the intended plan from /precios is explained and the trial still runs on Conecta", async (t) => {
  const { h } = setup(t);
  location.search = "?plan=NEGOCIO";
  await initTrialSignup({ redirectDelayMs: 0 });
  assert.equal(h.$("#trialPlanNote").hidden, false);
  assert.match(h.$("#trialPlanNote").textContent, /Impulsa/);
  assert.match(h.$("#trialPlanNote").textContent, /Conecta/);
});

test("the support config is the fallback site-key source and a required challenge without widget fails closed", async (t) => {
  const { h, events } = setup(t);
  h.failures["/api/public/trial/config"] = error(404);
  const api = h.api;
  h.api = async (path, options) => {
    if (path === "/api/public/support/config") {
      h.calls.push({ path, method: "GET" });
      return { challengeRequired: true, siteKey: "site-key" };
    }
    return api(path, options);
  };
  await reachCodeStep(h, events);
  assert.deepEqual(
    h.calls.slice(0, 2).map((call) => call.path),
    ["/api/public/trial/config", "/api/public/support/config"],
  );
  assert.equal(
    h.calls.some((call) => call.path.endsWith("/request-code")),
    false,
  );
  assert.match(h.$("#trialPhoneFeedback").textContent, /verificación de seguridad/);
});
