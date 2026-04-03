import { renderBaseEmailTemplate } from "./email-templates/base-template.js";
import { renderVerifyEmail } from "./email-templates/verify-template.js";
import { renderSecurityEmail } from "./email-templates/security-template.js";
import { renderLifecycleEmail } from "./email-templates/lifecycle-template.js";
import { renderChurnEmail } from "./email-templates/churn-template.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function defaultSubject(channel, branding) {
  if (channel === "verify") return `${branding.brandName}: tu código de acceso`;
  if (channel === "security") return `${branding.brandName}: aviso de seguridad`;
  if (channel === "CHURN") return `${branding.brandName}: te extrañamos`;
  return branding.brandName;
}

function legacyHtml(body) {
  return String(body || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:#374151;">${escapeHtml(part)}</p>`)
    .join("");
}

export async function renderEmailMessage({ channel, body = "", branding, email = null }) {
  if (email?.type === "verify") return renderVerifyEmail({ branding, ...email });
  if (email?.type === "security") return renderSecurityEmail({ branding, ...email });
  if (email?.type === "lifecycle") return renderLifecycleEmail({ branding, ...email });
  if (email?.type === "churn") return renderChurnEmail({ branding, ...email });

  const subject = defaultSubject(channel, branding);
  return {
    subject,
    text: String(body || ""),
    html: renderBaseEmailTemplate({
      branding,
      preheader: String(body || "").slice(0, 120),
      title: subject,
      footerText: "Mensaje enviado por PuntosFieles.",
      bodyHtml: legacyHtml(body)
    })
  };
}
