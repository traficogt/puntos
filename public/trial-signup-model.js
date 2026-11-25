// Self-serve 14-day trial signup (docs/product/2026-11-25-self-serve-trial.md §4.1, §7.2, §8):
// the step state machine, phone normalisation, request payloads and the Spanish copy for the
// error codes the trial API answers with. No DOM access, so tests/unit/trial-signup-model.test.js
// runs it in Node.

/** @typedef {"datos" | "telefono" | "codigo" | "crear" | "listo"} TrialStep */
/** @typedef {{ slug: string, name: string }} TrialBusiness */
/**
 * @typedef {{
 *   step: TrialStep,
 *   phone: string,
 *   grant: string,
 *   error: string,
 *   business: TrialBusiness | null,
 * }} TrialSignupState
 */
/**
 * @typedef {{ type: "DATOS_OK" }
 *   | { type: "EDIT_DATOS" }
 *   | { type: "CODE_SENT", phone: string }
 *   | { type: "CHANGE_PHONE" }
 *   | { type: "VERIFIED", grant: string }
 *   | { type: "CREATED", business: TrialBusiness }
 *   | { type: "SIGNUP_FAILED", kind: "datos" | "grant" | "retry", error: string }
 *   | { type: "FAILED", error: string }
 *   | { type: "RESET" }} TrialSignupEvent
 */
/** @typedef {Error & { status?: number, code?: string }} TrialApiError */

export const TRIAL_DAYS = 14;
export const TRIAL_PLAN_NAME = "Conecta";
export const TRIAL_PLAN_CODE = "EMPRENDEDOR";
/** @type {readonly TrialStep[]} */
export const TRIAL_STEPS = ["datos", "telefono", "codigo", "crear", "listo"];

/** Public step numbers (1 datos, 2 teléfono y código, 3 panel) and the progress they represent. */
export const STEP_PROGRESS = { datos: 25, telefono: 50, codigo: 75, crear: 90, listo: 100 };

/** @returns {TrialSignupState} */
export function initialSignupState() {
  return { step: "datos", phone: "", grant: "", error: "", business: null };
}

/**
 * Pure transition function. Events that do not apply to the current step are ignored, so a
 * late response from an abandoned step can never move the form forward.
 * @param {TrialSignupState} state
 * @param {TrialSignupEvent} event
 * @returns {TrialSignupState}
 */
export function signupReducer(state, event) {
  switch (event.type) {
    case "RESET":
      return initialSignupState();
    case "FAILED":
      return { ...state, error: event.error };
    case "DATOS_OK":
      // A grant kept from a rejected step 1 (duplicate e-mail, weak password) is still valid for
      // five minutes: go straight back to creating the business instead of verifying again.
      return state.step === "datos"
        ? { ...state, step: state.grant ? "crear" : "telefono", error: "" }
        : state;
    case "EDIT_DATOS":
      return state.step === "telefono" ? { ...state, step: "datos", error: "" } : state;
    case "CODE_SENT":
      return state.step === "telefono" || state.step === "codigo"
        ? { ...state, step: "codigo", phone: event.phone, grant: "", error: "" }
        : state;
    case "CHANGE_PHONE":
      return state.step === "codigo"
        ? { ...state, step: "telefono", phone: "", grant: "", error: "" }
        : state;
    case "VERIFIED":
      return state.step === "codigo"
        ? { ...state, step: "crear", grant: event.grant, error: "" }
        : state;
    case "CREATED":
      return state.step === "crear"
        ? { ...state, step: "listo", grant: "", error: "", business: event.business }
        : state;
    case "SIGNUP_FAILED":
      if (state.step !== "crear") return state;
      // The phone proof is single use and expires after five minutes: verify again.
      if (event.kind === "grant")
        return { ...state, step: "telefono", grant: "", error: event.error };
      // Business data was rejected (duplicate e-mail, weak password): the grant stays valid.
      if (event.kind === "datos") return { ...state, step: "datos", error: event.error };
      return { ...state, error: event.error };
    default:
      return state;
  }
}

