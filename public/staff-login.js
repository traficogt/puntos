import { api, $, registerServiceWorker, toast, hydrateShellLinks } from "/lib.js";

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

element("#btnLogin").addEventListener("click", async () => {
  try {
    /** @type {StaffLoginPayload} */
    const payload = {
      email: input("#email").value.trim(),
      password: input("#password").value,
      ...(input("#mfaCode").value.trim() ? { mfaCode: input("#mfaCode").value.trim() } : {})
    };
    const out = await api("/api/staff/login", { method: "POST", body: JSON.stringify(payload) });
    const role = String(out?.staff?.role || "").toUpperCase();
    const destination = role === "OWNER" ? "/admin-dashboard" : "/staff";
    toast(role === "OWNER" ? "Listo. Abriendo panel..." : "Listo. Abriendo escáner...");
    setTimeout(() => {
      location.href = destination;
    }, 400);
  } catch (e) {
    toast(e.message);
  }
});

element("#btnRequestReset").addEventListener("click", async () => {
  try {
    const email = input("#resetEmail").value.trim() || input("#email").value.trim();
    if (!email) return toast("Escribe tu correo.");
    await api("/api/public/staff/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email })
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
      body: JSON.stringify({ token, newPassword })
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
      body: JSON.stringify({ token })
    });
    input("#emailChangeToken").value = "";
    toast("Cambio de correo confirmado.");
  } catch (e) {
    toast(e.message);
  }
});

element("#btnLogout").addEventListener("click", async () => {
  await api("/api/staff/logout", { method: "POST", body: "{}" }).catch(() => {});
  toast("Sesión cerrada.");
});

registerServiceWorker().catch(() => {});
