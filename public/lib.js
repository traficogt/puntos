export const API = "";
const CSRF_COOKIE = "pf_csrf_readable";
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  RATE_LIMITED: "Demasiadas solicitudes, intenta de nuevo en un momento"
};

export async function api(path, opts = {}) {
  const csrfToken = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE}=`))
    ?.split("=")[1];
  
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers ?? {})
  };
  
  if (csrfToken && MUTATION_METHODS.has(String(opts.method || "").toUpperCase())) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  
  const res = await fetch(API + path, {
    credentials: "include",
    headers,
    ...opts
  });

  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }

  if (!res.ok) {
    const code = typeof data?.code === "string" ? data.code : "";
    const requestId = data?.request_id || res.headers.get("x-request-id") || "";
    let err = ERROR_BY_CODE[code] || data?.error || `HTTP ${res.status}`;
    if (err && typeof err === "object") {
      const formErrors = Array.isArray(err.formErrors) ? err.formErrors.filter(Boolean) : [];
      const fieldErrors = err.fieldErrors && typeof err.fieldErrors === "object" ? err.fieldErrors : {};
      const firstFieldError = Object.entries(fieldErrors).find(([, v]) => Array.isArray(v) && v.length > 0);
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
    if (typeof err === "string") {
      err = err.replace(
        /^Feature '([^']+)' not available in current plan$/,
        "La funcionalidad '$1' no esta disponible en tu plan actual"
      );
      err = err.replace(/^Not authenticated$/, "No autenticado");
      err = err.replace(/^no auth$/i, "No autenticado");
      err = err.replace(/^Invalid token$/, "Token invalido");
      err = err.replace(/^Server error$/i, "Error interno del servidor");
      err = err.replace(/^Internal server error$/i, "Error interno del servidor");
      err = err.replace(/^Validation failed$/i, "Validación fallida");
      err = err.replace(/^must contain at least 1 character\(s\)$/i, "Debe contener al menos 1 carácter");
      err = err.replace(/^Missing businessId$/i, "Falta el negocio");
      err = err.replace(/^Referral settings not found$/i, "No se encontro la configuracion de referidos");
      err = err.replace(/^WhatsApp Cloud env not configured$/i, "WhatsApp no esta configurado");
      err = err.replace(/^SMTP env not configured$/i, "Correo SMTP no esta configurado");
      err = err.replace(/^SMS_GATEWAY_URL missing$/i, "Falta configurar SMS_GATEWAY_URL");
      err = err.replace(/^Unknown MESSAGE_PROVIDER: .+$/i, "Proveedor de mensajeria no reconocido");
      err = err.replace(/^Failed to generate unique referral code$/i, "No se pudo generar un codigo unico de referido");
      err = err.replace(/^HTTP 401$/i, "No autenticado");
      err = err.replace(/^HTTP 403$/i, "No autorizado");
      err = err.replace(/^HTTP 404$/i, "No encontrado");
      if (/is not defined$/i.test(err)) {
        err = "Error interno del servidor";
      }
    }
    const message = typeof err === "string" ? err : JSON.stringify(err);
    const wrapped = new Error(requestId ? `${message} (Ref: ${requestId})` : message);
    wrapped.code = code || undefined;
    wrapped.requestId = requestId || undefined;
    throw wrapped;
  }
  return data;
}

export function $(sel) { return document.querySelector(sel); }
export function $all(sel) { return [...document.querySelectorAll(sel)]; }

export function toast(msg) {
  const t = document.querySelector("#toast");
  if (!t) {
    if (document?.body) {
      modalAlert(msg).catch(() => {});
      return;
    }
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.display = "none"; }, 3200);
}

export function fmtQ(n) {
  const v = Number(n ?? 0);
  return `Q${v.toFixed(2)}`;
}

export function isStrongPassword(value) {
  const password = String(value || "");
  return password.length >= 8
    && password.length <= 100
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^a-zA-Z0-9]/.test(password);
}

export function passwordRequirementsText() {
  return "Usa 8+ caracteres con mayúscula, minúscula, número y símbolo.";
}

function canRenderModal() {
  return typeof document !== "undefined" && Boolean(document.body);
}

function openModal({ title, message, pre = false, input = false, inputType = "text", value = "", placeholder = "", confirmText = "OK", cancelText = "Cancelar", showCancel = false }) {
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

    const close = (result) => {
      cleanup();
      resolve(result);
    };

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

export function modalAlert(message, opts = {}) {
  return openModal({
    title: opts.title || "Aviso",
    message,
    pre: Boolean(opts.pre),
    confirmText: opts.confirmText || "OK",
    showCancel: false
  });
}

export function modalConfirm(message, opts = {}) {
  return openModal({
    title: opts.title || "Confirmar",
    message,
    confirmText: opts.confirmText || "Aceptar",
    cancelText: opts.cancelText || "Cancelar",
    showCancel: true
  }).then((result) => Boolean(result));
}

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
    showCancel: true
  });
}

export function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || Boolean(navigator.standalone);
}

export function mountIosInstallHint() {
  if (!isIos() || isStandalone()) return;
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
  row.className = "row";
  row.style.justifyContent = "space-between";
  row.style.alignItems = "flex-start";
  row.style.gap = "10px";

  const left = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = "Instalar app en iPhone";
  const p = document.createElement("p");
  p.className = "small";
  p.style.marginTop = "6px";
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
