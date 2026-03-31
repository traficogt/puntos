import { putCustomerCache } from "/idb.js";
import { setHidden } from "/lib.js";
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

function updateSyncBadge($, isLive, updatedAt) {
  const badge = safeEl($, "#syncBadge");
  if (!badge) return;

  const stamp = updatedAt ? fmtDT(updatedAt) : "—";
  if (isLive) {
    badge.textContent = `Actualizado: ${stamp}`;
    badge.classList.add("status-online");
    badge.classList.remove("status-offline");
    return;
  }

  badge.textContent = updatedAt ? `Guardado: ${stamp}` : "Sin datos guardados";
  badge.classList.add("status-offline");
  badge.classList.remove("status-online");
}

function renderOfflineSections($, snapshot) {
  const sections = snapshot?.sections || {};
  const me = sections.me?.customer || {};
  const hasHistory = Boolean(sections.history);
  const hasRewards = Boolean(sections.rewards?.rewards);

  if (!hasHistory && !hasRewards) {
    renderOfflineStub($);
  }

  if (hasRewards) {
    renderRewards($, Number(me?.points ?? 0), sections.rewards.rewards);
  }
  if (hasHistory) {
    renderHistory($, sections.history.transactions, sections.history.redemptions);
  }
  if (sections.tier) {
    renderTier($, sections.tier.tier);
  } else {
    const tierSection = safeEl($, "#tierSection");
    setHidden(tierSection, true);
  }
  if (sections.achievements) {
    renderAchievements($, sections.achievements);
  }
  if (sections.referralCode) {
    renderReferralCode($, sections.referralCode.referral_code);
  }
  if (sections.referralStats) {
    renderReferralStats($, sections.referralStats);
  }
}

/**
 * @param {{ api: (path: string, opts?: RequestInit) => Promise<any>; $: (selector: string) => Element | null; toast: (message: string) => void }} deps
 * @param {CustomerMeResponse} me
 * @param {boolean} isLive
 * @param {{ sections?: Record<string, any>, latestUpdatedAt?: string } | null} [snapshot]
 */
export async function renderFromMe({ api, $, toast }, me, isLive, snapshot = null) {
  const needLogin = safeEl($, "#needLogin");
  const main = safeEl($, "#main");
  const logout = safeEl($, "#btnLogout");
  setHidden(needLogin, true);
  setHidden(main, false);
  setHidden(logout, false);

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
      await putCustomerCache("rewards", rewards);
      renderRewards($, Number(c?.points ?? 0), rewards.rewards);
    }, () => {
      if (snapshot?.sections?.rewards) renderRewards($, Number(c?.points ?? 0), snapshot.sections.rewards.rewards);
    });

    await quietly(async () => {
      const h = /** @type {CustomerHistoryResponse} */ (await api("/api/customer/history"));
      await putCustomerCache("history", h);
      renderHistory($, h.transactions, h.redemptions);
    }, () => {
      if (snapshot?.sections?.history) renderHistory($, snapshot.sections.history.transactions, snapshot.sections.history.redemptions);
    });

    await quietly(async () => {
      const tierData = /** @type {CustomerTierResponse} */ (await api("/api/customer/tier"));
      await putCustomerCache("tier", tierData);
      renderTier($, tierData.tier);
    }, () => {
      if (snapshot?.sections?.tier) {
        renderTier($, snapshot.sections.tier.tier);
      } else {
        const tierSection = safeEl($, "#tierSection");
        setHidden(tierSection, true);
      }
    });

    await quietly(async () => {
      const achData = /** @type {CustomerAchievementsResponse} */ (await api("/api/customer/achievements"));
      await putCustomerCache("achievements", achData);
      renderAchievements($, achData);
    }, () => {
      if (snapshot?.sections?.achievements) renderAchievements($, snapshot.sections.achievements);
    });

    await quietly(async () => {
      const refData = /** @type {CustomerReferralCodeResponse} */ (await api("/api/customer/referral-code"));
      await putCustomerCache("referralCode", refData);
      renderReferralCode($, refData.referral_code);
    }, () => {
      if (snapshot?.sections?.referralCode) renderReferralCode($, snapshot.sections.referralCode.referral_code);
    });

    await quietly(async () => {
      const refStats = /** @type {CustomerReferralStats} */ (await api("/api/customer/referrals"));
      await putCustomerCache("referralStats", refStats);
      renderReferralStats($, refStats);
    }, () => {
      if (snapshot?.sections?.referralStats) renderReferralStats($, snapshot.sections.referralStats);
    });
    updateSyncBadge($, true, new Date().toISOString());
  } else {
    renderOfflineSections($, snapshot);
    toast("Modo sin conexión: mostrando datos guardados.");
    updateSyncBadge($, false, snapshot?.latestUpdatedAt || "");
  }
}
