import { clearCustomerCache } from "/idb.js";
import { loadAll } from "./load.js";
import { setOnlineBadge } from "./network.js";
import { createQrController } from "./qr.js";
import { registerServiceWorker } from "/lib.js";
import { applyWalletBranding } from "../customer-branding.js";

/** @typedef {import("../types.js").CustomerAchievementsResponse} CustomerAchievementsResponse */

/**
 * @param {(selector: string) => Element | null} $
 * @param {string} id
 * @returns {HTMLInputElement | HTMLTextAreaElement | null}
 */
function safeEl($, id) {
  return /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ ($(id));
}

/**
 * @param {Promise<unknown>} promise
 */
function ignore(promise) {
  promise.catch(() => {});
}

function setEntryFeedback($, selector, message) {
  const el = safeEl($, selector);
  if (!el) return;
  el.textContent = String(message || "").trim();
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

export async function initCustomerPage({ api, $, toast, mountIosInstallHint, modalAlert, modalConfirm }) {
  const cachedSlug = localStorage.getItem("pf_customer_slug") || "";
  let refreshInFlight = false;
  let refreshTimer = null;

  const slugEl = safeEl($, "#slug");

  if (slugEl) slugEl.value = cachedSlug;

  if (cachedSlug) {
    await run(async () => {
      const business = await api(`/api/public/business/${encodeURIComponent(cachedSlug)}`);
      applyWalletBranding($, business);
    });
  }

  const { generateQR } = createQrController({ $, toast });

  async function refreshWallet({ silent = true } = {}) {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const btn = safeEl($, "#btnRefreshWallet");
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

  safeEl($, "#btnGoJoin")?.addEventListener("click", () => {
    const slug = (safeEl($, "#slug")?.value || "").trim();
    if (!slug) {
      setEntryFeedback($, "#joinFeedback", "Escribe el slug del negocio para abrir su registro.");
      return toast("Escribe el slug");
    }
    setEntryFeedback($, "#joinFeedback", `Abriendo /registro/${slug}...`);
    localStorage.setItem("pf_customer_slug", slug);
    location.href = `/registro/${encodeURIComponent(slug)}`;
  });

  safeEl($, "#btnQr")?.addEventListener("click", () => ignore(generateQR()));
  safeEl($, "#btnRefreshWallet")?.addEventListener("click", () => ignore(refreshWallet({ silent: false })));

  safeEl($, "#btnLogout")?.addEventListener("click", async () => {
    await api("/api/public/customer/logout", { method: "POST", body: "{}" }).catch(() => {});
    toast("Sesión cerrada.");
    await clearCustomerCache().catch(() => {});
    setTimeout(() => location.reload(), 600);
  });

  safeEl($, "#btnExport")?.addEventListener("click", async () => {
    await run(async () => {
      const out = await api("/api/customer/export");
      const exportOut = safeEl($, "#exportOut");
      if (exportOut) exportOut.textContent = JSON.stringify(out, null, 2);
      toast("Exportación lista.");
    }, (e) => {
      toast(e.message);
    });
  });

  safeEl($, "#btnDelete")?.addEventListener("click", async () => {
    const ok = await modalConfirm("¿Eliminar cuenta? Esto desactiva tu tarjeta.", {
      title: "Eliminar cuenta",
      confirmText: "Eliminar"
    });
    if (!ok) return;
    await run(async () => {
      await api("/api/customer/me", { method: "DELETE" });
      await api("/api/public/customer/logout", { method: "POST", body: "{}" }).catch(() => {});
      await clearCustomerCache().catch(() => {});
      toast("Cuenta eliminada.");
      setTimeout(() => location.reload(), 800);
    }, (e) => {
      toast(e.message);
    });
  });

  safeEl($, "#btnCopyCode")?.addEventListener("click", () => {
    const code = safeEl($, "#referralCode")?.value || "";
    if (code && code !== "N/A" && code !== "---") {
      navigator.clipboard.writeText(code).then(() => {
        toast("¡Código copiado! Compártelo con tus amigos.");
      }).catch(() => {
        toast(`No se pudo copiar. Copia manualmente: ${code}`);
      });
    }
  });

  safeEl($, "#btnViewAllAchievements")?.addEventListener("click", async () => {
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
