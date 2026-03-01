/** @typedef {import("../types.js").ExternalAwardsConfig} ExternalAwardsConfig */
/** @typedef {import("../types.js").LifecycleConfig} LifecycleConfig */
/** @typedef {import("../types.js").ProgramPayload} ProgramPayload */
/** @typedef {import("../types.js").ProgramResponse} ProgramResponse */
/** @typedef {import("../types.js").QueryFn} QueryFn */
/** @typedef {import("../types.js").TierPolicyConfig} TierPolicyConfig */

const DEFAULTS = {
  programType: "SPEND",
  timezone: "America/Guatemala",
  schedulerHour: 9,
  tierMode: "lifetime",
  winbackDays: 30
};

const AUTOMATION_TEMPLATE_LABELS = {
  cafeteria_basico: "Cafetería básico",
  reactivacion_fuerte: "Reactivación fuerte",
  solo_alertas: "Solo alertas"
};

/**
 * @param {QueryFn} $
 * @param {string} selector
 * @returns {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement}
 */
function field($, selector) {
  return /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ ($(selector));
}

/**
 * @param {QueryFn} $
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
function checkbox($, selector) {
  return /** @type {HTMLInputElement} */ ($(selector));
}

/**
 * @param {QueryFn} $
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
function input($, selector) {
  return /** @type {HTMLInputElement} */ ($(selector));
}

/**
 * @param {QueryFn} $
 * @param {string} selector
 * @returns {HTMLElement}
 */
function element($, selector) {
  return /** @type {HTMLElement} */ ($(selector));
}

/** @param {QueryFn} $ */
export function toggleProgramBoxes($) {
  const type = field($, "#programType")?.value || DEFAULTS.programType;
  element($, "#programSpendBox").style.display = type === "SPEND" ? "block" : "none";
  element($, "#programVisitBox").style.display = type === "VISIT" ? "block" : "none";
  element($, "#programItemBox").style.display = type === "ITEM" ? "block" : "none";
}

/** @param {QueryFn} $ */
export function updateProgramSummary($) {
  const type = field($, "#programType")?.value || DEFAULTS.programType;
  let text = "";
  if (type === "SPEND") {
    const rate = Number(field($, "#programPointsPerQ").value || 0);
    const round = field($, "#programRound").value;
    const fn = round === "floor" ? "floor" : round === "round" ? "round" : "ceil";
    text = `Ejemplo: Q100 -> ${Math[fn](100 * rate)} puntos.`;
  } else if (type === "VISIT") {
    const points = Number(field($, "#programPointsPerVisit").value || 0);
    text = `Cada visita suma ${points} puntos.`;
  } else {
    const points = Number(field($, "#programPointsPerItem").value || 0);
    text = `Cada item suma ${points} puntos.`;
  }

  const maxPts = Number(field($, "#guardMaxPoints").value || 0);
  const maxAmt = Number(field($, "#guardMaxAmount").value || 0);
  const susPts = Number(field($, "#guardSuspiciousPoints").value || 0);
  const susAmt = Number(field($, "#guardSuspiciousAmount").value || 0);
  const expDays = Math.floor(Number(field($, "#pointsExpirationDays").value || 0));
  const redeemDay = Math.floor(Number(field($, "#redeemMaxPerDay").value || 0));
  const redeemRewardDay = Math.floor(Number(field($, "#redeemMaxPerRewardDay").value || 0));
  const redeemCooldown = Math.floor(Number(field($, "#redeemCooldownHours").value || 0));

  element($, "#programSummary").textContent =
    `${text}\nLímites: max puntos/tx=${maxPts || "sin límite"}, max monto=Q${maxAmt || "sin límite"}.\n` +
    `Alertas: puntos>=${susPts || "off"}, monto>=Q${susAmt || "off"}.\n` +
    `Vencimiento: ${expDays > 0 ? `${expDays} días` : "desactivado"}.\n` +
    `Canjes: día=${redeemDay || "sin límite"}, mismo premio/día=${redeemRewardDay || "sin límite"}, enfriamiento=${redeemCooldown || 0}h.`;
}

