import { clearRewardEntitlements } from "./reward-entitlements.js";
import { clearGrowthOffers } from "./growth-offers.js";
import { clearCustomerCache } from "/idb.js";
import { loadAll } from "./load.js";
import { setOnlineBadge } from "./network.js";
import { createQrController } from "./qr.js";
import { registerServiceWorker } from "/lib.js";
import { clearWalletView, invalidateCustomerIdentity, isCustomerAuthError, readCustomerStorage } from "./session.js";

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
  const entryParams = new URLSearchParams(location.search || "");
  if (entryParams.get("sesion") === "nueva") {
    invalidateCustomerIdentity();
    await clearCustomerCache().catch(() => {});
    entryParams.delete("sesion");
    window.history?.replaceState(null, "", `${location.pathname}${entryParams.size ? `?${entryParams}` : ""}`);
  }
  let refreshInFlight = false;
  let refreshTimer = null;
  let loggingOut = false;
  let refreshPending = false;

  const { generateQR, dispose } = createQrController({ $, toast });

  async function refreshWallet({ silent = true } = {}) {
    if (loggingOut) return;
    if (refreshInFlight) { refreshPending = true; return; }
    refreshInFlight = true;
    const btn = /** @type {HTMLButtonElement | null} */ (safeEl($, "#btnRefreshWallet"));
    const previousText = btn?.textContent || "Actualizar tarjeta";
    if (btn) {
      btn.disabled = true;
      btn.textContent = silent ? "Actualizando…" : "Actualizando tarjeta…";
    }
    try {
      const result = await loadAll({ api, $, toast, silent });
      if (result?.status === "auth" || result?.status === "error") dispose();
    } finally {
      refreshInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = previousText;
      }
      if (refreshPending) { refreshPending = false; ignore(refreshWallet({ silent: true })); }
    }
  }

  $("#btnQr")?.addEventListener("click", () => ignore(generateQR()));
  $("#btnRefreshWallet")?.addEventListener("click", () => ignore(refreshWallet({ silent: false })));

  $("#btnLogout")?.addEventListener("click", async () => {
    if (loggingOut) return;
    loggingOut = true;
    const cachedSlug = readCustomerStorage("pf_customer_slug").trim();
    invalidateCustomerIdentity({ block: true });
    clearWalletView($);
    dispose();
    await clearCustomerCache().catch(() => {});
    try {
      await api("/api/public/customer/logout", { method: "POST", body: "{}" });
    } catch (error) {
      if (!isCustomerAuthError(error)) {
        loggingOut = false;
        const logout = safeEl($, "#btnLogout");
        if (logout) { logout.hidden = false; logout.classList.toggle("is-hidden", false); }
        toast("No se pudo cerrar la sesión del servidor. Conéctate e intenta salir de nuevo.");
        return;
      }
    }
    toast("Sesión cerrada.");
    if (cachedSlug) {
      location.href = `/ingresar/${encodeURIComponent(cachedSlug)}?motivo=salida`;
      return;
    }
    location.reload();
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

  window.addEventListener("online", () => {
    setOnlineBadge($);
    if (readCustomerStorage("pf_customer_blocked") === "1") {
      $("#btnLogout")?.dispatchEvent(new Event("click"));
    } else ignore(refreshWallet({ silent: true }));
  });
  window.addEventListener("offline", () => { setOnlineBadge($); clearGrowthOffers($); clearRewardEntitlements($); });
  window.addEventListener("focus", () => ignore(refreshWallet({ silent: true })));
  window.addEventListener("storage", event => {
    if (event.key !== "pf_customer_epoch" && event.key !== "pf_customer_identity" && event.key !== "pf_customer_blocked" && event.key !== null) return;
    clearWalletView($);
    dispose();
    // Removing identity means logout or verification is still in progress.
    // Revalidate only after a later focus or a completed identity change.
    if (event.key === "pf_customer_identity" && event.newValue) ignore(refreshWallet({ silent: true }));
  });
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
    dispose();
  }, { once: true });

  ignore(registerServiceWorker());
}
