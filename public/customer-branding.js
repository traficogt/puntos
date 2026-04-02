const DEFAULT_CUSTOMER_BRANDING = {
  brandingMode: "endorsed_brand",
  primaryColor: "#B8572F",
  accentColor: "#D7A554",
  neutralTheme: "warm",
  poweredByVisible: true
};

/** @typedef {{
 *   name?: string,
 *   customer_branding?: Record<string, unknown> | null,
 *   customer_branding_json?: Record<string, unknown> | null
 * }} BrandingBusinessLike */

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmed(value) {
  return String(value ?? "").trim();
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function safeHexColor(value, fallback) {
  const raw = trimmed(value);
  return /^#[0-9A-Fa-f]{6}$/.test(raw) ? raw.toUpperCase() : fallback;
}

/**
 * @param {string} hex
 * @param {number} ratio
 * @returns {string}
 */
function darken(hex, ratio) {
  const raw = safeHexColor(hex, DEFAULT_CUSTOMER_BRANDING.primaryColor).slice(1);
  const parts = [0, 2, 4].map((offset) => {
    const base = parseInt(raw.slice(offset, offset + 2), 16);
    return Math.max(0, Math.min(255, Math.round(base * ratio)));
  });
  return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * @param {BrandingBusinessLike | null | undefined} business
 */
export function normalizeCustomerBranding(business) {
  /** @type {BrandingBusinessLike} */
  const base = business && typeof business === "object" ? business : {};
  const raw = base.customer_branding && typeof base.customer_branding === "object"
    ? base.customer_branding
    : base.customer_branding_json && typeof base.customer_branding_json === "object"
      ? base.customer_branding_json
      : {};

  const businessName = trimmed(base.name) || "PuntosFieles";
  const brandingMode = ["platform_led", "endorsed_brand", "white_label_ready"].includes(trimmed(raw.branding_mode))
    ? trimmed(raw.branding_mode)
    : DEFAULT_CUSTOMER_BRANDING.brandingMode;
  const programName = trimmed(raw.customer_program_name) || businessName;
  const logoUrl = trimmed(raw.customer_logo_url);
  const primaryColor = safeHexColor(raw.primary_color, DEFAULT_CUSTOMER_BRANDING.primaryColor);
  const accentColor = safeHexColor(raw.accent_color, DEFAULT_CUSTOMER_BRANDING.accentColor);
  const neutralTheme = ["warm", "neutral", "cool"].includes(trimmed(raw.neutral_theme))
    ? trimmed(raw.neutral_theme)
    : DEFAULT_CUSTOMER_BRANDING.neutralTheme;
  const poweredByVisible = raw.powered_by_visible === false ? false : DEFAULT_CUSTOMER_BRANDING.poweredByVisible;
  const walletHeadline = trimmed(raw.wallet_headline) || `Tus puntos en ${businessName}`;
  const joinHeadline = trimmed(raw.join_headline) || `Unete y gana beneficios en ${businessName}`;

  return {
    businessName,
    brandingMode,
    programName,
    logoUrl,
    primaryColor,
    accentColor,
    neutralTheme,
    poweredByVisible,
    walletHeadline,
    joinHeadline,
    navKicker: brandingMode === "platform_led" ? "Programa de lealtad" : "Programa activo",
    navTitle: brandingMode === "platform_led" ? "PuntosFieles" : programName,
    joinSubtitle: `Confirma tu telefono para acumular puntos en ${businessName}.`
  };
}

/**
 * @param {string} selector
 * @param {string} text
 */
function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

/**
 * @param {string} selector
 * @param {string} url
 */
function setLogo(selector, url) {
  const el = /** @type {HTMLImageElement | null} */ (document.querySelector(selector));
  if (!el) return;
  if (!url) {
    el.hidden = true;
    el.removeAttribute("src");
    return;
  }
  el.src = url;
  el.hidden = false;
}

function ensureBrandingThemeTag() {
  let tag = /** @type {HTMLStyleElement | null} */ (document.getElementById("customerBrandingTheme"));
  if (tag) return tag;
  tag = document.createElement("style");
  tag.id = "customerBrandingTheme";
  document.head.appendChild(tag);
  return tag;
}

/**
 * @param {ReturnType<typeof normalizeCustomerBranding>} branding
 */
export function applyCustomerBrandingTheme(branding) {
  ensureBrandingThemeTag().textContent = `:root{--accent:${branding.primaryColor};--accent-deep:${darken(branding.primaryColor, 0.78)};--accent-3:${branding.accentColor};}`;
  document.body?.setAttribute("data-branding-mode", branding.brandingMode);
  document.body?.setAttribute("data-branding-neutral-theme", branding.neutralTheme);

  const themeColor = /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="theme-color"]'));
  if (themeColor) themeColor.content = branding.primaryColor;
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {BrandingBusinessLike | null | undefined} business
 */
export function applyJoinBranding($, business) {
  const branding = normalizeCustomerBranding(business);
  applyCustomerBrandingTheme(branding);
  setLogo("#customerBrandLogo", branding.logoUrl);
  setText("#customerBrandKicker", branding.navKicker);
  setText("#customerBrandTitle", branding.navTitle);
  setText("#title", branding.joinHeadline);
  setText("#subtitle", branding.joinSubtitle);
  setText("#doneTitle", `${branding.programName} ya esta activo.`);
  setText("#doneSubtitle", "En breve abrimos tu vista de cliente para que puedas mostrar tu QR y ver tus puntos.");

  const poweredBy = /** @type {HTMLElement | null} */ ($("#customerPoweredBy"));
  if (poweredBy) {
    poweredBy.hidden = !branding.poweredByVisible;
    poweredBy.textContent = "Powered by PuntosFieles";
  }

  document.title = `Registro • ${branding.programName}`;
  return branding;
}

/**
 * @param {(selector: string) => Element | null} $
 * @param {BrandingBusinessLike | null | undefined} business
 */
export function applyWalletBranding($, business) {
  const branding = normalizeCustomerBranding(business);
  applyCustomerBrandingTheme(branding);
  setLogo("#customerBrandLogo", branding.logoUrl);
  setText("#customerBrandKicker", branding.navKicker);
  setText("#customerBrandTitle", branding.navTitle);
  setText("#customerEntryTitle", "Tu tarjeta se abre con el enlace del negocio.");
  setText(
    "#customerEntrySubtitle",
    `Si tu sesión venció, vuelve a abrir el enlace de ${branding.businessName} para entrar de nuevo.`,
  );
  setText("#bizName", branding.walletHeadline);

  const poweredBy = /** @type {HTMLElement | null} */ ($("#customerPoweredBy"));
  if (poweredBy) {
    poweredBy.hidden = !branding.poweredByVisible;
    poweredBy.textContent = "Powered by PuntosFieles";
  }

  document.title = `Mi tarjeta • ${branding.programName}`;
  return branding;
}
