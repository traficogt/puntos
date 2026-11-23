import { staffLoginDestination } from "./staff-return-path.js";
import { api, $, toast, hydrateShellLinks } from "/lib.js";
import { createSessionEpoch, revokeServerSession } from "./session-epoch.js";

/** @typedef {import("./staff/types.js").StaffLoginPayload} StaffLoginPayload */

/**
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
function input(selector) {
  return /** @type {HTMLInputElement} */ ($(selector));
}

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
function element(selector) {
  return /** @type {HTMLElement} */ ($(selector));
}

hydrateShellLinks();

let sessionActionInProgress = false;
// Online authentication remains available when browser storage is disabled:
// the shared session helpers swallow storage failures.
const session = createSessionEpoch("staff");

async function finishPendingLogout() {
  await revokeServerSession(api, "/api/staff/logout");
  session.clearPendingLogout();
}

element("#btnLogin").addEventListener("click", async () => {
  if (sessionActionInProgress) return;
  sessionActionInProgress = true;
  try {
    if (session.hasPendingLogout()) await finishPendingLogout();
    /** @type {StaffLoginPayload} */
    const payload = {
      email: input("#email").value.trim(),
      password: input("#password").value,
      ...(input("#mfaCode").value.trim() ? { mfaCode: input("#mfaCode").value.trim() } : {}),
    };
    const out = await api("/api/staff/login", { method: "POST", body: JSON.stringify(payload) });
    session.invalidate({ pending: false });
    const role = String(out?.staff?.role || "").toUpperCase();
    const destination = staffLoginDestination(
      role,
      new URLSearchParams(location.search).get("return_to"),
    );
    toast(
      role === "OWNER"
        ? "Listo. Abriendo panel..."
        : role === "MANAGER"
          ? "Listo. Abriendo administración..."
          : "Listo. Abriendo escáner...",
    );
    setTimeout(() => {
      // staffLoginDestination allows only /negocio/ with a validated fragment or fixed local role paths.
      // Covered by tests/unit/staff-login-redirect.test.js.
      // nosemgrep: javascript.browser.security.open-redirect.js-open-redirect
      location.href = destination;
    }, 400);
  } catch (e) {
    toast(e.message);
  } finally {
    sessionActionInProgress = false;
  }
});

element("#btnRequestReset").addEventListener("click", async () => {
  try {
    const email = input("#resetEmail").value.trim() || input("#email").value.trim();
    if (!email) return toast("Escribe tu correo.");
    await api("/api/public/staff/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    toast("Si el correo existe, enviamos un token de reset.");
  } catch (e) {
    toast(e.message);
  }
});

element("#btnConfirmReset").addEventListener("click", async () => {
  try {
    const token = input("#resetToken").value.trim();
    const newPassword = input("#resetPassword").value;
    if (!token || !newPassword) return toast("Completa token y nueva contraseña.");
    await api("/api/public/staff/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
    input("#resetToken").value = "";
    input("#resetPassword").value = "";
    toast("Contraseña actualizada. Ya puedes iniciar sesión.");
  } catch (e) {
    toast(e.message);
  }
});

element("#btnConfirmEmailChange").addEventListener("click", async () => {
  try {
    const token = input("#emailChangeToken").value.trim();
    if (!token) return toast("Escribe el token recibido.");
    await api("/api/public/staff/email-change/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    input("#emailChangeToken").value = "";
    toast("Cambio de correo confirmado.");
  } catch (e) {
    toast(e.message);
  }
});

element("#btnLogout").addEventListener("click", async () => {
  if (sessionActionInProgress) return;
  sessionActionInProgress = true;
  session.invalidate({ pending: true });
  try {
    await finishPendingLogout();
    toast("Sesión cerrada.");
  } catch {
    toast("No se pudo cerrar la sesión en el servidor. Reconecta e inténtalo de nuevo.");
  } finally {
    sessionActionInProgress = false;
  }
});
