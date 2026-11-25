import {
  renderBaseEmailTemplate,
  renderHtmlParagraphs,
  renderPoweredByText,
  renderTextParagraphs,
} from "./base-template.js";

/** @param {string} tone */
function resolveEyebrow(tone) {
  if (tone === "celebration") return "Celebración";
  if (tone === "alert") return "Alerta";
  return "Programa activo";
}

/**
 * @param {{
 *   branding: import("../email-branding.js").EmailBranding,
 *   subject?: string,
 *   title?: string,
 *   intro?: string,
 *   lines?: string[],
 *   tone?: string
 * }} input
 */
export function renderLifecycleEmail({
  branding,
  subject = "",
  title = "",
  intro = "",
  lines = [],
  tone = "update",
}) {
  const resolvedSubject = String(subject || branding.brandName).trim();
  const resolvedTitle = String(title || "Novedades de tu programa").trim();
  const safeLines = [intro, ...lines].map((line) => String(line || "").trim()).filter(Boolean);
  return {
    subject: resolvedSubject,
    text: renderTextParagraphs([resolvedTitle, "", ...safeLines, "", renderPoweredByText()]),
    html: renderBaseEmailTemplate({
      branding,
      preheader: safeLines[0] || resolvedTitle,
      eyebrow: resolveEyebrow(tone),
      title: resolvedTitle,
      footerText: "Gracias por seguir usando tu programa de lealtad.",
      bodyHtml: renderHtmlParagraphs(safeLines),
    }),
  };
}
