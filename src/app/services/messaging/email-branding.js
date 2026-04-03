import { config } from "../../../config/index.js";

function baseOrigin() {
  return String(config.MARKETING_ORIGIN || config.APP_ORIGIN || "").replace(/\/+$/, "");
}

const PLATFORM_EMAIL_BRANDING = {
  scope: "platform",
  brandName: "PuntosFieles",
  logoUrl: `${baseOrigin()}/icon-192.png`,
  wordmarkUrl: `${baseOrigin()}/pf-email-wordmark.png`,
  primaryColor: "#6D3524",
  accentColor: "#D7A554",
  poweredByVisible: false
};

function normalizeHexColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeLogoUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export async function resolveEmailBranding({
  businessId = null,
  business = null,
  getBusinessById = async (_businessId) => null
} = {}) {
  const source = business ?? (businessId ? await getBusinessById(businessId) : null);
  if (!source) return { ...PLATFORM_EMAIL_BRANDING };

  const raw = source.customer_branding_json && typeof source.customer_branding_json === "object"
    ? source.customer_branding_json
    : {};
  return {
    scope: "tenant",
    brandName: String(raw.customer_program_name || source.name || PLATFORM_EMAIL_BRANDING.brandName).trim(),
    logoUrl: normalizeLogoUrl(raw.customer_logo_url),
    wordmarkUrl: "",
    primaryColor: normalizeHexColor(raw.primary_color, PLATFORM_EMAIL_BRANDING.primaryColor),
    accentColor: normalizeHexColor(raw.accent_color, PLATFORM_EMAIL_BRANDING.accentColor),
    poweredByVisible: raw.powered_by_visible !== false
  };
}

export { PLATFORM_EMAIL_BRANDING };
