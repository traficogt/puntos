export const API = "";
const RUNTIME_CONFIG_KEY = "__PF_RUNTIME_CONFIG__";
const CSRF_COOKIE = "pf_csrf_readable";
const CSRF_STORAGE_KEY = "pf_csrf_token";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** @type {Record<string, string>} */
const ERROR_BY_CODE = {
  AUTH_REQUIRED: "No autenticado",
  AUTH_INVALID_TOKEN: "Token invalido",
  FORBIDDEN: "No autorizado",
  RBAC_ROLE_REQUIRED: "Se requiere rol Dueño",
  RBAC_ROLE_INSUFFICIENT: "Rol insuficiente",
  RBAC_PERMISSION_DENIED: "Permiso insuficiente",
  PLAN_FEATURE_LOCKED: "Funcionalidad no disponible en tu plan actual",
  BUSINESS_CONTEXT_REQUIRED: "Contexto de negocio requerido",
  NOT_FOUND: "No encontrado",
  BAD_JSON: "JSON invalido",
  VALIDATION_ERROR: "Validacion fallida",
  INTERNAL_ERROR: "Error interno del servidor",
  RATE_LIMITED: "Demasiadas solicitudes, intenta de nuevo en un momento",
};

let csrfTokenMemory = "";

/**
 * Deployment settings the server injects into the page before this module loads.
 * @typedef {{
 *   apiBaseUrl?: string,
 *   publicWebOrigin?: string,
 *   appOrigin?: string,
 *   marketingOrigin?: string,
 *   shell?: string,
 * }} RuntimeConfig
 */

/** @returns {RuntimeConfig} */
function readRuntimeConfig() {
  const scope = /** @type {Record<string, unknown>} */ (globalThis);
  const runtime = scope?.[RUNTIME_CONFIG_KEY];
  return runtime && typeof runtime === "object" ? /** @type {RuntimeConfig} */ (runtime) : {};
}

/** @param {unknown} value */
function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** @param {unknown} value */
function isAbsoluteUrl(value) {
  return /^[a-z][a-z\d+\-.]*:/i.test(String(value || ""));
}

/**
 * @param {string} path
 * @param {string} base
 */
