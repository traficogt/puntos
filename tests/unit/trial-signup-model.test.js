import test from "node:test";
import assert from "node:assert/strict";
import {
  NETWORK_MESSAGE,
  STEP_PROGRESS,
  UNAVAILABLE_MESSAGE,
  datosFieldForMessage,
  initialSignupState,
  intendedPlan,
  maskPhone,
  normalizeTrialPhone,
  requestCodePayload,
  signupFailureKind,
  signupPayload,
  signupReducer,
  trialErrorMessage,
  validateDatos,
} from "../../public/trial-signup-model.js";

const rules = {
  isStrongPassword: (value) => String(value).length >= 12,
  passwordRequirementsText: () => "Usa 8 a 128 caracteres.",
};
/** @param {import("../../public/trial-signup-model.js").TrialSignupEvent[]} events */
const run = (events, state = initialSignupState()) => events.reduce(signupReducer, state);

test("the signup walks datos → teléfono → código → crear → listo and ignores out-of-step events", () => {
  let state = initialSignupState();
  assert.equal(state.step, "datos");
  assert.equal(
    run([{ type: "CODE_SENT", phone: "50255551234" }]).step,
    "datos",
    "no code before datos",
  );
  state = run([{ type: "DATOS_OK" }]);
  assert.equal(state.step, "telefono");
  assert.equal(
    run([{ type: "VERIFIED", grant: "g" }], state).step,
    "telefono",
    "no grant before a code",
  );
  state = run([{ type: "CODE_SENT", phone: "50255551234" }], state);
  assert.equal(state.step, "codigo");
  assert.equal(state.phone, "50255551234");
  state = run([{ type: "VERIFIED", grant: "grant-1" }], state);
  assert.equal(state.step, "crear");
  assert.equal(state.grant, "grant-1");
  const done = run([{ type: "CREATED", business: { slug: "cafe", name: "Café" } }], state);
  assert.equal(done.step, "listo");
  assert.equal(done.grant, "", "the single-use grant is dropped once consumed");
  assert.deepEqual(done.business, { slug: "cafe", name: "Café" });
  assert.equal(run([{ type: "RESET" }], done).step, "datos");
  assert.deepEqual(Object.keys(STEP_PROGRESS), ["datos", "telefono", "codigo", "crear", "listo"]);
});

test("changing the phone or editing data moves back without keeping stale state", () => {
  const atCode = run([{ type: "DATOS_OK" }, { type: "CODE_SENT", phone: "50255551234" }]);
  const changed = run([{ type: "CHANGE_PHONE" }], atCode);
  assert.equal(changed.step, "telefono");
  assert.equal(changed.phone, "");
  const resent = run([{ type: "CODE_SENT", phone: "50299998888" }], atCode);
  assert.equal(resent.step, "codigo", "a resend stays on the code step");
  assert.equal(resent.phone, "50299998888");
  assert.equal(run([{ type: "EDIT_DATOS" }], run([{ type: "DATOS_OK" }])).step, "datos");
  assert.equal(
    run([{ type: "EDIT_DATOS" }], atCode).step,
    "codigo",
    "editing data is only offered on the phone step",
  );
});

test("a rejected signup returns to the step that can fix it and keeps a still-valid grant", () => {
  const creating = run([
    { type: "DATOS_OK" },
    { type: "CODE_SENT", phone: "50255551234" },
    { type: "VERIFIED", grant: "grant-1" },
  ]);
  const datos = run(
    [{ type: "SIGNUP_FAILED", kind: "datos", error: "Ese correo ya tiene una cuenta." }],
    creating,
  );
  assert.equal(datos.step, "datos");
  assert.equal(datos.grant, "grant-1");
  assert.equal(datos.error, "Ese correo ya tiene una cuenta.");
  assert.equal(run([{ type: "DATOS_OK" }], datos).step, "crear", "corrected data reuses the grant");
  const grant = run([{ type: "SIGNUP_FAILED", kind: "grant", error: "venció" }], creating);
  assert.equal(grant.step, "telefono");
  assert.equal(grant.grant, "");
  const retry = run([{ type: "SIGNUP_FAILED", kind: "retry", error: "red" }], creating);
  assert.equal(retry.step, "crear");
  assert.equal(retry.grant, "grant-1");
  assert.equal(
    run([{ type: "SIGNUP_FAILED", kind: "datos", error: "x" }]).step,
    "datos",
    "ignored outside crear",
  );
});

test("phones normalise to digits with the Guatemalan dial code and are masked for display", () => {
  assert.equal(normalizeTrialPhone("5555 1234"), "50255551234");
  assert.equal(normalizeTrialPhone("+502 5555-1234"), "50255551234");
  assert.equal(normalizeTrialPhone("00 52 55 1234 5678"), "525512345678");
  assert.equal(normalizeTrialPhone("1234567"), "", "seven digits are not a phone");
  assert.equal(normalizeTrialPhone("1234567890123456"), "", "sixteen digits exceed E.164");
  assert.equal(normalizeTrialPhone(null), "");
  assert.equal(maskPhone("50255551234"), "+502 ···· 1234");
  assert.equal(maskPhone(""), "");
});

