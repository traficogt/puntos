import { clearRewardEntitlements } from "./reward-entitlements.js";
import { clearGrowthOffers } from "./growth-offers.js";
import { clearCustomerCache } from "/idb.js";
import { loadAll } from "./load.js";
import { setOnlineBadge } from "./network.js";
import { createQrController } from "./qr.js";
import { registerServiceWorker } from "/lib.js";
import {
  clearWalletView,
  invalidateCustomerIdentity,
  isCustomerAuthError,
  readCustomerStorage,
} from "./session.js";
import { createSessionEpoch } from "../session-epoch.js";
import { createWalletNavigation, walletDestination } from "./wallet-navigation.js";

/** @typedef {import("../types.js").CustomerAchievementsResponse} CustomerAchievementsResponse */

const session = createSessionEpoch("customer");

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
    if (onError) onError(error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

export async function initCustomerPage({ api, $, toast, mountIosInstallHint, modalAlert }) {
  const entryParams = new URLSearchParams(location.search || "");
  if (entryParams.get("sesion") === "nueva") {
    invalidateCustomerIdentity();
    await clearCustomerCache().catch(() => {});
    entryParams.delete("sesion");
    const destination = walletDestination((location.hash || "").slice(1));
    window.history?.replaceState(
      null,
      "",
      `${location.pathname}${entryParams.size ? `?${entryParams}` : ""}${destination ? `#${destination}` : ""}`,
    );
  }
  let refreshInFlight = false;
  let refreshTimer = null;
  let loggingOut = false;
  let refreshPending = false;

  const { generateQR, dispose } = createQrController({ $, toast });
  const destinationNavigation = createWalletNavigation({ $ });

  async function refreshWallet({ silent = true } = {}) {
    if (loggingOut) return;
    if (refreshInFlight) {
      refreshPending = true;
      return;
    }
    refreshInFlight = true;
    destinationNavigation.pause();
    const btn = /** @type {HTMLButtonElement | null} */ (safeEl($, "#btnRefreshWallet"));
    const previousText = btn?.textContent || "Actualizar tarjeta";
    if (btn) {
      btn.disabled = true;
      btn.textContent = silent ? "Actualizando…" : "Actualizando tarjeta…";
    }
    try {
      const result = await loadAll({ api, $, toast, silent });
      destinationNavigation.afterLoad(result);
      if (result?.status === "auth" || result?.status === "error") dispose();
    } finally {
      refreshInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = previousText;
      }
      if (refreshPending) {
        refreshPending = false;
        ignore(refreshWallet({ silent: true }));
      }
    }
  }

  $("#btnQr")?.addEventListener("click", () => ignore(generateQR()));
  $("#btnRefreshWallet")?.addEventListener("click", () => ignore(refreshWallet({ silent: false })));

  $("#btnLogout")?.addEventListener("click", async () => {
    if (loggingOut) return;
    loggingOut = true;
    destinationNavigation.pause();
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
        if (logout) {
          logout.hidden = false;
          logout.classList.toggle("is-hidden", false);
        }
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

  $("#btnGiftTransfer")?.addEventListener("click", async () => {
    const phoneEl = /** @type {HTMLInputElement | null} */ (safeEl($, "#giftTransferPhone"));
    const amtEl = /** @type {HTMLInputElement | null} */ (safeEl($, "#giftTransferAmount"));
    const statusEl = safeEl($, "#giftTransferStatus");
    const btn = /** @type {HTMLButtonElement | null} */ (safeEl($, "#btnGiftTransfer"));
    const recipient_phone = phoneEl ? String(phoneEl.value || "").trim() : "";
    const amount_q = amtEl ? Number(amtEl.value || 0) : 0;
    if (!recipient_phone) {
      if (statusEl) statusEl.textContent = "Ingresa el teléfono de quien recibe.";
      return;
    }
    if (!(amount_q > 0)) {
      if (statusEl) statusEl.textContent = "Ingresa un monto a regalar.";
      return;
    }
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = "Enviando…";
    try {
      const out = await api("/api/customer/giftcard/transfer", {
        method: "POST",
        body: JSON.stringify({ recipient_phone, amount_q, requestId: crypto.randomUUID() }),
      });
      if (statusEl)
        statusEl.textContent = `Regalaste Q${Number(out.transferred_q).toFixed(2)}. Tu nuevo saldo: Q${Number(out.balance_after_q).toFixed(2)}.`;
      if (amtEl) amtEl.value = "0";
      if (phoneEl) phoneEl.value = "";
      await loadAll({ api, $, toast, silent: true });
    } catch (error) {
      if (statusEl)
        statusEl.textContent =
          error instanceof Error && error.message ? error.message : "No se pudo regalar el saldo.";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#btnCopyCode")?.addEventListener("click", () => {
    const code = /** @type {HTMLInputElement | null} */ ($("#referralCode"))?.value || "";
    if (code && code !== "N/A" && code !== "---") {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          toast("¡Código copiado! Compártelo con tus amigos.");
        })
        .catch(() => {
          toast(`No se pudo copiar. Copia manualmente: ${code}`);
        });
    }
  });

  $("#btnViewAllAchievements")?.addEventListener("click", async () => {
    await run(
      async () => {
        const achData = /** @type {CustomerAchievementsResponse} */ (
          await api("/api/customer/achievements")
        );
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
      },
      () => {
        toast("No se pudieron cargar los logros");
      },
    );
  });

  window.addEventListener("online", () => {
    setOnlineBadge($);
    if (readCustomerStorage("pf_customer_blocked") === "1") {
      $("#btnLogout")?.dispatchEvent(new Event("click"));
    } else ignore(refreshWallet({ silent: true }));
  });
  window.addEventListener("offline", () => {
    destinationNavigation.pause();
    setOnlineBadge($);
    clearGrowthOffers($);
    clearRewardEntitlements($);
  });
  window.addEventListener("focus", () => ignore(refreshWallet({ silent: true })));
  window.addEventListener("hashchange", () => destinationNavigation.navigate());
  window.addEventListener("storage", (event) => {
    if (!session.changedBy(event)) return;
    destinationNavigation.pause();
    clearWalletView($);
    dispose();
    // Removing identity means logout or verification is still in progress.
    // Revalidate only after a later focus or a completed identity change.
    if (event.key === session.keys.linked.identity && event.newValue)
      ignore(refreshWallet({ silent: true }));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ignore(refreshWallet({ silent: true }));
  });

  mountIosInstallHint();
  destinationNavigation.afterLoad(await loadAll({ api, $, toast, silent: true }));
  setOnlineBadge($);

  refreshTimer = window.setInterval(() => {
    const main = safeEl($, "#main");
    if (document.visibilityState !== "visible") return;
    if (!navigator.onLine) return;
    if (main?.classList.contains("is-hidden")) return;
    ignore(refreshWallet({ silent: true }));
  }, 15000);

  window.addEventListener(
    "beforeunload",
    () => {
      destinationNavigation.pause();
      if (refreshTimer) window.clearInterval(refreshTimer);
      dispose();
    },
    { once: true },
  );

  ignore(registerServiceWorker());
}
