import { renderBaseEmailTemplate, renderHtmlParagraphs, renderTextParagraphs } from "./base-template.js";

export function renderChurnEmail({ branding, subject = "", title = "", intro = "", lines = [] }) {
  const resolvedSubject = String(subject || `${branding.brandName}: te extrañamos`).trim();
  const resolvedTitle = String(title || "Te extrañamos").trim();
  const safeLines = [intro, ...lines].map((line) => String(line || "").trim()).filter(Boolean);
  return {
    subject: resolvedSubject,
    text: renderTextParagraphs([resolvedTitle, "", ...safeLines]),
    html: renderBaseEmailTemplate({
      branding,
      preheader: safeLines[0] || resolvedTitle,
      eyebrow: "Vuelve pronto",
      title: resolvedTitle,
      footerText: "Tu programa de lealtad sigue listo para tu próxima visita.",
      bodyHtml: renderHtmlParagraphs(safeLines)
    })
  };
}