test("step 1 validation names the field and reuses the shared password rule", () => {
  const ok = validateDatos(
    { businessName: "Café Bourbon", email: "ana@example.com", password: "OrchardLantern2026" },
    rules,
  );
  assert.deepEqual(ok, []);
  const bad = validateDatos({ businessName: "C", email: "ana@", password: "short" }, rules);
  assert.deepEqual(
    bad.map((e) => e.field),
    ["businessName", "email", "password"],
  );
  assert.equal(bad[2].message, "Usa 8 a 128 caracteres.");
});

test("the intended plan from /precios is recognised by code or name and never Conecta", () => {
  assert.deepEqual(intendedPlan("?plan=NEGOCIO"), { code: "NEGOCIO", name: "Impulsa" });
  assert.deepEqual(intendedPlan("?plan=expande"), { code: "EMPRESA", name: "Expande" });
  assert.equal(intendedPlan("?plan=EMPRENDEDOR"), null);
  assert.equal(intendedPlan("?plan=gold"), null);
  assert.equal(intendedPlan(""), null);
});

test("request bodies follow the design shapes and only carry optional keys when set", () => {
  assert.deepEqual(requestCodePayload({ phone: "50255551234" }), { phone: "50255551234" });
  assert.deepEqual(
    requestCodePayload({ phone: "50255551234", turnstileToken: "tok", website: "x" }),
    {
      phone: "50255551234",
      turnstileToken: "tok",
      website: "x",
    },
  );
  assert.deepEqual(
    signupPayload({
      grant: "g",
      businessName: " Café ",
      email: " ana@example.com ",
      password: "Secret-Password-1",
      category: "cafe",
      ownerName: " Ana ",
      turnstileToken: "tok",
    }),
    {
      grant: "g",
      businessName: "Café",
      email: "ana@example.com",
      password: "Secret-Password-1",
      category: "cafe",
      ownerName: "Ana",
      turnstileToken: "tok",
    },
  );
  assert.deepEqual(
    Object.keys(
      signupPayload({
        grant: "g",
        businessName: "C",
        email: "e@x.co",
        password: "p",
        category: "",
      }),
    ),
    ["grant", "businessName", "email", "password", "category"],
  );
});

test("error codes and statuses map to Spanish copy; network failures and 404 are explained", () => {
  const msg = (code, status, message = "") =>
    trialErrorMessage(Object.assign(new Error(message), { code, status }), rules);
  assert.match(msg("TURNSTILE_FAILED", 403), /verificación de seguridad/);
  assert.match(msg("", 403), /verificación de seguridad/);
  assert.match(msg("RATE_LIMITED", 429), /Demasiados intentos/);
  assert.match(msg("", 429), /Demasiados intentos/);
  assert.match(msg("TRIAL_OTP_DAILY_CAP", 503), /no podemos enviar más códigos/);
  assert.match(msg("DIAL_CODE_NOT_ALLOWED", 400), /Guatemala/);
  assert.match(msg("INVALID_CODE", 400), /no coincide/);
  assert.match(msg("CODE_EXPIRED", 400), /venció/);
  assert.match(msg("GRANT_EXPIRED", 401), /Vuelve a verificar/);
  assert.match(msg("TRIAL_PHONE_EXISTS", 409), /ya tiene una prueba/);
  assert.match(msg("", 409, "Teléfono ya registrado"), /ya tiene una prueba/);
  assert.match(msg("", 409, "Email already used"), /correo ya tiene una cuenta/);
  assert.equal(msg("WEAK_PASSWORD", 400), "Usa 8 a 128 caracteres.");
  assert.equal(msg("", 400, "Password too common"), "Usa 8 a 128 caracteres.");
  assert.equal(msg("", 400, "Falta el negocio (Ref: abc)"), "Falta el negocio");
  assert.equal(msg("", 404), UNAVAILABLE_MESSAGE);
  assert.equal(trialErrorMessage(new Error("Failed to fetch")), NETWORK_MESSAGE);
  assert.match(msg("", 500), /servidor/);
});

test("signup failures route to datos, grant or retry", () => {
  const kind = (code, status, message = "") =>
    signupFailureKind(Object.assign(new Error(message), { code, status }));
  assert.equal(kind("GRANT_CONSUMED", 409), "grant");
  assert.equal(kind("TRIAL_PHONE_EXISTS", 409), "grant");
  assert.equal(kind("", 409, "Teléfono ya tiene una prueba"), "grant");
  assert.equal(kind("EMAIL_ALREADY_USED", 409), "datos");
  assert.equal(kind("", 409, "Email already used"), "datos");
  assert.equal(kind("WEAK_PASSWORD", 400), "datos");
  assert.equal(kind("", 400), "datos");
  assert.equal(kind("", 401), "grant");
  assert.equal(kind("", 503), "retry");
  assert.equal(signupFailureKind(new Error("Failed to fetch")), "retry");
  assert.equal(datosFieldForMessage("Ese correo ya tiene una cuenta."), "email");
  assert.equal(datosFieldForMessage("Elige una contraseña"), "password");
  assert.equal(datosFieldForMessage("Nombre inválido"), "businessName");
});
