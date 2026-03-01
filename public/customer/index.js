import { loadAll } from "./load.js";
import { setOnlineBadge } from "./network.js";
import { createQrController } from "./qr.js";

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
 * @param {(selector: string) => Element | null} $
 * @returns {string}
 */
function selectedSlug($) {
  return (safeEl($, "#loginSlug")?.value || safeEl($, "#slug")?.value || "").trim();
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

export async function initCustomerPage({ api, $, toast, mountIosInstallHint, modalAlert, modalConfirm }) {
  const cachedPhone = localStorage.getItem("pf_phone") || "";
  const cachedSlug = localStorage.getItem("pf_customer_slug") || "";

  const slugEl = safeEl($, "#slug");
  const loginSlugEl = safeEl($, "#loginSlug");
  const loginPhoneEl = safeEl($, "#loginPhone");

  if (slugEl) slugEl.value = cachedSlug;
  if (loginSlugEl) loginSlugEl.value = cachedSlug;
  if (loginPhoneEl) loginPhoneEl.value = cachedPhone;

  const { generateQR } = createQrController({ $, toast });

  safeEl($, "#btnCopyToken")?.addEventListener("click", async () => {
    const token = safeEl($, "#qrToken")?.value?.trim() || "";
    if (!token) return toast("Genera el QR primero.");
    await run(async () => {
      await navigator.clipboard.writeText(token);
      toast("Token copiado.");
    }, () => {
      safeEl($, "#qrToken")?.focus();
      safeEl($, "#qrToken")?.select?.();
      toast("Copia manualmente el token.");
    });
  });

  safeEl($, "#btnGoJoin")?.addEventListener("click", () => {
    const slug = (safeEl($, "#slug")?.value || "").trim();
    if (!slug) return toast("Escribe el slug");
    localStorage.setItem("pf_customer_slug", slug);
    location.href = `/join/${encodeURIComponent(slug)}`;
  });

  safeEl($, "#btnSendLoginCode")?.addEventListener("click", async () => {
    const slug = selectedSlug($);
    const phone = (safeEl($, "#loginPhone")?.value || "").trim();
    if (!slug) return toast("Escribe el slug");
    if (!phone) return toast("Escribe el teléfono");
    await run(async () => {
      await api(`/api/public/business/${encodeURIComponent(slug)}/join/request-code`, {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      localStorage.setItem("pf_phone", phone);
      localStorage.setItem("pf_customer_slug", slug);
      toast("Codigo enviado.");
    }, (e) => {
      toast(e.message);
    });
  });

  safeEl($, "#btnLoginVerify")?.addEventListener("click", async () => {
    const slug = selectedSlug($);
    const phone = (safeEl($, "#loginPhone")?.value || "").trim();
    const code = (safeEl($, "#loginCode")?.value || "").trim();
    if (!slug) return toast("Escribe el slug");
    if (!phone || !code) return toast("Falta teléfono o código");
    await run(async () => {
      await api(`/api/public/business/${encodeURIComponent(slug)}/join/verify`, {
        method: "POST",
        body: JSON.stringify({ phone, code })
      });
      localStorage.setItem("pf_phone", phone);
      localStorage.setItem("pf_customer_slug", slug);
      toast("Sesion iniciada.");
      await loadAll({ api, $, toast });
    }, (e) => {
      toast(e.message);
    });
  });

  safeEl($, "#btnQr")?.addEventListener("click", () => ignore(generateQR()));

  safeEl($, "#btnLogout")?.addEventListener("click", async () => {
    await api("/api/public/customer/logout", { method: "POST", body: "{}" }).catch(() => {});
    toast("Sesión cerrada.");
    localStorage.removeItem("pf_me");
    setTimeout(() => location.reload(), 600);
  });

  safeEl($, "#btnExport")?.addEventListener("click", async () => {
    await run(async () => {
      const out = await api("/api/customer/export");
      const exportOut = safeEl($, "#exportOut");
      if (exportOut) exportOut.textContent = JSON.stringify(out, null, 2);
      toast("Export listo");
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
      localStorage.removeItem("pf_me");
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

  window.addEventListener("online", () => { setOnlineBadge($); ignore(loadAll({ api, $, toast })); });
  window.addEventListener("offline", () => setOnlineBadge($));

  mountIosInstallHint();
  await loadAll({ api, $, toast });
  setOnlineBadge($);

  if ("serviceWorker" in navigator) ignore(navigator.serviceWorker.register("/sw.js"));
}
