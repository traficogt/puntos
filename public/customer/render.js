import { setHidden } from "/lib.js";
import { rewardsWithState, nextInventoryRefresh, getRewardViewModel, rewardProgressText } from "./rewards.js";
import { formatNumber, formatPoints, missingPointsText, walletRegion } from "./format.js";

/** @typedef {import("../types.js").CustomerAchievementsResponse} CustomerAchievementsResponse */
/** @typedef {import("../types.js").CustomerReferralCodeData} CustomerReferralCodeData */
/** @typedef {import("../types.js").CustomerReferralStats} CustomerReferralStats */
/** @typedef {import("../types.js").CustomerRedemption} CustomerRedemption */
/** @typedef {import("../types.js").CustomerReward} CustomerReward */
/** @typedef {import("../types.js").CustomerTier} CustomerTier */
/** @typedef {import("../types.js").CustomerTransaction} CustomerTransaction */

/**
 * @param {(selector: string) => Element | null} $
 * @param {string} id
 * @returns {HTMLElement | HTMLInputElement | null}
 */
function safeEl($, id) {
  return /** @type {HTMLElement | HTMLInputElement | null} */ ($(id));
}

/** @type {WeakMap<HTMLElement,number>} */
const rewardFreshnessTimers=new WeakMap();

/**
 * @param {(selector: string) => Element | null} $
 * @param {number} points
 * @param {CustomerReward[] | undefined} rewards
 * @param {{progress?: import("../types.js").CustomerRewardProgress, isLive?: boolean, isCurrent?: () => boolean, region?: {locale?: string, timezone?: string}}} [options]
 */
