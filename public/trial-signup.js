import {
  api,
  $,
  toast,
  setHidden,
  hydrateShellLinks,
  isStrongPassword,
  passwordRequirementsText,
} from "/lib.js";
import { createCooldown, cooldownLabel } from "./otp-cooldown.js";
import {
  STEP_PROGRESS,
  TRIAL_DAYS,
  TRIAL_PLAN_NAME,
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
} from "./trial-signup-model.js";

/** @typedef {import("./trial-signup-model.js").TrialSignupState} TrialSignupState */
/** @typedef {import("./trial-signup-model.js").TrialSignupEvent} TrialSignupEvent */
/** @typedef {import("./trial-signup-model.js").TrialStep} TrialStep */

// Served at /prueba/ (docs/product/2026-11-25-self-serve-trial.md §4.1, §7.2). The three
// requests, in order: POST /api/public/trial/request-code { phone, turnstileToken },
// POST /api/public/trial/verify { phone, code } → { grant }, POST /api/public/trial/signup
// { grant, businessName, email, password, category, turnstileToken } → owner cookie, /negocio/.

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CONFIG_PATHS = ["/api/public/trial/config", "/api/public/support/config"];
/** @type {Record<TrialStep, string>} */
const STAGES = {
  datos: "#trialDatosStage",
  telefono: "#trialPhoneStage",
  codigo: "#trialCodeStage",
  crear: "#trialCreateStage",
  listo: "#trialDoneStage",
};
/** @type {Record<TrialStep, number>} */
const PILL_FOR_STEP = { datos: 1, telefono: 2, codigo: 2, crear: 2, listo: 3 };

/** @param {string} event @param {Record<string, string>} [data] */
function track(event, data) {
  try {
    /** @type {any} */ (window)["umami"]?.track(event, data);
  } catch {
    /* Measurement is optional. */
  }
}

/** @param {string} selector @param {string} message */
function setFeedback(selector, message) {
  const el = $(selector);
  if (el) el.textContent = String(message || "").trim();
}

/** @param {string} selector */
function field(selector) {
  return /** @type {HTMLInputElement | null} */ ($(selector));
}

/** @param {string} selector */
function button(selector) {
  return /** @type {HTMLButtonElement | null} */ ($(selector));
}

/** @type {Promise<any> | null} */
let turnstileLoad = null;
function ensureTurnstileScript() {
  const existing = /** @type {any} */ (window)["turnstile"];
  if (existing) return Promise.resolve(existing);
  if (turnstileLoad) return turnstileLoad;
  turnstileLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.pfTurnstile = "true";
    script.addEventListener("load", () => resolve(/** @type {any} */ (window)["turnstile"]), {
      once: true,
    });
    script.addEventListener("error", () => reject(new Error("CHALLENGE_LOAD_FAILED")), {
      once: true,
    });
    document.head.appendChild(script);
  });
  return turnstileLoad;
}

/**
 * Turnstile is asked twice (request-code and signup); every take() resets the widget so a fresh
 * token is ready for the next call. Without a site key the challenge is not configured (dev).
 * @param {{ container: Element | null, siteKey: string, required: boolean }} options
 */
function createChallenge({ container, siteKey, required }) {
  /** @type {string | null} */
  let widgetId = null;
  let token = "";
  let loadFailed = false;
  /** @type {Array<(value: string) => void>} */
  const waiters = [];
  async function mount() {
    if (!siteKey || widgetId !== null || !container || loadFailed) return;
    try {
      const turnstile = await ensureTurnstileScript();
      if (!turnstile || widgetId !== null) return;
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        language: "es",
        theme: "auto",
        size: "flexible",
        callback: (/** @type {string} */ value) => {
          token = value;
          while (waiters.length) {
            const waiter = waiters.shift();
            if (waiter) waiter(value);
          }
        },
        "expired-callback": () => {
          token = "";
        },
        "error-callback": () => {
          token = "";
        },
      });
    } catch {
      loadFailed = true;
    }
  }
  function reset() {
    token = "";
    const turnstile = /** @type {any} */ (window)["turnstile"];
    if (widgetId !== null && turnstile?.reset) turnstile.reset(widgetId);
  }
  /** @param {number} [timeoutMs] */
  function take(timeoutMs = 20000) {
    if (!siteKey) return Promise.resolve("");
    if (token) {
      const value = token;
      reset();
      return Promise.resolve(value);
    }
    if (widgetId === null) {
      if (!required) return Promise.resolve("");
      return Promise.reject(Object.assign(new Error("challenge"), { code: "CHALLENGE_TIMEOUT" }));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(Object.assign(new Error("challenge"), { code: "CHALLENGE_TIMEOUT" }));
      }, timeoutMs);
      /** @param {string} value */
      const waiter = (value) => {
        clearTimeout(timer);
        reset();
        resolve(value);
      };
      waiters.push(waiter);
    });
  }
  return { mount, take };
}