/**
 * Digits only, Guatemala by default: an 8-digit local number receives the 502 dial code.
 * Returns "" when the number cannot be a valid E.164 digit string (8–15 digits).
 * @param {unknown} raw
 */
export function normalizeTrialPhone(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) return `502${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

/** @param {string} phone normalised digits */
export function maskPhone(phone) {
  const digits = String(phone || "");
  if (digits.length < 8) return digits ? `+${digits}` : "";
  return `+${digits.slice(0, digits.length - 8)} ···· ${digits.slice(-4)}`.replace("+ ", "+");
}

/**
 * Field validation for step 1. The password rule is injected so this module stays free of
 * lib.js; the message text comes from the same helper the internal onboarding uses.
 * @param {{ businessName: string, email: string, password: string, ownerName?: string }} values
 * @param {{ isStrongPassword: (value: string) => boolean, passwordRequirementsText: () => string }} rules
 * @returns {Array<{ field: "businessName" | "email" | "password" | "ownerName", message: string }>}
 */
export function validateDatos(values, rules) {
  /** @type {Array<{ field: "businessName" | "email" | "password" | "ownerName", message: string }>} */
  const errors = [];
  const name = String(values.businessName || "").trim();
  if (name.length < 2 || name.length > 120)
    errors.push({
      field: "businessName",
      message: "Escribe el nombre de tu negocio (2 a 120 caracteres).",
    });
  const email = String(values.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push({
      field: "email",
      message: "Escribe un correo válido; con él entrarás a tu panel.",
    });
  if (!rules.isStrongPassword(String(values.password || "")))
    errors.push({ field: "password", message: rules.passwordRequirementsText() });
  if (String(values.ownerName || "").trim().length > 120)
    errors.push({ field: "ownerName", message: "Tu nombre no puede superar 120 caracteres." });
  return errors;
}

/** @type {Record<string, string>} plan codes and display names accepted in ?plan= */
const PLAN_NAMES = { EMPRENDEDOR: "Conecta", NEGOCIO: "Impulsa", EMPRESA: "Expande" };

/**
 * `/precios` links "Empezar con Impulsa/Expande" to the same trial with `?plan=`; the page only
 * explains that the trial runs on Conecta and the chosen plan is picked at the end.
 * @param {string} search location.search
 * @returns {{ code: string, name: string } | null}
 */
export function intendedPlan(search) {
  const raw = new URLSearchParams(search || "").get("plan");
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  const code =
    Object.keys(PLAN_NAMES).find(
      (key) => key === value || PLAN_NAMES[key].toUpperCase() === value,
    ) || "";
  return code && code !== TRIAL_PLAN_CODE ? { code, name: PLAN_NAMES[code] } : null;
}

/**
 * Body of POST /api/public/trial/request-code. The honeypot travels only when something filled
 * it, so a strict server schema never sees the field for real visitors.
 * @param {{ phone: string, turnstileToken?: string, website?: string }} input
 */
export function requestCodePayload({ phone, turnstileToken = "", website = "" }) {
  return {
    phone,
    ...(turnstileToken ? { turnstileToken } : {}),
    ...(website ? { website } : {}),
  };
}

/**
 * Body of POST /api/public/trial/signup (design §4.1 step 3). `ownerName` is additive: the
 * design body has no owner name, zod strips unknown keys unless the schema is strict.
 * @param {{
 *   grant: string, businessName: string, email: string, password: string, category: string,
 *   ownerName?: string, turnstileToken?: string, website?: string,
 * }} input
 */
export function signupPayload(input) {
  const ownerName = String(input.ownerName || "").trim();
  return {
    grant: input.grant,
    businessName: String(input.businessName || "").trim(),
    email: String(input.email || "").trim(),
    password: input.password,
    category: input.category || "otro",
    ...(ownerName ? { ownerName } : {}),
    ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}),
    ...(input.website ? { website: input.website } : {}),
  };
}

const CHALLENGE_MESSAGE =
  "No pudimos confirmar la verificación de seguridad. Recarga la página e inténtalo de nuevo.";
const RATE_MESSAGE = "Demasiados intentos. Espera unos minutos y vuelve a intentar.";
const CAP_MESSAGE =
  "Hoy no podemos enviar más códigos de verificación. Inténtalo mañana o escríbenos.";
const PHONE_COUNTRY_MESSAGE =
  "Por ahora la prueba está disponible para teléfonos de Guatemala (+502). Escríbenos si estás en otro país.";
const PHONE_EXISTS_MESSAGE =
  "Este teléfono ya tiene una prueba de PuntosFieles. Ingresa a tu negocio o escríbenos.";
const EMAIL_EXISTS_MESSAGE =
  "Ese correo ya tiene una cuenta. Ingresa a tu negocio o usa otro correo.";
const GRANT_MESSAGE =
  "La verificación de tu teléfono venció. Vuelve a verificar tu número para crear el negocio.";
export const UNAVAILABLE_MESSAGE =
  "La prueba gratis todavía no está disponible en este servidor. Escríbenos y la activamos contigo.";
export const NETWORK_MESSAGE = "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.";

/** @type {Record<string, string>} stable server codes → Spanish copy (design §4.1, §8) */
const CODE_MESSAGES = {
  TURNSTILE_FAILED: CHALLENGE_MESSAGE,
  TURNSTILE_REQUIRED: CHALLENGE_MESSAGE,
  CAPTCHA_FAILED: CHALLENGE_MESSAGE,
  CAPTCHA_REQUIRED: CHALLENGE_MESSAGE,
  CHALLENGE_TIMEOUT: CHALLENGE_MESSAGE,
  RATE_LIMITED: RATE_MESSAGE,
  TOO_MANY_REQUESTS: RATE_MESSAGE,
  TRIAL_OTP_DAILY_CAP: CAP_MESSAGE,
  OTP_DAILY_CAP: CAP_MESSAGE,
  PHONE_NOT_ALLOWED: PHONE_COUNTRY_MESSAGE,
  DIAL_CODE_NOT_ALLOWED: PHONE_COUNTRY_MESSAGE,
  INVALID_PHONE: "Revisa el teléfono: escribe los 8 dígitos o el número con su código de país.",
  PHONE_BLOCKED: "Este número no puede iniciar una prueba. Escríbenos si crees que es un error.",
  CODE_INVALID: "El código no coincide. Revisa el mensaje y escríbelo de nuevo.",
  INVALID_CODE: "El código no coincide. Revisa el mensaje y escríbelo de nuevo.",
  CODE_EXPIRED: "El código venció. Solicita uno nuevo.",
  NO_VALID_CODE: "El código venció. Solicita uno nuevo.",
  CODE_ATTEMPTS_EXCEEDED:
    "Demasiados intentos con este código. Solicita uno nuevo en unos minutos.",
  TOO_MANY_ATTEMPTS: "Demasiados intentos con este código. Solicita uno nuevo en unos minutos.",
  CODE_BLOCKED: "Demasiados intentos con este código. Solicita uno nuevo en unos minutos.",
  GRANT_INVALID: GRANT_MESSAGE,
  GRANT_EXPIRED: GRANT_MESSAGE,
  GRANT_CONSUMED: GRANT_MESSAGE,
  INVALID_GRANT: GRANT_MESSAGE,
  TRIAL_PHONE_EXISTS: PHONE_EXISTS_MESSAGE,
  PHONE_ALREADY_USED: PHONE_EXISTS_MESSAGE,
  PHONE_IN_USE: PHONE_EXISTS_MESSAGE,
  EMAIL_ALREADY_USED: EMAIL_EXISTS_MESSAGE,
  EMAIL_IN_USE: EMAIL_EXISTS_MESSAGE,
  EMAIL_EXISTS: EMAIL_EXISTS_MESSAGE,
  VALIDATION_FAILED: "Revisa los datos marcados e inténtalo de nuevo.",
  TRIAL_DISABLED:
    "La prueba gratis está pausada por el momento. Escríbenos y la activamos contigo.",
};

const GRANT_CODES = new Set(["GRANT_INVALID", "GRANT_EXPIRED", "GRANT_CONSUMED", "INVALID_GRANT"]);
const PASSWORD_CODES = new Set(["WEAK_PASSWORD", "PASSWORD_TOO_COMMON", "PASSWORD_INVALID"]);

/** @param {unknown} error */
function readError(error) {
  const e = /** @type {Partial<TrialApiError> | null} */ (
    error && typeof error === "object" ? error : null
  );
  return {
    code: String(e?.code || "").toUpperCase(),
    status: typeof e?.status === "number" ? e.status : 0,
    message: String(e?.message || ""),
  };
}

/**
 * Spanish copy for a failed trial API call. Codes win, then the HTTP status, then a Spanish
 * server message; English legacy messages are translated; "" status means the network failed.
 * @param {unknown} error
 * @param {{ passwordRequirementsText?: () => string }} [options]
 */
export function trialErrorMessage(error, options = {}) {
  const { code, status, message } = readError(error);
  if (PASSWORD_CODES.has(code) || /^Password/i.test(message))
    return (
      options.passwordRequirementsText?.() ||
      "Elige una contraseña de 8 a 128 caracteres que no sea común ni incluya tu nombre, correo o teléfono."
    );
  if (CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (/^Email already used/i.test(message)) return EMAIL_EXISTS_MESSAGE;
  if (status === 404) return UNAVAILABLE_MESSAGE;
  if (status === 429) return RATE_MESSAGE;
  if (status === 503) return CAP_MESSAGE;
  if (status === 403) return CHALLENGE_MESSAGE;
  if (status === 409)
    return /tel[eé]fono|phone/i.test(message) ? PHONE_EXISTS_MESSAGE : EMAIL_EXISTS_MESSAGE;
  if (status === 400)
    return message.replace(/\s*\(Ref: [^)]+\)$/, "") || CODE_MESSAGES.VALIDATION_FAILED;
  if (!status) return NETWORK_MESSAGE;
  if (status >= 500)
    return "El servidor no pudo completar el paso. Inténtalo de nuevo en un momento.";
  return (
    message.replace(/\s*\(Ref: [^)]+\)$/, "") || "No pudimos completar el paso. Inténtalo de nuevo."
  );
}

/**
 * Where the form returns after a failed POST /api/public/trial/signup.
 * @param {unknown} error
 * @returns {"datos" | "grant" | "retry"}
 */
export function signupFailureKind(error) {
  const { code, status, message } = readError(error);
  if (GRANT_CODES.has(code)) return "grant";
  if (PASSWORD_CODES.has(code) || /^Password/i.test(message)) return "datos";
  if (code.startsWith("EMAIL_") || code === "VALIDATION_FAILED") return "datos";
  if (code === "TRIAL_PHONE_EXISTS" || code.startsWith("PHONE_")) return "grant";
  if (status === 409) return /tel[eé]fono|phone/i.test(message) ? "grant" : "datos";
  if (status === 400) return "datos";
  if (status === 401 || status === 403) return "grant";
  return "retry";
}

/**
 * Input id that should receive focus for a step-1 rejection.
 * @param {string} message
 * @returns {"email" | "password" | "businessName"}
 */
export function datosFieldForMessage(message) {
  if (/correo|email/i.test(message)) return "email";
  if (/contraseña|password/i.test(message)) return "password";
  return "businessName";
}
