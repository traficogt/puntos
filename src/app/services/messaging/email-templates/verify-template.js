import { renderBaseEmailTemplate, renderTextParagraphs } from "./base-template.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderVerifyEmail({ branding, businessName = "", code, expiresText = "Vence en 10 minutos." }) {
  const subject = `${branding.brandName}: tu código de acceso`;
  const text = renderTextParagraphs([
    branding.brandName,
    "",
    `Tu código es: ${code}`,
    expiresText
  ]);
  const html = renderBaseEmailTemplate({
    branding,
    preheader: `Tu código de acceso es ${code}`,
    eyebrow: businessName || branding.brandName,
    title: "Tu código está listo",
    footerText: "Si no solicitaste este código, puedes ignorar este correo.",
    bodyHtml: `
      <p style="margin:0 0 18px;font-size:16px;line-height:24px;color:#374151;">Usa este código para entrar a tu tarjeta o completar tu registro.</p>
      <div style="margin:0 0 18px;padding:18px 20px;border-radius:18px;background:#F8FAFC;border:1px solid #E5E7EB;font-size:34px;line-height:40px;font-weight:700;letter-spacing:6px;color:#111827;text-align:center;">${escapeHtml(code)}</div>
      <p style="margin:0;font-size:14px;line-height:22px;color:#6B7280;">${escapeHtml(expiresText)}</p>
    `
  });
  return { subject, text, html };
}
