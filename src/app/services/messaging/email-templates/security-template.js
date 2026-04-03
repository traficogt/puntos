import { renderBaseEmailTemplate, renderHtmlParagraphs, renderPoweredByText, renderTextParagraphs } from "./base-template.js";

export function renderSecurityEmail({ branding, subject = "", title = "", lines = [] }) {
  const resolvedSubject = String(subject || `${branding.brandName}: aviso de seguridad`).trim();
  const resolvedTitle = String(title || "Aviso de seguridad").trim();
  const safeLines = lines.map((line) => String(line || "").trim()).filter(Boolean);
  return {
    subject: resolvedSubject,
    text: renderTextParagraphs([resolvedTitle, "", ...safeLines, "", renderPoweredByText()]),
    html: renderBaseEmailTemplate({
      branding,
      preheader: safeLines[0] || resolvedTitle,
      eyebrow: branding.scope === "platform" ? "Seguridad" : "Seguridad del programa",
      title: resolvedTitle,
      footerText: "Si no reconoces esta actividad, revisa el acceso a tu cuenta.",
      bodyHtml: renderHtmlParagraphs(safeLines)
    })
  };
}