export function renderRewards($, points, rewards, options = {}) {
  const box = safeEl($, "#rewards");
  if (!box || options.isCurrent?.() === false) return;
  const previousTimer = rewardFreshnessTimers.get(box);
  if (previousTimer) window.clearTimeout(previousTimer);
  rewardFreshnessTimers.delete(box);
  box.replaceChildren();

  const { progress, isLive = true, region } = options;
  const now = Date.now();
  const deadline = Date.parse(progress?.next_refresh_at ?? "");
  const stale = !isLive || Number.isFinite(deadline) && deadline <= now;
  const savedMessage = !isLive ? "Datos guardados. Actualiza la tarjeta para consultar tu recompensa." : "Actualiza la tarjeta para confirmar la disponibilidad de tu recompensa.";
  rewards = progress?.choices ?? rewards;
  points = progress ? progress.available_points : points;
  const { sorted, eligible, next, remain } = rewardsWithState(points, rewards, now, region);
  const target = progress ? progress.reward : next ? { ...next, remaining_points: remain } : null;
  const targetChoice = target && sorted.find(entry => entry.reward.id === target.id);
  const selected = !stale && target && getRewardViewModel(points, target, now, region).available &&
    (!targetChoice || targetChoice.available) ? target : null;
  const date = value => new Intl.DateTimeFormat(region?.locale || "es-GT", { dateStyle: "medium", timeStyle: "short", timeZone: region?.timezone || "America/Guatemala" }).format(new Date(value));
  const text = (id, value) => { const element = safeEl($, id); if (element) element.textContent = value; };
  text("#nextReward", stale ? savedMessage : selected ? rewardProgressText(points, selected, region)
    : "No hay una recompensa disponible ahora. Consulta las opciones en caja.");
  text("#nextRewardBalance", selected ? `${formatPoints(points, region)} ${points === 1 ? "disponible" : "disponibles"} · ${formatPoints(selected.points_cost, region)} de costo` : "");
  text("#nextRewardConditions", selected ? (progress?.conditions || "Sujeto a disponibilidad al canjear.").replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, date) + " En caja se confirman las condiciones del canje." : "");
  text("#nextRewardEarning", !stale ? progress?.earning ?? "" : "");

  if (!rewards?.length) {
    const card = document.createElement("div");
    card.className = "card";
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = "No hay recompensas activas.";
    card.appendChild(p);
    box.appendChild(card);
  } else {
    const callout = document.createElement("div");
    callout.className = "card cus-rewards-callout";
    const title = document.createElement("h2");
    title.textContent = stale ? "Actualiza la disponibilidad" : eligible.length > 0
      ? `Tus puntos alcanzan para ${formatNumber(eligible.length, region)} ${eligible.length === 1 ? "opción" : "opciones"}`
      : selected ? `Tu próxima opción: ${selected.name}` : "Consulta la disponibilidad en caja";
    const description = document.createElement("p");
    description.className = "small";
    description.textContent = stale ? savedMessage : "Muestra tu QR en caja. Allí se confirman la disponibilidad y las condiciones antes de canjear; no se reserva una recompensa.";
    callout.append(title, description);
    box.appendChild(callout);

    for (const entry of sorted) {
      const r = entry.reward;
      const { canRedeem, remainingPoints, available, statusLabel, inventoryNote } = entry;
      const can = !stale && canRedeem;
      const div = document.createElement("div");
      div.className = "card cus-reward-card";
      if (can) div.classList.add("cus-reward-ready");
      const heading = document.createElement("h2");
      heading.textContent = r.name;
      const desc = document.createElement("p");
      desc.textContent = r.description || "";
      const row = document.createElement("div");
      row.className = "row";
      const cost = document.createElement("span");
      cost.className = "badge";
      cost.textContent = `Costo: ${formatPoints(r.points_cost, region)}`;
      const state = document.createElement("span");
      state.className = "badge";
      state.textContent = stale ? "Disponibilidad pendiente de actualizar" : !available ? statusLabel : can ? "Tienes los puntos necesarios" : missingPointsText(remainingPoints, region);
      row.append(cost, state);
      const hint = document.createElement("p");
      hint.className = "small cus-reward-note";
      hint.textContent = [r.protected ? "Condiciones originales protegidas." : "", r.branch_labels?.length ? `Canje en: ${r.branch_labels.join(", ")}.` : r.branch_ids?.length ? "Válido en las sucursales del beneficio original. Confirma en caja." : "Canje en las sucursales del negocio.", r.valid_until ? `Vigencia: ${date(r.valid_until)}.` : ""].filter(Boolean).join(" ");
      div.append(heading, desc, row, hint);
      if (inventoryNote) {
        const evidence = document.createElement("p");
        evidence.className = "small cus-reward-note";
        evidence.textContent = inventoryNote;
        div.appendChild(evidence);
      }
      box.appendChild(div);
    }
  }
  const inventoryRefresh = nextInventoryRefresh(rewards, now);
  const deadlines = [inventoryRefresh, deadline].filter(at => Number.isFinite(at) && at > now);
  const refreshAt = deadlines.length ? Math.min(...deadlines) : null;
  if (refreshAt) {
    const marker = box.firstChild;
    rewardFreshnessTimers.set(box, window.setTimeout(() => {
      // A cleared or replaced account must never be restored by an old deadline.
      if (box.isConnected && box.firstChild === marker && options.isCurrent?.() !== false) renderRewards($, points, rewards, options);
    }, Math.min(2147483647, Math.max(1, refreshAt - Date.now()))));
  }
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerTransaction[] | undefined} transactions
 * @param {CustomerRedemption[] | undefined} redemptions
 */