function withBase(path, base) {
  const rawPath = String(path || "").trim();
  if (!rawPath) return base || "";
  if (isAbsoluteUrl(rawPath)) return rawPath;
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

/** The readable CSRF cookie set by the server; "" outside a document or when no cookie is set. */
export function readCookieCsrfToken() {
  if (typeof document === "undefined") return "";
  return (
    document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${CSRF_COOKIE}=`))
      ?.split("=")[1] || ""
  );
}

function readStoredCsrfToken() {
  if (csrfTokenMemory) return csrfTokenMemory;
  if (typeof localStorage === "undefined") return "";
  try {
    csrfTokenMemory = localStorage.getItem(CSRF_STORAGE_KEY) || "";
  } catch {
    csrfTokenMemory = "";
  }
  return csrfTokenMemory;
}

/** @param {unknown} token */
function storeCsrfToken(token) {
  const nextToken = String(token || "").trim();
  if (!nextToken) return;
  csrfTokenMemory = nextToken;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CSRF_STORAGE_KEY, nextToken);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function getApiBaseUrl() {
  return normalizeBaseUrl(readRuntimeConfig().apiBaseUrl || API);
}

export function getPublicWebOrigin() {
  return normalizeBaseUrl(readRuntimeConfig().publicWebOrigin);
}

export function getAppOrigin() {
  return normalizeBaseUrl(readRuntimeConfig().appOrigin);
}

export function getMarketingOrigin() {
  return normalizeBaseUrl(readRuntimeConfig().marketingOrigin);
}

/** @param {string} path */
export function apiUrl(path) {
  return withBase(path, getApiBaseUrl());
}

/** @param {string} path */
export function publicUrl(path) {
  return withBase(path, getPublicWebOrigin());
}

/** @param {string} path */
export function appUrl(path) {
  return withBase(path, getAppOrigin() || getPublicWebOrigin());
}

/** @param {string} path */
export function marketingUrl(path) {
  return withBase(path, getMarketingOrigin() || getPublicWebOrigin());
}

export function hydrateShellLinks(root = document) {
  /** @type {Record<string, () => string>} */
  const linkMap = {
    "marketing-home": () => marketingUrl("/"),
    "app-login": () => appUrl("/equipo/ingresar/"),
    "app-scanner": () => appUrl("/equipo/escaner/"),
    "app-dashboard": () => appUrl("/negocio/"),
    "customer-wallet": () => appUrl("/mi-tarjeta/"),
  };

  root.querySelectorAll("[data-shell-link]").forEach((node) => {
    const key = node.getAttribute("data-shell-link") || "";
    const resolver = linkMap[key];
    const href = resolver ? resolver() : "";
    if (!href) return;
    node.setAttribute("href", href);
  });
}

export function isNativeShell() {
  const shell = String(readRuntimeConfig().shell || "")
    .trim()
    .toLowerCase();
  const protocol =
    typeof location !== "undefined" ? String(location.protocol || "").toLowerCase() : "";
  return (
    shell === "capacitor" ||
    shell === "native" ||
    protocol === "capacitor:" ||
    protocol === "ionic:"
  );
}

/**
 * Shared JSON client. Failed responses throw an `Error` carrying `status`, `code`, `requestId`
 * and, when the server offers one, `recoveryCaseId`.
 * @param {string} path
 * @param {RequestInit & { rawError?: boolean }} [opts] `rawError: true` keeps the server's `error`
 *   text and `code` verbatim: no code-to-Spanish mapping, no English fallback translation and no
 *   "(Ref: id)" suffix. The message is "" when the response carried no error text, so the caller
 *   can show its own copy. Public forms that display the service's Spanish copy as written use it.
 */
export async function api(path, { rawError = false, ...opts } = {}) {
  const csrfToken = readCookieCsrfToken() || readStoredCsrfToken();

  const headers = new Headers(opts.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (csrfToken && MUTATION_METHODS.has(String(opts.method || "").toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const res = await fetch(apiUrl(path), {
    credentials: "include",
    ...opts,
    headers,
  });

  const txt = await res.text();
  /** @type {Record<string, unknown> | null} */
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = { raw: txt };
  }
  storeCsrfToken(res.headers.get("x-csrf-token") || data?.csrfToken || "");

  if (!res.ok) {
    const code = typeof data?.code === "string" ? data.code : "";
    const bodyRequestId = data?.request_id;
    const requestId =
      (typeof bodyRequestId === "string" && bodyRequestId) || res.headers.get("x-request-id") || "";
    const serverError = typeof data?.error === "string" ? data.error : "";
    // The server's `error` is the message text or, for validation failures, a detail object.
    const bodyError = /** @type {string | Record<string, unknown> | undefined} */ (data?.error);
    let err = rawError
      ? (bodyError ?? "")
      : serverError === "MFA_REQUIRED"
        ? "Se requiere código MFA"
        : ERROR_BY_CODE[code] || bodyError || `HTTP ${res.status}`;
    if (err && typeof err === "object") {
      // A non-null object narrows to `object`; read its optional fields through a record view.
      const shape = /** @type {Record<string, unknown>} */ (err);
      const formErrors = Array.isArray(shape.formErrors) ? shape.formErrors.filter(Boolean) : [];
      const fieldErrors =
        shape.fieldErrors && typeof shape.fieldErrors === "object" ? shape.fieldErrors : {};
      const firstFieldError = Object.entries(fieldErrors).find(
        ([, v]) => Array.isArray(v) && v.length > 0,
      );
      if (firstFieldError) {
        const [field, messages] = firstFieldError;
        const first = String(messages[0] || "").trim();
        if (first) {
          err = `${field}: ${first}`;
        }
      } else if (formErrors.length > 0) {
        err = String(formErrors[0]);
      }
    }
    // Fallback for older servers that still answer in English. Current servers send Spanish
    // text plus a stable `code`; Spanish messages pass through these anchored patterns unchanged.
    if (!rawError && typeof err === "string") {
      err = err.replace(
        /^Feature '([^']+)' not available in current plan$/,
        "La funcionalidad '$1' no esta disponible en tu plan actual",
      );
      err = err.replace(/^Not authenticated$/, "No autenticado");
      err = err.replace(/^no auth$/i, "No autenticado");
      err = err.replace(/^Invalid token$/, "Token invalido");
      err = err.replace(/^Server error$/i, "Error interno del servidor");
      err = err.replace(/^Internal server error$/i, "Error interno del servidor");
      err = err.replace(/^Validation failed$/i, "Validación fallida");
      err = err.replace(
        /^must contain at least 1 character\(s\)$/i,
        "Debe contener al menos 1 carácter",
      );
      err = err.replace(/^Missing businessId$/i, "Falta el negocio");
      err = err.replace(
        /^Referral settings not found$/i,
        "No se encontro la configuracion de referidos",
      );
      err = err.replace(/^WhatsApp Cloud env not configured$/i, "WhatsApp no esta configurado");
      err = err.replace(/^SMTP env not configured$/i, "Correo SMTP no esta configurado");
      err = err.replace(/^SMS_GATEWAY_URL missing$/i, "Falta configurar SMS_GATEWAY_URL");
      err = err.replace(
        /^NO_DELIVERY_PROVIDER(?::.*)?$/i,
        "No se pudo enviar el código por los canales disponibles.",
      );
      err = err.replace(/^Business not found$/i, "Negocio no encontrado");
      err = err.replace(/^Phone required$/i, "Falta el teléfono");
      err = err.replace(/^Code required$/i, "Falta el código");
      err = err.replace(
        /^No valid code\. Request a new one\.$/i,
        "No hay un código válido. Solicita uno nuevo.",
      );
      err = err.replace(/^Invalid code$/i, "Código inválido");
      err = err.replace(
        /^Please wait before requesting another code$/i,
        "Espera un momento antes de solicitar otro código.",
      );
      err = err.replace(
        /^Too many verification codes requested$/i,
        "Solicitaste demasiados códigos de verificación.",
      );
      err = err.replace(/^Unknown MESSAGE_PROVIDER: .+$/i, "Proveedor de mensajeria no reconocido");
      err = err.replace(
        /^Failed to generate unique referral code$/i,
        "No se pudo generar un codigo unico de referido",
      );
      err = err.replace(/^HTTP 401$/i, "No autenticado");
      err = err.replace(/^HTTP 403$/i, "No autorizado");
      err = err.replace(/^HTTP 404$/i, "No encontrado");
      if (/is not defined$/i.test(err)) {
        err = "Error interno del servidor";
      }
    }
    const message = typeof err === "string" ? err : JSON.stringify(err);
    const wrapped =
      /** @type {Error & { code?: string; requestId?: string; status?: number; recoveryCaseId?: string }} */ (
        new Error(requestId && !rawError ? `${message} (Ref: ${requestId})` : message)
      );
    wrapped.code = code || undefined;
    wrapped.status = res.status;
    wrapped.requestId = requestId || undefined;
    if (
      typeof data?.recoveryCaseId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.recoveryCaseId)
    )
      wrapped.recoveryCaseId = data.recoveryCaseId;
    throw wrapped;
  }
  return data;
}

/** @param {string} sel */
export function $(sel) {
  return document.querySelector(sel);
}
/** @param {string} sel */
export function $all(sel) {
  return [...document.querySelectorAll(sel)];
}

/**
 * @param {HTMLElement | null | undefined} el
 * @param {boolean} hidden
 */
export function setHidden(el, hidden) {
  if (!el) return;
  const nextHidden = Boolean(hidden);
  el.hidden = nextHidden;
  el.classList.toggle("is-hidden", nextHidden);
  if (nextHidden) {
    el.setAttribute("aria-hidden", "true");
  } else {
    el.removeAttribute("aria-hidden");
  }
}

export function registerServiceWorker() {
  if (isNativeShell() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve();
  }
  let suppressReloadOnControl = false;
  if (typeof location !== "undefined") {
    const params = new URLSearchParams(location.search || "");
    if (params.get("sw") === "off") {
      return Promise.resolve(null);
    }
    suppressReloadOnControl = params.get("sw") === "noreload";
  }

  let refreshing = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (suppressReloadOnControl) return;
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  return navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      registration.update().catch(() => {});

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });

      return registration;
    })
    .catch(() => null);
}

/** @param {string} msg */
export function toast(msg) {
  const t = /** @type {(HTMLElement & { _to?: ReturnType<typeof setTimeout> }) | null} */ (
    document.querySelector("#toast")
  );
  if (!t) {
    if (document?.body) {
      modalAlert(msg).catch(() => {});
      return;
    }
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.classList.add("is-visible");
  t.hidden = false;
  clearTimeout(t._to);
  t._to = setTimeout(() => {
    t.hidden = true;
    t.classList.remove("is-visible");
  }, 3200);
}

/** @param {unknown} n */
export function fmtQ(n) {
  return regionalMoney(n);
}

/** @param {unknown} value */
export function isStrongPassword(value) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 128 && password.trim().length >= 1;
}

export function passwordRequirementsText() {
  return "Usa 8 a 128 caracteres. Evita claves comunes o fáciles de adivinar.";
}

function canRenderModal() {
  return typeof document !== "undefined" && Boolean(document.body);
}

/**
 * @typedef {{
 *   title?: string,
 *   message: string,
 *   pre?: boolean,
 *   input?: boolean,
 *   inputType?: string,
 *   value?: string,
 *   placeholder?: string,
 *   confirmText?: string,
 *   cancelText?: string,
 *   showCancel?: boolean,
 * }} ModalOptions
 */

/**
 * @param {ModalOptions} options
 * @returns {Promise<boolean | string | null>} The confirmation, or the typed value (`null` when dismissed).
 */
function openModal({
  title,
  message,
  pre = false,
  input = false,
  inputType = "text",
  value = "",
  placeholder = "",
  confirmText = "OK",
  cancelText = "Cancelar",
  showCancel = false,
}) {
  if (!canRenderModal()) return Promise.resolve(input ? null : false);
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const card = document.createElement("div");
    card.className = "modal";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "modal-header";
    const h = document.createElement("strong");
    h.textContent = title || "Aviso";
    header.appendChild(h);

    const body = document.createElement("div");
    body.className = "modal-body";
    const messageEl = pre ? document.createElement("pre") : document.createElement("p");
    messageEl.className = pre ? "modal-pre" : "";
    messageEl.textContent = message || "";
    body.appendChild(messageEl);

    /** @type {HTMLInputElement | null} */
    let inputEl = null;
    if (input) {
      inputEl = document.createElement("input");
      inputEl.type = inputType;
      inputEl.value = value || "";
      inputEl.placeholder = placeholder || "";
      body.appendChild(inputEl);
    }

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const btnPrimary = document.createElement("button");
    btnPrimary.className = "primary";
    btnPrimary.textContent = confirmText;

    const btnCancel = document.createElement("button");
    btnCancel.className = "secondary";
    btnCancel.textContent = cancelText;

    if (showCancel) actions.appendChild(btnCancel);
    actions.appendChild(btnPrimary);

    card.append(header, body, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");

    const cleanup = () => {
      backdrop.remove();
      if (document.body) document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", onKeydown);
    };

    /** @param {boolean | string | null} result */
    const close = (result) => {
      cleanup();
      resolve(result);
    };

    /** @param {KeyboardEvent} e */
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        close(input ? null : false);
      } else if (e.key === "Enter") {
        if (input) {
          close(inputEl ? inputEl.value : "");
        } else {
          close(true);
        }
      }
    };

    btnPrimary.addEventListener("click", () => {
      if (input) {
        close(inputEl ? inputEl.value : "");
      } else {
        close(true);
      }
    });
    btnCancel.addEventListener("click", () => close(input ? null : false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(input ? null : false);
    });
    document.addEventListener("keydown", onKeydown);

    if (inputEl) {
      inputEl.focus();
      inputEl.select?.();
    } else {
      btnPrimary.focus();
    }
  });
}

/**
 * @param {string} message
 * @param {{ title?: string, pre?: boolean, confirmText?: string }} [opts]
 */
export function modalAlert(message, opts = {}) {
  return openModal({
    title: opts.title || "Aviso",
    message,
    pre: Boolean(opts.pre),
    confirmText: opts.confirmText || "OK",
    showCancel: false,
  });
}

/**
 * @param {string} message
 * @param {{ title?: string, confirmText?: string, cancelText?: string }} [opts]
 */
export function modalConfirm(message, opts = {}) {
  return openModal({
    title: opts.title || "Confirmar",
    message,
    confirmText: opts.confirmText || "Aceptar",
    cancelText: opts.cancelText || "Cancelar",
    showCancel: true,
  }).then((result) => Boolean(result));
}

/**
 * @param {string} message
 * @param {{ title?: string, inputType?: string, value?: string, placeholder?: string, confirmText?: string, cancelText?: string }} [opts]
 */
export function modalPrompt(message, opts = {}) {
  return openModal({
    title: opts.title || "Ingresar",
    message,
    input: true,
    inputType: opts.inputType || "text",
    value: opts.value || "",
    placeholder: opts.placeholder || "",
    confirmText: opts.confirmText || "Guardar",
    cancelText: opts.cancelText || "Cancelar",
    showCancel: true,
  });
}

export function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isIos() {
  const ua = navigator.userAgent || "";
  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    Boolean(/** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone)
  );
}

export function mountIosInstallHint() {
  if (isNativeShell() || !isIos() || isStandalone()) return;
  if (document.querySelector("#iosInstallHint")) return;

  const ua = navigator.userAgent || "";
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Brave/i.test(ua);
  const msg = isSafari
    ? "Para instalar esta app: Compartir -> Agregar a pantalla de inicio."
    : "En iPhone, abre este sitio en Safari y toca Compartir -> Agregar a pantalla de inicio.";

  const container = document.querySelector(".container");
  if (!container) return;

  const box = document.createElement("div");
  box.id = "iosInstallHint";
  box.className = "card ios-install-hint";
  const row = document.createElement("div");
  row.className = "row row-between-start";

  const left = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = "Instalar app en iPhone";
  const p = document.createElement("p");
  p.className = "small";
  p.classList.add("mt-6");
  p.textContent = msg;
  left.append(strong, p);

  const closeBtn = document.createElement("button");
  closeBtn.id = "btnHideIosInstallHint";
  closeBtn.className = "badge";
  closeBtn.type = "button";
  closeBtn.textContent = "Cerrar";

  row.append(left, closeBtn);
  box.appendChild(row);
  container.prepend(box);
  box.querySelector("#btnHideIosInstallHint")?.addEventListener("click", () => box.remove());
}

// Keep previously shared section bookmarks usable after the Spanish URL migration.
const legacySections = new Map([
  ["nativeWalletSection", "billeteras"],
  ["operationsMain", "contenido"],
  ["mainCard", "planes"],
  ["securityCard", "seguridad"],
  ["businessCard", "negocios"],
]);
if (typeof location !== "undefined" && typeof history !== "undefined") {
  const section = legacySections.get(location.hash?.slice(1));
  if (section) history.replaceState(null, "", `${location.pathname}${location.search}#${section}`);
}

let browserRegion = {
  currency: "GTQ",
  locale: "es-GT",
  timezone: "America/Guatemala",
  minorUnits: 2,
};
/** @param {Partial<typeof browserRegion>} [region] */
export function setBrowserRegion(region) {
  browserRegion = {
    currency: "GTQ",
    locale: "es-GT",
    timezone: "America/Guatemala",
    minorUnits: 2,
    ...region,
  };
}
export function currentBrowserRegion() {
  return browserRegion;
}
/** @param {unknown} value */
export function regionalMoney(value) {
  return new Intl.NumberFormat(browserRegion.locale, {
    style: "currency",
    currency: browserRegion.currency,
    minimumFractionDigits: browserRegion.minorUnits,
    maximumFractionDigits: browserRegion.minorUnits,
  }).format(Number(value) || 0);
}
