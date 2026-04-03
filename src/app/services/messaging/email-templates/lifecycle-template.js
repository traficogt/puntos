import { renderBaseEmailTemplate, renderHtmlParagraphs, renderTextParagraphs } from "./base-template.js";

function resolveEyebrow(tone) {
  if (tone === "celebration") return "Celebración";
  if (tone === "alert") return "Alerta";
  return "Programa activo";
}

export function renderLifecycleEmail({ branding, subject = "", title = "", intro = "", lines = [], tone = "update" }) {
  const resolvedSubject = String(subject || branding.brandName).trim();
  const resolvedTitle = String(title || "Novedades de tu programa").trim();
  const safeLines = [intro, ...lines].map((line) => String(line || "").trim()).filter(Boolean);
  return {
    subject: resolvedSubject,
    text: renderTextParagraphs([resolvedTitle, "", ...safeLines]),
    html: renderBaseEmailTemplate({
      branding,
      preheader: safeLines[0] || resolvedTitle,
      eyebrow: resolveEyebrow(tone),
      title: resolvedTitle,
      footerText: "Gracias por seguir usando tu programa de lealtad.",
      bodyHtml: renderHtmlParagraphs(safeLines)
    })
  };
}