export function renderHistory($, transactions, redemptions, region = undefined) {
  const whenInRegion = value => new Intl.DateTimeFormat(region?.locale || "es-GT", { dateStyle: "short", timeStyle: "short", timeZone: region?.timezone || "America/Guatemala" }).format(new Date(value));
  const moneyInRegion = value => new Intl.NumberFormat(region?.locale || "es-GT", { style: "currency", currency: region?.currency || "GTQ" }).format(Number(value));
  const txText = (transactions || []).slice(0, 12).map((t) => {
    const when = whenInRegion(t.created_at);
    const delta = Number(t.points_delta);
    const pts = `${delta >= 0 ? "+" : "-"}${formatPoints(Math.abs(delta), region)}`;
    const kinds = new Map([
      ['purchase', 'Compra'], ['referral_bonus', 'Bono por referido'], ['achievement_bonus', 'Bono por logro'],
      ['challenge_bonus', 'Bono por reto'], ['birthday_bonus', 'Bono de cumpleaños'], ['other_bonus', 'Bonificación'],
      ['redemption', 'Canje'], ['expiry', 'Vencimiento de puntos'], ['adjustment', 'Corrección de puntos'],
      ['reversal', 'Reversión de puntos'], ['opening_balance', 'Saldo inicial importado']
    ]);
    const statuses = new Map([
      ['POSTED', 'Registrado'], ['PENDING', 'Pendiente de confirmar; no disponible'],
      ['REVERSED', 'Revertido; no disponible'], ['EXPIRED', 'Vencido; no disponible']
    ]);
    const kind = t.provenance?.kind;
    const label = kinds.get(kind) || 'Origen no documentado';
    const bonus = kind === 'purchase' && t.provenance?.includes_bonus === true ? ' · Incluye bonificación' : '';
    const status = statuses.get(t.provenance?.status) || 'Estado no documentado';
    const amt = kind === 'purchase' && t.amount_q != null && Number(t.amount_q) > 0 ? ` · Compra: ${moneyInRegion(t.amount_q)}` : "";
    return `${label}${bonus} · ${status}\n${when} · ${pts}${amt}`;
  }).join("\n\n") || "(sin registros)";

  const rdText = (redemptions || []).slice(0, 12).map((r) => {
    const when = whenInRegion(r.created_at);
    const status = new Map([['REDEEMED', 'Completado'], ['PENDING', 'Pendiente'], ['CANCELLED', 'Cancelado'], ['CANCELED', 'Cancelado'], ['REVERSED', 'Revertido'], ['EXPIRED', 'Vencido']]).get(r.status)
      || (r.status ? 'Estado no documentado' : r.redeemed_at ? 'Completado' : 'Pendiente');
    return `${r.reward_name || 'Recompensa'} · ${status}\n${when} · Costo registrado: ${formatPoints(Number(r.points_cost), region)} · Código: ${r.code}`;
  }).join("\n\n") || "(sin canjes)";

  const txEl = safeEl($, "#tx");
  const rdEl = safeEl($, "#red");
  if (txEl) txEl.textContent = txText;
  if (rdEl) rdEl.textContent = rdText;
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerTier | null | undefined} tier
 * @param {{locale?: string} | undefined} [region] Defaults to the region of the rendered card.
 */
export function renderTier($, tier, region = walletRegion($)) {
  const section = safeEl($, "#tierSection");
  if (!section) return;
  if (!tier) {
    setHidden(section, true);
    return;
  }
  setHidden(section, false);

  const icons = {
    1: "🥉", // Bronze
    2: "🥈", // Silver
    3: "🥇", // Gold
    4: "💎" // Platinum
  };

  const iconEl = safeEl($, "#tierIcon");
  const nameEl = safeEl($, "#tierName");
  const multEl = safeEl($, "#tierMultiplier");
  const progEl = safeEl($, "#tierProgress");
  const barEl = /** @type {HTMLProgressElement | null} */ (safeEl($, "#tierProgressBar"));

  if (iconEl) iconEl.textContent = icons[tier.tier_level] || "⭐";
  if (nameEl) nameEl.textContent = tier.name || "Bronce";
  // Tiers do not multiply earned points (the award engine never applies
  // points_multiplier), so the badge states the tier basis instead.
  if (multEl) multEl.textContent = "Por puntos ganados";

  // Only the server's missing next tier means the top tier. A balance that
  // already meets the next tier waits for the tier change without negative copy.
  const nextName = typeof tier.next_tier_name === "string" && tier.next_tier_name.trim() ? tier.next_tier_name : null;
  const remaining = tier.points_to_next_tier == null ? NaN : Number(tier.points_to_next_tier);
  const current = Number(tier.current_points), target = Number(tier.next_tier_points);
  let progress = 100;
  let label = "¡Nivel máximo alcanzado! 🎉";
  if (nextName && Number.isFinite(remaining) && remaining > 0) {
    label = `${formatPoints(remaining, region)} más para ${nextName}`;
    progress = target > 0 && Number.isFinite(current) ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;
  } else if (nextName && Number.isFinite(remaining)) {
    label = `Ya tienes los puntos para ${nextName}; tu nivel se actualizará pronto.`;
  } else if (nextName) {
    label = `Siguiente nivel: ${nextName}.`;
    progress = target > 0 && Number.isFinite(current) ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;
  }
  if (progEl) progEl.textContent = label;
  if (barEl) barEl.value = progress;

  // A same-card refresh keeps this section visible, so replace earlier perks.
  const perksDiv = safeEl($, "#tierPerks");
  if (!perksDiv) return;
  perksDiv.replaceChildren();
  if (tier.perks && Array.isArray(tier.perks) && tier.perks.length) {
    const strong = document.createElement("strong");
    strong.textContent = "Beneficios:";
    perksDiv.appendChild(strong);

    const ul = document.createElement("ul");
    ul.className = "tier-perks-list";

    tier.perks.forEach((perk) => {
      const li = document.createElement("li");
      li.textContent = perk;
      ul.appendChild(li);
    });

    perksDiv.appendChild(ul);
  }
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerAchievementsResponse} data
 */
