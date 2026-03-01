import { fmtDT } from "./format.js";
import {
  renderAchievements,
  renderHistory,
  renderOfflineStub,
  renderReferralCode,
  renderReferralStats,
  renderRewards,
  renderTier
} from "./render.js";

/** @typedef {import("../types.js").CustomerAchievementsResponse} CustomerAchievementsResponse */
/** @typedef {import("../types.js").CustomerHistoryResponse} CustomerHistoryResponse */
/** @typedef {import("../types.js").CustomerMeResponse} CustomerMeResponse */
/** @typedef {import("../types.js").CustomerReferralCodeResponse} CustomerReferralCodeResponse */
/** @typedef {import("../types.js").CustomerReferralStats} CustomerReferralStats */
/** @typedef {import("../types.js").CustomerRewardsResponse} CustomerRewardsResponse */
/** @typedef {import("../types.js").CustomerTierResponse} CustomerTierResponse */

/**
 * @param {(selector: string) => Element | null} $
 * @param {string} id
 * @returns {HTMLElement | HTMLInputElement | null}
 */
function safeEl($, id) {
  return /** @type {HTMLElement | HTMLInputElement | null} */ ($(id));
}

/**
 * @template T
 * @param {() => Promise<T>} load
 * @param {(error: Error) => void} [onError]
 * @returns {Promise<T | null>}
 */
async function quietly(load, onError = () => {}) {
  try {
    return await load();
  } catch (error) {
    onError(error);
    return null;
  }
}

/**
 * @param {{ api: (path: string, opts?: RequestInit) => Promise<any>; $: (selector: string) => Element | null; toast: (message: string) => void }} deps
 * @param {CustomerMeResponse} me
 * @param {boolean} isLive
 */
export async function renderFromMe({ api, $, toast }, me, isLive) {
  const needLogin = safeEl($, "#needLogin");
  const main = safeEl($, "#main");
  const logout = safeEl($, "#btnLogout");
  if (needLogin) needLogin.style.display = "none";
  if (main) main.style.display = "block";
  if (logout) logout.style.display = "inline-block";

  const biz = me.business;
  const c = me.customer;
  const bizName = safeEl($, "#bizName");
  const who = safeEl($, "#who");
  const points = safeEl($, "#points");
  const pendingPoints = safeEl($, "#pendingPoints");
  const lifetime = safeEl($, "#lifetime");
  const lastVisit = safeEl($, "#lastVisit");

  if (bizName) bizName.textContent = biz?.name ? `Tarjeta • ${biz.name}` : "Mi tarjeta";
  if (who) who.textContent = `${c?.name || "Cliente"} • ${c?.phone || ""} • ID: ${c?.id || ""}`;
  if (points) points.textContent = String(c?.points ?? 0);
  if (pendingPoints) pendingPoints.textContent = String(c?.pending_points ?? 0);
  if (lifetime) lifetime.textContent = String(c?.lifetime_points ?? 0);
  if (lastVisit) lastVisit.textContent = c?.last_visit_at ? fmtDT(c.last_visit_at) : "—";

  document.title = biz?.name ? `Mi tarjeta • ${biz.name}` : "Mi tarjeta • PuntosFieles";

  if (isLive) {
    await quietly(async () => {
      const rewards = /** @type {CustomerRewardsResponse} */ (await api("/api/customer/rewards"));
      renderRewards($, Number(c?.points ?? 0), rewards.rewards);
    });

    await quietly(async () => {
      const h = /** @type {CustomerHistoryResponse} */ (await api("/api/customer/history"));
      renderHistory($, h.transactions, h.redemptions);
    });

    await quietly(async () => {
      const tierData = /** @type {CustomerTierResponse} */ (await api("/api/customer/tier"));
      renderTier($, tierData.tier);
    }, () => {
      const tierSection = safeEl($, "#tierSection");
      if (tierSection) tierSection.style.display = "none";
    });

    await quietly(async () => {
      const achData = /** @type {CustomerAchievementsResponse} */ (await api("/api/customer/achievements"));
      renderAchievements($, achData);
    });

    await quietly(async () => {
      const refData = /** @type {CustomerReferralCodeResponse} */ (await api("/api/customer/referral-code"));
      renderReferralCode($, refData.referral_code);
    });

    await quietly(async () => {
      const refStats = /** @type {CustomerReferralStats} */ (await api("/api/customer/referrals"));
      renderReferralStats($, refStats);
    });
  } else {
    renderOfflineStub($);
    toast("Modo sin conexión: mostrando datos guardados.");
  }
}