/** The site key comes from the trial config; older servers only expose the support form config. */
async function loadChallengeConfig() {
  for (const path of CONFIG_PATHS) {
    try {
      const out = await api(path);
      return {
        siteKey: String(out?.siteKey || ""),
        required: Boolean(out?.challengeRequired),
      };
    } catch (error) {
      if (/** @type {{ status?: number }} */ (error)?.status !== 404)
        return { siteKey: "", required: false };
    }
  }
  return { siteKey: "", required: false };
}

/**
 * @param {{ redirectDelayMs?: number }} [options]
 */
export async function initTrialSignup({ redirectDelayMs = 1500 } = {}) {
  hydrateShellLinks();
  /** @type {TrialSignupState} */
  let state = initialSignupState();
  let busy = false;
  let active = true;
  let cooldownStop = () => {};
  let cooldownEndsAt = 0;
  const challenge = createChallenge({
    container: $("#trialChallenge"),
    ...(await loadChallengeConfig()),
  });

  const plan = intendedPlan(location.search);
  const planNote = $("#trialPlanNote");
  if (planNote) {
    if (plan) {
      planNote.textContent = `Elegiste ${plan.name}. La prueba de ${TRIAL_DAYS} días usa ${TRIAL_PLAN_NAME}; al terminar activas ${plan.name} sin perder tus datos.`;
      setHidden(/** @type {HTMLElement} */ (planNote), false);
    } else setHidden(/** @type {HTMLElement} */ (planNote), true);
  }

  /** @param {TrialStep} step */
  function render(step) {
    for (const [key, selector] of Object.entries(STAGES))
      setHidden(/** @type {HTMLElement | null} */ ($(selector)), key !== step);
    const pills = ["#stepDatos", "#stepTelefono", "#stepListo"];
    pills.forEach((selector, index) => {
      const pill = $(selector);
      if (!pill) return;
      const current = PILL_FOR_STEP[step] === index + 1;
      pill.classList.toggle("active", index + 1 <= PILL_FOR_STEP[step]);
      if (current) pill.setAttribute("aria-current", "step");
      else pill.removeAttribute("aria-current");
    });
    const progress = /** @type {HTMLProgressElement | null} */ ($("#trialProgress"));
    if (progress) progress.value = STEP_PROGRESS[step];
    const heading = /** @type {HTMLElement | null} */ ($(`${STAGES[step]} h2`));
    heading?.focus?.();
  }

  /** @param {TrialSignupEvent} event */
  function dispatch(event) {
    const previous = state;
    state = signupReducer(state, event);
    if (state.step !== previous.step) render(state.step);
    return state;
  }

  /** @param {string} selector @param {boolean} value */
  function setBusy(selector, value) {
    const el = button(selector);
    if (el) el.disabled = value;
  }

  /** @param {Array<{ field: string, message: string }>} errors */
  function markDatos(errors) {
    for (const id of ["businessName", "ownerName", "email", "password"]) {
      const input = field(`#${id}`);
      if (!input) continue;
      const error = errors.find((e) => e.field === id);
      if (error) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function datosValues() {
    return {
      businessName: field("#businessName")?.value.trim() || "",
      ownerName: field("#ownerName")?.value.trim() || "",
      email: field("#email")?.value.trim() || "",
      password: field("#password")?.value || "",
      category: /** @type {HTMLSelectElement | null} */ ($("#category"))?.value || "otro",
      website: field("#website")?.value.trim() || "",
    };
  }

  function updatePasswordHint() {
    const hint = $("#passwordHint");
    if (!hint) return;
    const value = field("#password")?.value || "";
    hint.textContent = !value
      ? passwordRequirementsText()
      : isStrongPassword(value)
        ? "Contraseña fuerte."
        : passwordRequirementsText();
  }

  /** @param {Event} [event] */
  async function submitDatos(event) {
    event?.preventDefault();
    if (busy || state.step !== "datos") return;
    const values = datosValues();
    const errors = validateDatos(values, { isStrongPassword, passwordRequirementsText });
    markDatos(errors);
    if (errors.length) {
      setFeedback("#trialDatosFeedback", errors[0].message);
      field(`#${errors[0].field}`)?.focus();
      return;
    }
    setFeedback("#trialDatosFeedback", "");
    const next = dispatch({ type: "DATOS_OK" });
    track("trial_signup_step", { step: "datos" });
    // A grant kept from a rejected attempt skips the phone step (see signupReducer).
    if (next.step === "crear") {
      await createBusiness();
      return;
    }
    void challenge.mount();
    field("#phone")?.focus();
  }

  function startCooldown(seconds = 60) {
    cooldownStop();
    cooldownEndsAt = Date.now() + seconds * 1000;
    const resend = button("#btnResendCode");
    if (resend) resend.disabled = true;
    cooldownStop = createCooldown({
      seconds,
      onTick: (left) => setFeedback("#codeCooldownInfo", cooldownLabel(left)),
      onDone: () => {
        cooldownEndsAt = 0;
        if (resend) resend.disabled = false;
        setFeedback("#codeCooldownInfo", "");
      },
    });
  }

  /** @param {Event} [event] */
  async function requestCode(event) {
    event?.preventDefault();
    if (busy || !["telefono", "codigo"].includes(state.step)) return;
    if (state.step === "codigo" && cooldownEndsAt > Date.now()) return;
    const phone = normalizeTrialPhone(state.phone || field("#phone")?.value);
    if (!phone) {
      field("#phone")?.setAttribute("aria-invalid", "true");
      setFeedback(
        "#trialPhoneFeedback",
        "Escribe los 8 dígitos de tu teléfono o el número completo con su código de país.",
      );
      field("#phone")?.focus();
      return;
    }
    field("#phone")?.removeAttribute("aria-invalid");
    busy = true;
    setBusy("#btnCode", true);
    setBusy("#btnResendCode", true);
    const feedback = state.step === "codigo" ? "#trialCodeFeedback" : "#trialPhoneFeedback";
    setFeedback(feedback, "Enviando código…");
    try {
      const turnstileToken = await challenge.take();
      await api("/api/public/trial/request-code", {
        method: "POST",
        body: JSON.stringify(
          requestCodePayload({ phone, turnstileToken, website: datosValues().website }),
        ),
      });
      if (!active) return;
      dispatch({ type: "CODE_SENT", phone });
      setFeedback("#verificationPhone", `Enviamos un código por SMS a ${maskPhone(phone)}.`);
      setFeedback("#trialPhoneFeedback", "");
      setFeedback("#trialCodeFeedback", "Escribe el código para continuar.");
      const code = field("#code");
      if (code) code.value = "";
      startCooldown(60);
      track("trial_signup_step", { step: "code_requested" });
      code?.focus();
      toast("Código enviado.");
    } catch (error) {
      if (!active) return;
      const message = trialErrorMessage(error, { passwordRequirementsText });
      setFeedback(feedback, message);
      toast(message);
      if (/** @type {{ status?: number }} */ (error)?.status === 404)
        setHidden(/** @type {HTMLElement | null} */ ($("#trialUnavailable")), false);
    } finally {
      busy = false;
      setBusy("#btnCode", false);
      if (cooldownEndsAt <= Date.now()) setBusy("#btnResendCode", false);
    }
  }

  async function createBusiness() {
    if (busy || state.step !== "crear" || !state.grant) return;
    busy = true;
    setHidden(/** @type {HTMLElement | null} */ ($("#btnRetrySignup")), true);
    setFeedback("#trialCreateFeedback", "Creando tu negocio…");
    try {
      const turnstileToken = await challenge.take();
      const values = datosValues();
      const out = await api("/api/public/trial/signup", {
        method: "POST",
        body: JSON.stringify(signupPayload({ ...values, grant: state.grant, turnstileToken })),
      });
      if (!active) return;
      const business = {
        slug: String(out?.business?.slug || ""),
        name: String(out?.business?.name || values.businessName),
      };
      dispatch({ type: "CREATED", business });
      setFeedback(
        "#doneText",
        `Creamos ${business.name}. Tienes ${TRIAL_DAYS} días de prueba con ${TRIAL_PLAN_NAME}; ya estás con sesión de propietario y te llevamos a tu panel para elegir cómo premiar a tus clientes.`,
      );
      const join = $("#joinUrl");
      if (join && business.slug) join.textContent = `${location.origin}/registro/${business.slug}`;
      track("trial_signup_step", { step: "created" });
      toast("Tu negocio está listo.");
      setTimeout(() => {
        if (active) location.assign("/negocio/");
      }, redirectDelayMs);
    } catch (error) {
      if (!active) return;
      const message = trialErrorMessage(error, { passwordRequirementsText });
      const kind = signupFailureKind(error);
      dispatch({ type: "SIGNUP_FAILED", kind, error: message });
      if (kind === "datos") {
        setFeedback("#trialDatosFeedback", message);
        const id = datosFieldForMessage(message);
        markDatos([{ field: id, message }]);
        field(`#${id}`)?.focus();
      } else if (kind === "grant") {
        setFeedback("#trialPhoneFeedback", message);
        field("#phone")?.focus();
      } else {
        setFeedback("#trialCreateFeedback", message);
        setHidden(/** @type {HTMLElement | null} */ ($("#btnRetrySignup")), false);
      }
      toast(message);
    } finally {
      busy = false;
    }
  }

  /** @param {Event} [event] */
  async function verifyCode(event) {
    event?.preventDefault();
    if (busy || state.step !== "codigo") return;
    const code = field("#code")?.value.trim() || "";
    if (!/^\d{4,8}$/.test(code)) {
      field("#code")?.setAttribute("aria-invalid", "true");
      setFeedback("#trialCodeFeedback", "Escribe el código de 6 dígitos que recibiste.");
      field("#code")?.focus();
      return;
    }
    field("#code")?.removeAttribute("aria-invalid");
    busy = true;
    setBusy("#btnVerify", true);
    setFeedback("#trialCodeFeedback", "Verificando código…");
    try {
      const out = await api("/api/public/trial/verify", {
        method: "POST",
        body: JSON.stringify({ phone: state.phone, code }),
      });
      if (!active) return;
      const grant = String(out?.grant || out?.grant_token || out?.token || "");
      if (out?.ok === false || !grant)
        throw Object.assign(
          new Error("No pudimos confirmar tu teléfono. Solicita un código nuevo."),
          {
            status: 400,
            code: "NO_VALID_CODE",
          },
        );
      cooldownStop();
      dispatch({ type: "VERIFIED", grant });
      track("trial_signup_step", { step: "code_verified" });
    } catch (error) {
      if (!active) return;
      const message = trialErrorMessage(error, { passwordRequirementsText });
      setFeedback("#trialCodeFeedback", message);
      toast(message);
      return;
    } finally {
      busy = false;
      setBusy("#btnVerify", false);
    }
    await createBusiness();
  }

  function changePhone() {
    if (busy || state.step !== "codigo") return;
    cooldownStop();
    cooldownEndsAt = 0;
    dispatch({ type: "CHANGE_PHONE" });
    const code = field("#code");
    if (code) code.value = "";
    setFeedback("#codeCooldownInfo", "");
    setFeedback("#trialCodeFeedback", "");
    setFeedback("#trialPhoneFeedback", "");
    field("#phone")?.focus();
  }

  function editDatos() {
    if (busy || state.step !== "telefono") return;
    dispatch({ type: "EDIT_DATOS" });
    field("#businessName")?.focus();
  }

  $("#trialDatosForm")?.addEventListener("submit", submitDatos);
  $("#trialPhoneForm")?.addEventListener("submit", requestCode);
  $("#trialCodeForm")?.addEventListener("submit", verifyCode);
  $("#btnResendCode")?.addEventListener("click", requestCode);
  $("#btnChangePhone")?.addEventListener("click", changePhone);
  $("#btnEditDatos")?.addEventListener("click", editDatos);
  $("#btnRetrySignup")?.addEventListener("click", () => createBusiness());
  $("#password")?.addEventListener("input", updatePasswordHint);
  for (const id of ["businessName", "ownerName", "email", "password", "phone", "code"])
    $(`#${id}`)?.addEventListener("input", (event) => {
      /** @type {Element} */ (event.target).removeAttribute("aria-invalid");
    });
  window.addEventListener("pagehide", () => {
    active = false;
    cooldownStop();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    active = true;
    if (cooldownEndsAt) startCooldown(Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000)));
  });

  updatePasswordHint();
  render(state.step);
  const datosButton = button("#btnDatos");
  if (datosButton) datosButton.disabled = false;
  track("trial_signup_open", plan ? { plan: plan.code } : undefined);
  return {
    /** Current step, for tests and debugging; never used by the page itself. */
    get state() {
      return state;
    },
  };
}