export function renderAchievements($, data) {
  const container = safeEl($, "#achievements");
  if (!container) return;
  container.replaceChildren();

  const earned = data.earned || [];
  const inProgress = data.inProgress || [];

  if (earned.length === 0 && inProgress.length === 0) {
    container.textContent = "No hay logros disponibles.";
    return;
  }

  // Show last 3 earned
  const recentEarned = earned.slice(0, 3);
  if (recentEarned.length > 0) {
    const earnedDiv = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Logros obtenidos:";
    earnedDiv.appendChild(title);
    recentEarned.forEach((ach) => {
      const div = document.createElement("div");
      div.className = "badge";
      div.classList.add("achievement-earned");
      div.textContent = `${ach.icon_url || "🏆"} ${ach.name}`;
      earnedDiv.appendChild(div);
    });
    container.appendChild(earnedDiv);
  }

  // Show top 2 in progress
  const topInProgress = inProgress
    .filter((a) => a.progress > 0)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 2);

  if (topInProgress.length > 0) {
    const progressDiv = document.createElement("div");
    progressDiv.className = "progress-block";

    const strong = document.createElement("strong");
    strong.textContent = "En progreso:";
    progressDiv.appendChild(strong);

    topInProgress.forEach((ach) => {
      const wrapper = document.createElement("div");
      wrapper.className = "progress-item";

      const row = document.createElement("div");
      row.className = "row gap-8 align-center";

      const icon = document.createElement("span");
      icon.textContent = ach.icon_url || "⏳";
      row.appendChild(icon);

      const content = document.createElement("div");
      content.className = "flex-1";

      const label = document.createElement("div");
      label.className = "small";
      label.textContent = `${ach.name} (${ach.current}/${ach.total})`;
      content.appendChild(label);

      const progressBar = document.createElement("progress");
      progressBar.className = "progress-inline progress-blue progress-thin progress-line";
      progressBar.max = 100;
      progressBar.value = ach.progress;
      content.appendChild(progressBar);
      row.appendChild(content);
      wrapper.appendChild(row);
      progressDiv.appendChild(wrapper);
    });
    container.appendChild(progressDiv);
  }
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerReferralCodeData | null | undefined} codeData
 */
export function renderReferralCode($, codeData) {
  const input = /** @type {HTMLInputElement | null} */ (safeEl($, "#referralCode"));
  if (!input) return;
  if (!codeData || !codeData.code) {
    input.value = "N/A";
    return;
  }
  input.value = codeData.code;
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerReferralStats | null | undefined} stats
 */
export function renderReferralStats($, stats) {
  const container = safeEl($, "#referralStats");
  if (!container) return;
  if (!stats) {
    container.textContent = "";
    return;
  }

  const total = stats.total_referrals || 0;
  const completed = stats.completed_referrals || 0;
  const points = stats.total_points_earned || 0;
  container.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "mt-8";
  const rows = [
    ["📊 Amigos invitados:", total],
    ["✅ Completados:", completed],
    ["🎁 Puntos ganados:", points]
  ];
  rows.forEach(([label, value]) => {
    const line = document.createElement("div");
    line.appendChild(document.createTextNode(`${label} `));
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    line.appendChild(strong);
    wrap.appendChild(line);
  });
  container.appendChild(wrap);
}

/**
 * @param {(selector: string) => Element | null} $
 */
export function renderOfflineStub($) {
  const rewards = safeEl($, "#rewards");
  if (rewards) {
    rewards.replaceChildren();
    const card = document.createElement("div");
    card.className = "card";
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = "Conéctate a internet para ver recompensas y actividad.";
    card.appendChild(p);
    rewards.appendChild(card);
  }
  const txEl = safeEl($, "#tx");
  const rdEl = safeEl($, "#red");
  if (txEl) txEl.textContent = "(sin conexión)";
  if (rdEl) rdEl.textContent = "(sin conexión)";
  const tierSection = safeEl($, "#tierSection");
  setHidden(tierSection, true);
}
