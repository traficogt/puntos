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

/**
 * @param {(selector: string) => Element | null} $
 * @param {number} points
 * @param {CustomerReward[] | undefined} rewards
 */
export function renderRewards($, points, rewards) {
  const box = safeEl($, "#rewards");
  if (!box) return;
  box.replaceChildren();

  const nextRewardEl = safeEl($, "#nextReward");

  if (!rewards?.length) {
    const card = document.createElement("div");
    card.className = "card";
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = "No hay recompensas activas.";
    card.appendChild(p);
    box.appendChild(card);
    if (nextRewardEl) nextRewardEl.textContent = "";
    return;
  }

  // Siguiente recompensa sugerida
  const sorted = [...rewards].sort((a, b) => a.points_cost - b.points_cost);
  const next = sorted.find((r) => r.points_cost > points) || sorted[0];
  const remain = Math.max(0, next.points_cost - points);
  if (nextRewardEl) {
    nextRewardEl.textContent = remain === 0
      ? `¡Ya puedes canjear “${next.name}”!`
      : `Te faltan ${remain} puntos para “${next.name}”.`;
  }

  for (const r of sorted) {
    const can = points >= r.points_cost;
    const div = document.createElement("div");
    div.className = "card";
    const title = document.createElement("h2");
    title.textContent = r.name;
    const desc = document.createElement("p");
    desc.textContent = r.description || "";
    const row = document.createElement("div");
    row.className = "row";
    const badge1 = document.createElement("span");
    badge1.className = "badge";
    badge1.appendChild(document.createTextNode("Costo: "));
    const codeEl = document.createElement("code");
    codeEl.textContent = String(r.points_cost);
    badge1.appendChild(codeEl);
    badge1.appendChild(document.createTextNode(" pts"));

    const badge2 = document.createElement("span");
    badge2.className = "badge";
    badge2.textContent = can ? "✅ Disponible" : "⏳ Aún no";

    row.appendChild(badge1);
    row.appendChild(badge2);

    div.appendChild(title);
    div.appendChild(desc);
    div.appendChild(row);
    box.appendChild(div);
  }
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerTransaction[] | undefined} transactions
 * @param {CustomerRedemption[] | undefined} redemptions
 */
export function renderHistory($, transactions, redemptions) {
  const txText = (transactions || []).slice(0, 12).map((t) => {
    const when = new Date(t.created_at).toLocaleString();
    const pts = t.points_delta >= 0 ? `+${t.points_delta}` : String(t.points_delta);
    const amt = t.amount_q != null ? ` Q${Number(t.amount_q).toFixed(2)}` : "";
    return `${when}  ${pts} pts${amt}`;
  }).join("\n") || "(sin registros)";

  const rdText = (redemptions || []).slice(0, 12).map((r) => {
    const when = new Date(r.created_at).toLocaleString();
    const status = r.redeemed_at ? "✅" : "⏳";
    return `${when}  ${status} ${r.reward_name}  (-${r.points_cost} pts)  Código: ${r.code}`;
  }).join("\n") || "(sin canjes)";

  const txEl = safeEl($, "#tx");
  const rdEl = safeEl($, "#red");
  if (txEl) txEl.textContent = txText;
  if (rdEl) rdEl.textContent = rdText;
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {CustomerTier | null | undefined} tier
 */
export function renderTier($, tier) {
  const section = safeEl($, "#tierSection");
  if (!section) return;
  if (!tier) {
    section.style.display = "none";
    return;
  }

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
  const barEl = safeEl($, "#tierProgressBar");

  if (iconEl) iconEl.textContent = icons[tier.tier_level] || "⭐";
  if (nameEl) nameEl.textContent = tier.name || "Bronce";
  if (multEl) multEl.textContent = `${tier.points_multiplier || 1.0}x puntos`;

  if (tier.points_to_next_tier && tier.next_tier_name) {
    if (progEl) progEl.textContent = `${tier.points_to_next_tier} puntos más para ${tier.next_tier_name}`;
    const progress = ((tier.current_points || 0) / (tier.next_tier_points || 1)) * 100;
    if (barEl) barEl.style.width = `${Math.min(100, progress)}%`;
  } else {
    if (progEl) progEl.textContent = "¡Nivel máximo alcanzado! 🎉";
    if (barEl) barEl.style.width = "100%";
  }

  if (tier.perks && Array.isArray(tier.perks)) {
    const perksDiv = safeEl($, "#tierPerks");
    if (!perksDiv) return;
    perksDiv.replaceChildren();

    const strong = document.createElement("strong");
    strong.textContent = "Beneficios:";
    perksDiv.appendChild(strong);

    const ul = document.createElement("ul");
    ul.style.margin = "8px 0 0 20px";

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
      div.style.margin = "4px 0";
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
    progressDiv.style.marginTop = "12px";

    const strong = document.createElement("strong");
    strong.textContent = "En progreso:";
    progressDiv.appendChild(strong);

    topInProgress.forEach((ach) => {
      const wrapper = document.createElement("div");
      wrapper.style.margin = "8px 0";

      const row = document.createElement("div");
      row.className = "row";
      row.style.alignItems = "center";
      row.style.gap = "8px";

      const icon = document.createElement("span");
      icon.textContent = ach.icon_url || "⏳";
      row.appendChild(icon);

      const content = document.createElement("div");
      content.style.flex = "1";

      const label = document.createElement("div");
      label.className = "small";
      label.textContent = `${ach.name} (${ach.current}/${ach.total})`;
      content.appendChild(label);

      const progressBg = document.createElement("div");
      progressBg.style.background = "#ddd";
      progressBg.style.height = "6px";
      progressBg.style.borderRadius = "3px";
      progressBg.style.marginTop = "4px";

      const progressBar = document.createElement("div");
      progressBar.style.background = "#2196F3";
      progressBar.style.height = "100%";
      progressBar.style.width = `${ach.progress}%`;
      progressBar.style.borderRadius = "3px";
      progressBg.appendChild(progressBar);

      content.appendChild(progressBg);
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
  wrap.style.marginTop = "8px";
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
  if (tierSection) tierSection.style.display = "none";
}
