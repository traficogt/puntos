import { clearCustomerCache } from "/idb.js";
import { loadAll } from "./load.js";
import { setOnlineBadge } from "./network.js";
import { createQrController } from "./qr.js";
import { registerServiceWorker } from "/lib.js";

/** @typedef {import("../types.js").CustomerAchievementsResponse} CustomerAchievementsResponse */

/**
 * @param {(selector: string) => Element | null} $
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function safeEl($, selector) {
  return /** @type {HTMLElement | null} */ ($(selector));
}

/**
 * @param {Promise<unknown>} promise
 */
function ignore(promise) {
  promise.catch(() => {});
}

/**
 * @template T
 * @param {() => Promise<T>} action
 * @param {(error: Error) => void} [onError]
 * @returns {Promise<T | null>}
 */
async function run(action, onError) {
  try {
    return await action();
  } catch (error) {
    if (onError) onError(error);
    return null;
  }
}

export async function initCustomerPage({ api, $, toast, mountIosInstallHint, modalAlert }) {
  let refreshInFlight = false;
  let refreshTimer = null;

  const { generateQR } = createQrController({ $, toast });

  async function refreshWallet({ silent = true } = {}) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const btn = /** @type {HTMLButtonElement | null} */ (safeEl($, "#btnRefreshWallet"));
    const previousText = btn?.textContent || "Actualizar tarjeta";
    if (btn) {
      btn.disabled = true;
      btn.textContent = silent ? "Actualizando…" : "Actualizando tarjeta…";
    }
    try {
      await loadAll({ api, $, toast, silent });
      if (!silent) toast("Tarjeta actualizada.");
    } finally {
      refreshInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = previousText;
      }
    }
  }

  $("#btnQr")?.addEventListener("click", () => ignore(generateQR()));
  $("#btnRefreshWallet")?.addEventListener("click", () => ignore(refreshWallet({ silent: false })));

  $("#btnLogout")?.addEventListener("click", async () => {
    const cachedSlug = typeof localStorage !== "undefined"
      ? (localStorage.getItem("pf_customer_slug") || "").trim()
      : "";
    await api("/api/public/customer/logout", { method: "POST", body: "{}" }).catch(() => {});
    toast("Sesión cerrada.");
    await clearCustomerCache().catch(() => {});
    setTimeout(() => {
      if (cachedSlug) {
        location.href = `/registro/${encodeURIComponent(cachedSlug)}?motivo=salida`;
        return;
      }
      location.reload();
    }, 600);
  });

  $("#btnCopyCode")?.addEventListener("click", () => {
    const code = /** @type {HTMLInputElement | null} */ ($("#referralCode"))?.value || "";
    if (code && code !== "N/A" && code !== "---") {
      navigator.clipboard.writeText(code).then(() => {
        toast("¡Código copiado! Compártelo con tus amigos.");
      }).catch(() => {
        toast(`No se pudo copiar. Copia manualmente: ${code}`);
      });
    }
  });

  $("#btnViewAllAchievements")?.addEventListener("click", async () => {
    await run(async () => {
      const achData = /** @type {CustomerAchievementsResponse} */ (await api("/api/customer/achievements"));
      const earned = achData.earned || [];
      const inProgress = achData.inProgress || [];

      let message = "🏆 LOGROS OBTENIDOS:\n\n";
      if (earned.length === 0) {
        message += "Ninguno todavía.\n\n";
      } else {
        earned.forEach((a) => {
          message += `${a.icon_url || "🏆"} ${a.name}\n   ${a.description || ""}\n   Obtenido: ${new Date(a.earned_at).toLocaleDateString()}\n\n`;
        });
      }

      message += "\n⏳ EN PROGRESO:\n\n";
      if (inProgress.length === 0) {
        message += "Todos completados!";
      } else {
        inProgress.forEach((a) => {
          message += `${a.icon_url || "⏳"} ${a.name} (${a.progress}%)\n   ${a.description || ""}\n   Progreso: ${a.current}/${a.total}\n\n`;
        });
      }

      await modalAlert(message, { title: "Tus logros", pre: true });
    }, () => {
      toast("No se pudieron cargar los logros");
    });
  });

  window.addEventListener("online", () => { setOnlineBadge($); ignore(refreshWallet({ silent: true })); });
  window.addEventListener("offline", () => setOnlineBadge($));
  window.addEventListener("focus", () => ignore(refreshWallet({ silent: true })));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ignore(refreshWallet({ silent: true }));
  });

  mountIosInstallHint();
  await loadAll({ api, $, toast, silent: true });
  setOnlineBadge($);

  refreshTimer = window.setInterval(() => {
    const main = safeEl($, "#main");
    if (document.visibilityState !== "visible") return;
    if (!navigator.onLine) return;
    if (main?.classList.contains("is-hidden")) return;
    ignore(refreshWallet({ silent: true }));
  }, 15000);

  window.addEventListener("beforeunload", () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
  }, { once: true });

  ignore(registerServiceWorker());
}