/**
 * @param {QueryFn} $
 * @param {LifecycleConfig} [lifecycle]
 */
export function fillLifecycleFields($, lifecycle = {}) {
  checkbox($, "#lifecycleBirthdayEnabled").checked = Boolean(lifecycle.birthday_enabled);
  field($, "#lifecycleBirthdayPoints").value = String(Number(lifecycle.birthday_points ?? 0));
  checkbox($, "#lifecycleWinbackEnabled").checked = Boolean(lifecycle.winback_enabled);
  field($, "#lifecycleWinbackDays").value = String(Number(lifecycle.winback_days ?? DEFAULTS.winbackDays));
  field($, "#lifecycleWinbackPoints").value = String(Number(lifecycle.winback_points ?? 0));
  field($, "#lifecycleSchedulerHour").value = String(Number(lifecycle.scheduler_hour_local ?? DEFAULTS.schedulerHour));
  field($, "#lifecycleSchedulerTz").value = String(lifecycle.scheduler_tz || DEFAULTS.timezone);
}

/**
 * @param {QueryFn} $
 * @param {TierPolicyConfig} [tierPolicy]
 */
export function fillTierPolicyFields($, tierPolicy = {}) {
  field($, "#tierPolicyMode").value = tierPolicy.mode || DEFAULTS.tierMode;
  field($, "#tierPolicyDays").value = String(Number(tierPolicy.rolling_days ?? 365));
  field($, "#tierPolicyGrace").value = String(Number(tierPolicy.grace_days ?? 0));
}

/**
 * @param {QueryFn} $
 * @param {ProgramResponse} [program]
 */
export function fillProgramForm($, program = {}) {
  const type = program.program_type || DEFAULTS.programType;
  const cfg = program.program_json || {};
  const guard = cfg.award_guard || {};
  const redemptionGuard = cfg.redemption_guard || {};

  field($, "#programType").value = type;
  field($, "#programPointsPerQ").value = String(Number(cfg.points_per_q ?? 0.1));
  field($, "#programRound").value = cfg.round || "ceil";
  field($, "#programPointsPerVisit").value = String(Number(cfg.points_per_visit ?? 10));
  field($, "#programPointsPerItem").value = String(Number(cfg.points_per_item ?? 1));

  field($, "#guardMaxAmount").value = String(Number(guard.max_amount_q ?? 0));
  field($, "#guardMaxPoints").value = String(Number(guard.max_points_per_tx ?? 0));
  field($, "#guardMaxVisits").value = String(Number(guard.max_visits ?? 0));
  field($, "#guardMaxItems").value = String(Number(guard.max_items ?? 0));
  field($, "#guardSuspiciousPoints").value = String(Number(guard.suspicious_points_threshold ?? 0));
  field($, "#guardSuspiciousAmount").value = String(Number(guard.suspicious_amount_q_threshold ?? 0));

  field($, "#pendingHoldDays").value = String(Number(cfg.pending_points_hold_days ?? 0));
  field($, "#pointsExpirationDays").value = String(Number(cfg.points_expiration_days ?? 0));

  field($, "#redeemMaxPerDay").value = String(Number(redemptionGuard.max_redemptions_per_day ?? 0));
  field($, "#redeemMaxPerRewardDay").value = String(Number(redemptionGuard.max_reward_redemptions_per_day ?? 0));
  field($, "#redeemCooldownHours").value = String(Number(redemptionGuard.reward_cooldown_hours ?? 0));

  fillLifecycleFields($, cfg.lifecycle || {});
  fillTierPolicyFields($, cfg.tier_policy || {});

  element($, "#automationStatus").textContent =
    `Horario activo: ${Number((cfg.lifecycle || {}).scheduler_hour_local ?? DEFAULTS.schedulerHour)}:00 ` +
    `(${String((cfg.lifecycle || {}).scheduler_tz || DEFAULTS.timezone)}).`;
}

