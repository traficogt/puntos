import { api, $, toast } from "/lib.js";

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

element("#btnLogin").addEventListener("click", async () => {
  try {
    /** @type {StaffLoginPayload} */
    const payload = {
      email: input("#email").value.trim(),
      password: input("#password").value
    };
    await api("/api/staff/login", { method: "POST", body: JSON.stringify(payload) });
    toast("Listo. Abriendo escáner...");
    setTimeout(() => {
      location.href = "/staff";
    }, 400);
  } catch (e) {
    toast(e.message);
  }
});

element("#btnLogout").addEventListener("click", async () => {
  await api("/api/staff/logout", { method: "POST", body: "{}" }).catch(() => {});
  toast("Sesión cerrada.");
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
