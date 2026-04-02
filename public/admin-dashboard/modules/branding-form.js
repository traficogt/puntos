/** @typedef {import("../types.js").CustomerBrandingConfig} CustomerBrandingConfig */
/** @typedef {import("../types.js").QueryFn} QueryFn */
/** @type {{
 *   branding_mode: import("../types.js").CustomerBrandingConfig["branding_mode"],
 *   neutral_theme: import("../types.js").CustomerBrandingConfig["neutral_theme"],
 *   powered_by_visible: boolean
 * }} */
const DEFAULT_BRANDING = {
  branding_mode: "endorsed_brand",
  neutral_theme: "warm",
  powered_by_visible: true
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
 * @param {unknown} value
 * @returns {string | undefined}
 */
function trimOptional(value) {
  const raw = String(value ?? "").trim();
  return raw || undefined;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeHexColor(value) {
  const raw = trimOptional(value);
  if (!raw) return undefined;
  return /^#[0-9A-Fa-f]{6}$/.test(raw) ? raw.toUpperCase() : undefined;
}

/**
 * @param {QueryFn} $
 * @returns {CustomerBrandingConfig}
 */
export function buildBrandingPayload($) {
  const brandingModeValue = field($, "#brandingMode").value;
  /** @type {import("../types.js").CustomerBrandingConfig["branding_mode"]} */
  let brandingMode = DEFAULT_BRANDING.branding_mode;
  if (brandingModeValue === "platform_led" || brandingModeValue === "endorsed_brand" || brandingModeValue === "white_label_ready") {
    brandingMode = brandingModeValue;
  }
  const neutralThemeValue = field($, "#brandingNeutralTheme").value;
  /** @type {import("../types.js").CustomerBrandingConfig["neutral_theme"]} */
  let neutralTheme = DEFAULT_BRANDING.neutral_theme;
  if (neutralThemeValue === "warm" || neutralThemeValue === "neutral" || neutralThemeValue === "cool") {
    neutralTheme = neutralThemeValue;
  }

  return {
    branding_mode: brandingMode,
    customer_program_name: trimOptional(field($, "#brandingProgramName").value),
    customer_logo_url: trimOptional(field($, "#brandingLogoUrl").value),
    qr_logo_enabled: checkbox($, "#brandingQrLogoEnabled")?.checked === true,
    primary_color: normalizeHexColor(field($, "#brandingPrimaryColor").value),
    accent_color: normalizeHexColor(field($, "#brandingAccentColor").value),
    neutral_theme: neutralTheme,
    powered_by_visible: checkbox($, "#brandingPoweredByVisible").checked,
    wallet_headline: trimOptional(field($, "#brandingWalletHeadline").value),
    join_headline: trimOptional(field($, "#brandingJoinHeadline").value)
  };
}

/**
 * @param {QueryFn} $
 * @param {CustomerBrandingConfig} [branding]
 */
export function fillBrandingForm($, branding = {}) {
  const next = {
    ...DEFAULT_BRANDING,
    ...(branding || {})
  };

  field($, "#brandingMode").value = next.branding_mode;
  field($, "#brandingProgramName").value = next.customer_program_name || "";
  field($, "#brandingLogoUrl").value = next.customer_logo_url || "";
  const qrCheckbox = /** @type {HTMLInputElement | null} */ ($("#brandingQrLogoEnabled"));
  if (qrCheckbox) qrCheckbox.checked = next.qr_logo_enabled === true;
  field($, "#brandingPrimaryColor").value = next.primary_color || "";
  field($, "#brandingAccentColor").value = next.accent_color || "";
  field($, "#brandingNeutralTheme").value = next.neutral_theme || DEFAULT_BRANDING.neutral_theme;
  checkbox($, "#brandingPoweredByVisible").checked = next.powered_by_visible !== false;
  field($, "#brandingWalletHeadline").value = next.wallet_headline || "";
  field($, "#brandingJoinHeadline").value = next.join_headline || "";
}

/**
 * @param {QueryFn} $
 * @param {{ state?: { planInfo?: { plan?: string } }, requiredPlanLabel?: (feature: string) => string } | null} [app]
 */
export function updateBrandingSummary($, app = null) {
  const payload = buildBrandingPayload($);
  const hint = /** @type {HTMLElement | null} */ ($("#brandingModeHint"));
  const summary = /** @type {HTMLElement | null} */ ($("#brandingSummary"));
  const planNotice = /** @type {HTMLElement | null} */ ($("#brandingPlanNotice"));
  const qrHint = /** @type {HTMLElement | null} */ ($("#brandingQrLogoHint"));
  const qrCheckbox = /** @type {HTMLInputElement | null} */ ($("#brandingQrLogoEnabled"));
  const premiumPlan = app?.requiredPlanLabel?.("rbac_matrix") || "NEGOCIO";
  const activePlan = String(app?.state?.planInfo?.plan || "").toUpperCase();
  const canUsePremiumBranding = activePlan === "NEGOCIO" || activePlan === "EMPRESA";
  const canUseQrLogo = activePlan === "EMPRESA";

  const modeCopy = payload.branding_mode === "platform_led"
    ? "PuntosFieles lidera la experiencia y el negocio aparece como programa participante."
    : payload.branding_mode === "white_label_ready"
      ? "El negocio queda al frente y PuntosFieles puede pasar a una mención mínima."
      : "La experiencia mostrará el negocio y mantendrá a PuntosFieles como respaldo visible.";

  if (hint) hint.textContent = modeCopy;
  if (planNotice) {
    planNotice.textContent = canUsePremiumBranding
      ? "Tu plan ya permite branding premium en superficies de cliente."
      : `El branding premium en superficies de cliente se habilita desde ${premiumPlan}.`;
  }
  if (qrCheckbox) {
    qrCheckbox.disabled = !canUseQrLogo;
    if (!canUseQrLogo) qrCheckbox.checked = false;
  }
  if (qrHint) {
    qrHint.textContent = canUseQrLogo
      ? "Tu plan permite QR premium con logo, siempre con fallback seguro."
      : "El logo dentro del QR se reserva para EMPRESA.";
  }
  if (!summary) return;

  const pieces = [
    `Modo: ${payload.branding_mode}`,
    `Programa: ${payload.customer_program_name || "usa nombre del negocio"}`,
    `Titular wallet: ${payload.wallet_headline || "predeterminado"}`,
    `Titular registro: ${payload.join_headline || "predeterminado"}`,
    `Powered by: ${payload.powered_by_visible ? "visible" : "oculto"}`
  ];
  summary.textContent = pieces.join("\n");
}