/**
 * @param {QueryFn} $
 * @param {ExternalAwardsConfig} [externalAwards]
 */
export function fillExternalAwardsForm($, externalAwards = {}) {
  checkbox($, "#externalAwardsEnabled").checked = Boolean(externalAwards.enabled);
  input($, "#externalAwardsApiKey").value = "";
  input($, "#externalAwardsApiKey").placeholder = externalAwards.has_api_key
    ? "Clave configurada (dejar vacío para conservar)"
    : "Ingresa clave API externa";
}

/**
 * @param {QueryFn} $
 * @returns {ProgramPayload}
 */
export function buildProgramPayload($) {
  const programType = field($, "#programType").value;
  const common = {
    pending_points_hold_days: Math.floor(Number(field($, "#pendingHoldDays").value || 0)),
    points_expiration_days: Math.floor(Number(field($, "#pointsExpirationDays").value || 0)),
    award_guard: {
      max_amount_q: Number(field($, "#guardMaxAmount").value || 0),
      max_points_per_tx: Math.floor(Number(field($, "#guardMaxPoints").value || 0)),
      max_visits: Math.floor(Number(field($, "#guardMaxVisits").value || 0)),
      max_items: Math.floor(Number(field($, "#guardMaxItems").value || 0)),
      suspicious_points_threshold: Math.floor(Number(field($, "#guardSuspiciousPoints").value || 0)),
      suspicious_amount_q_threshold: Number(field($, "#guardSuspiciousAmount").value || 0)
    },
    redemption_guard: {
      max_redemptions_per_day: Math.floor(Number(field($, "#redeemMaxPerDay").value || 0)),
      max_reward_redemptions_per_day: Math.floor(Number(field($, "#redeemMaxPerRewardDay").value || 0)),
      reward_cooldown_hours: Math.floor(Number(field($, "#redeemCooldownHours").value || 0))
    },
    lifecycle: {
      birthday_enabled: checkbox($, "#lifecycleBirthdayEnabled").checked,
      birthday_points: Math.floor(Number(field($, "#lifecycleBirthdayPoints").value || 0)),
      winback_enabled: checkbox($, "#lifecycleWinbackEnabled").checked,
      winback_days: Math.floor(Number(field($, "#lifecycleWinbackDays").value || DEFAULTS.winbackDays)),
      winback_points: Math.floor(Number(field($, "#lifecycleWinbackPoints").value || 0)),
      scheduler_hour_local: Math.floor(Number(field($, "#lifecycleSchedulerHour").value || DEFAULTS.schedulerHour)),
      scheduler_tz: field($, "#lifecycleSchedulerTz").value.trim() || DEFAULTS.timezone
    },
    tier_policy: {
      mode: field($, "#tierPolicyMode").value,
      rolling_days: Math.floor(Number(field($, "#tierPolicyDays").value || 365)),
      grace_days: Math.floor(Number(field($, "#tierPolicyGrace").value || 0))
    }
  };

  if (programType === "SPEND") {
    return {
      program_type: programType,
      program_json: {
        points_per_q: Number(field($, "#programPointsPerQ").value || 0),
        round: field($, "#programRound").value,
        ...common
      }
    };
  }

  if (programType === "VISIT") {
    return {
      program_type: programType,
      program_json: {
        points_per_visit: Math.floor(Number(field($, "#programPointsPerVisit").value || 0)),
        ...common
      }
    };
  }

  return {
    program_type: programType,
    program_json: {
      points_per_item: Math.floor(Number(field($, "#programPointsPerItem").value || 0)),
      ...common
    }
  };
}

/**
 * @param {QueryFn} $
 * @param {string} template
 * @param {LifecycleConfig} [lifecycle]
 */
export function applyAutomationTemplateForm($, template, lifecycle = {}) {
  fillLifecycleFields($, lifecycle);
  element($, "#automationStatus").textContent = `Plantilla aplicada: ${AUTOMATION_TEMPLATE_LABELS[template] || template}.`;
}
