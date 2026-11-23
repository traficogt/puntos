import { putCustomerCache } from "/idb.js";
import { setHidden } from "/lib.js";
import { applyWalletBranding } from "../customer-branding.js";
import { fmtDT } from "./format.js";
import { isCustomerAuthError } from "./session.js";
import { renderNativeWallet } from "./native-wallet.js";
import { renderStatement } from "./statement.js";
import {
  renderAchievements,
  renderHistory,
  renderOfflineStub,
  renderReferralCode,
  renderReferralStats,
  renderRewards,
  renderTier,
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

function applyCustomerFeatureVisibility($, business) {
  const features = business?.features || {};
  const referralsSection = safeEl($, "#referralsSection");
  const achievementsSection = safeEl($, "#achievementsSection");
  setHidden(referralsSection, !features.referrals);
  setHidden(achievementsSection, !features.gamification);
}

function renderOfflineSections($, snapshot) {
  const sections = snapshot?.sections || {};
  const me = sections.me?.customer || {};
  const hasHistory = Boolean(sections.history);
  const hasRewards = Boolean(sections.rewards?.rewards);

  renderOfflineStub($);
  renderStatement($, sections.statement?.statement, {
    isLive: false,
    region: sections.me?.business?.region,
  });

  if (hasRewards) {
    renderRewards($, Number(me?.points ?? 0), sections.rewards.rewards, {
      progress: sections.rewards.progress,
      isLive: false,
      region: sections.me?.business?.region,
    });
  }
  if (hasHistory) {
    renderHistory(
      $,
      sections.history.transactions,
      sections.history.redemptions,
      sections.me?.business?.region,
    );
  }
  if (sections.me?.business?.features?.tiers && sections.tier) {
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
 * @param {{ api: (path: string, opts?: RequestInit) => Promise<any>; $: (selector: string) => Element | null; toast: (message: string) => void; isCurrent?: () => boolean; identity?: {businessId: string, customerId: string} | null }} deps
 * @param {CustomerMeResponse} me
 * @param {boolean} isLive
 * @param {{ sections?: Record<string, any>, latestUpdatedAt?: string } | null} [snapshot]
 */
export async function renderFromMe(
  { api, $, toast, isCurrent = () => true, identity = null },
  me,
  isLive,
  snapshot = null,
) {
  // Callers validate both ids before rendering; the fallback only shapes the identity object.
  identity ||= { businessId: me.business?.id ?? "", customerId: me.customer?.id ?? "" };
  const cacheScope = identity;
  if (!isCurrent()) return { status: "superseded" };
  const statementEl = safeEl($, "#customerStatement");
  statementEl?.replaceChildren();
  if (isLive && statementEl) statementEl.textContent = "Cargando tu resumen…";
  for (const selector of [
    "#rewards",
    "#nextReward",
    "#nextRewardBalance",
    "#nextRewardConditions",
    "#nextRewardEarning",
    "#achievements",
    "#referralStats",
    "#tierPerks",
    "#tx",
    "#red",
  ])
    safeEl($, selector)?.replaceChildren();
  renderReferralCode($, null);
  const needLogin = safeEl($, "#needLogin");
  const main = safeEl($, "#main");
  const logout = safeEl($, "#btnLogout");
  setHidden(needLogin, true);
  setHidden(main, false);
  setHidden(logout, false);

  const biz = me.business;
  const c = me.customer;
  const branding = applyWalletBranding($, biz || {});
  applyCustomerFeatureVisibility($, biz || {});
  const bizName = safeEl($, "#bizName");
  const who = safeEl($, "#who");
  const points = safeEl($, "#points");
  const pendingPoints = safeEl($, "#pendingPoints");
  const lifetime = safeEl($, "#lifetime");
  const lastVisit = safeEl($, "#lastVisit");

  if (bizName) bizName.textContent = branding.walletHeadline;
  if (who) who.textContent = `${c?.name || "Cliente"} • ${c?.phone || ""} • ID: ${c?.id || ""}`;
  if (points) points.textContent = String(c?.points ?? 0);
  if (pendingPoints) pendingPoints.textContent = String(c?.pending_points ?? 0);
  if (lifetime) lifetime.textContent = String(c?.lifetime_points ?? 0);
  if (lastVisit)
    lastVisit.textContent = c?.last_visit_at ? fmtDT(c.last_visit_at, me.business?.region) : "—";

  const memberBenefit = safeEl($, "#memberBenefit");
  if (memberBenefit) {
    const discount = biz?.member_discount;
    if (discount && Number(discount.percent_off) > 0) {
      memberBenefit.textContent = `Beneficio de miembro: ${Number(discount.percent_off)}% de descuento en cada compra.`;
      setHidden(memberBenefit, false);
    } else {
      setHidden(memberBenefit, true);
    }
  }

  const stampWrap = safeEl($, "#stampCard");
  if (stampWrap) {
    const sc = me.stamp_card;
    if (sc && Number(sc.stamps_required) > 0) {
      const req = Number(sc.stamps_required),
        hs = Math.max(0, Number(sc.head_start) || 0),
        filled = Math.max(0, Number(sc.filled) || 0);
      const grid = document.createElement("div");
      grid.className = "lc-stamp-grid";
      grid.setAttribute("aria-hidden", "true");
      for (let i = 0; i < req; i += 1) {
        const dot = document.createElement("span");
        dot.className = "lc-stamp" + (i < filled ? " is-filled" : "") + (i < hs ? " is-gift" : "");
        grid.appendChild(dot);
      }
      const caption = document.createElement("p");
      caption.className = "lc-stamp-caption";
      caption.textContent = sc.complete
        ? `¡Tarjeta completa! Canjea: ${sc.reward_label}.`
        : `${filled}/${req} sellos · faltan ${sc.remaining} para ${sc.reward_label}${hs > 0 ? ` · ${hs} de regalo` : ""}`;
      stampWrap.replaceChildren(grid, caption);
      setHidden(stampWrap, false);
    } else {
      setHidden(stampWrap, true);
    }
  }

  const walletEl = safeEl($, "#cashbackBenefit");
  const wallet = me.wallet;
  if (walletEl) {
    if (wallet && wallet.kind === "CASHBACK" && Number(wallet.percent) > 0) {
      const bal = Number(wallet.balance_q) || 0;
      walletEl.textContent = `Saldo de cashback: Q${bal.toFixed(2)} · ganas ${Number(wallet.percent)}% en cada compra.`;
      setHidden(walletEl, false);
    } else if (wallet && wallet.kind === "GIFT_CARD") {
      const bal = Number(wallet.balance_q) || 0;
      walletEl.textContent = `Saldo de tu tarjeta: Q${bal.toFixed(2)}.`;
      setHidden(walletEl, false);
    } else {
      setHidden(walletEl, true);
    }
  }
  const giftWrap = safeEl($, "#giftCardTransfer");
  if (giftWrap) {
    setHidden(
      giftWrap,
      !(wallet && wallet.kind === "GIFT_CARD" && (Number(wallet.balance_q) || 0) > 0),
    );
  }

  const qrWrap = /** @type {HTMLElement | null} */ (safeEl($, "#qrWrap"));
  if (qrWrap) {
    const owner = `${identity.businessId}:${identity.customerId}`;
    if (qrWrap.dataset.owner && qrWrap.dataset.owner !== owner) {
      qrWrap.replaceChildren();
      for (const selector of ["#qrExp", "#qrHint"]) safeEl($, selector)?.replaceChildren();
    }
    qrWrap.dataset.owner = owner;
    qrWrap.dataset.plan = String(biz?.plan || "");
    qrWrap.dataset.logoUrl = String(biz?.customer_branding?.customer_logo_url || "");
    qrWrap.dataset.qrLogoEnabled = String(biz?.customer_branding?.qr_logo_enabled === true);
  }

  document.title = `Mi tarjeta • ${branding.programName}`;
  await renderNativeWallet({ api, $, identity, isCurrent }, isLive);
  if (!isCurrent()) return { status: "superseded" };

  if (isLive) {
    let partial = false;
    async function loadSection(key, path, render, unavailable) {
      if (!isCurrent()) return;
      try {
        const data = await api(path);
        if (!isCurrent()) return;
        await Promise.resolve(putCustomerCache(key, data, cacheScope)).catch(() => {});
        if (isCurrent()) render(data, true);
      } catch (error) {
        if (!isCurrent()) return;
        if (isCustomerAuthError(error)) throw error;
        partial = true;
        const cached = snapshot?.sections?.[key];
        if (cached) render(cached, false);
        else unavailable?.();
      }
    }
    await loadSection(
      "rewards",
      "/api/customer/rewards",
      (data, fresh) => {
        if (fresh && data.progress) {
          if (points) points.textContent = String(data.progress.available_points);
          if (pendingPoints) pendingPoints.textContent = String(data.progress.pending_points);
        }
        renderRewards($, Number(c?.points ?? 0), data.rewards, {
          progress: data.progress,
          isLive: fresh,
          isCurrent,
          region: biz?.region,
        });
      },
      () => {
        const rewards = safeEl($, "#rewards");
        if (rewards)
          rewards.textContent =
            "No se pudieron cargar las recompensas. Intenta actualizar de nuevo.";
        const next = safeEl($, "#nextReward");
        if (next) next.textContent = "Recompensas pendientes de actualizar";
      },
    );
    await loadSection(
      "history",
      "/api/customer/history",
      (data) => renderHistory($, data.transactions, data.redemptions, me?.business?.region),
      () => {
        for (const selector of ["#tx", "#red"]) {
          const element = safeEl($, selector);
          if (element)
            element.textContent = "No se pudo cargar la actividad. Intenta actualizar de nuevo.";
        }
      },
    );
    await loadSection(
      "statement",
      "/api/customer/statement",
      (data, fresh) => renderStatement($, data.statement, { isLive: fresh, region: biz?.region }),
      () => renderStatement($, null, { isLive: true }),
    );
    if (biz?.features?.tiers) {
      await loadSection(
        "tier",
        "/api/customer/tier",
        (data) => renderTier($, data.tier),
        () => setHidden(safeEl($, "#tierSection"), true),
      );
    } else setHidden(safeEl($, "#tierSection"), true);
    if (biz?.features?.gamification) {
      await loadSection("achievements", "/api/customer/achievements", (data) =>
        renderAchievements($, data),
      );
    }
    if (biz?.features?.referrals) {
      await loadSection("referralCode", "/api/customer/referral-code", (data) =>
        renderReferralCode($, data.referral_code),
      );
      await loadSection("referralStats", "/api/customer/referrals", (data) =>
        renderReferralStats($, data),
      );
    }
    if (!isCurrent()) return { status: "superseded" };
    updateSyncBadge($, !partial, partial ? snapshot?.latestUpdatedAt : new Date().toISOString());
    if (partial) {
      const badge = safeEl($, "#syncBadge");
      if (badge) badge.textContent = "Actualización incompleta";
    }
    return { status: partial ? "partial" : "live" };
  }
  renderOfflineSections($, snapshot);
  toast("Modo sin conexión: mostrando datos guardados.");
  updateSyncBadge($, false, snapshot?.latestUpdatedAt || "");
  return { status: "offline" };
}
