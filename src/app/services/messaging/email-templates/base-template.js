function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderTextParagraphs(lines = []) {
  return lines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function renderPoweredByText() {
  return "Powered by PuntosFieles: https://puntosfieles.com/";
}

export function renderHtmlParagraphs(lines = []) {
  return lines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:#374151;">${escapeHtml(line)}</p>`)
    .join("");
}

export function renderBaseEmailTemplate({
  branding,
  preheader = "",
  title = "",
  eyebrow = "",
  bodyHtml = "",
  footerText = ""
}) {
  const brandName = escapeHtml(branding.brandName);
  const lockupHtml = branding.lockupUrl
    ? `<img src="${escapeHtml(branding.lockupUrl)}" alt="${brandName}" width="318" height="64" style="display:block;border:0;outline:none;text-decoration:none;">`
    : "";
  const brandMediaHtml = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${brandName}" width="40" height="40" style="display:block;border:0;outline:none;text-decoration:none;border-radius:10px;">`
    : "";
  const wordmarkHtml = branding.wordmarkUrl
    ? `<img src="${escapeHtml(branding.wordmarkUrl)}" alt="${brandName}" height="28" style="display:block;border:0;outline:none;text-decoration:none;">`
    : "";
  const brandTextHtml = `<div style="font-size:20px;line-height:28px;font-weight:700;color:#111827;">${brandName}</div>`;
  const headerBrandHtml = lockupHtml
    ? lockupHtml
    : brandMediaHtml || wordmarkHtml
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          ${brandMediaHtml ? `<td style="vertical-align:middle;padding-right:14px;">${brandMediaHtml}</td>` : ""}
          <td style="vertical-align:middle;">${wordmarkHtml || brandTextHtml}</td>
        </tr>
      </table>
    `
    : brandTextHtml;
  const poweredByHtml = branding.poweredByVisible
    ? `<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#6B7280;"><a href="https://puntosfieles.com/" style="color:#6B7280;text-decoration:underline;">Powered by PuntosFieles</a></p>`
    : "";
  const eyebrowHtml = eyebrow
    ? `<p style="margin:0 0 10px;font-size:12px;line-height:18px;letter-spacing:0.12em;text-transform:uppercase;color:${escapeHtml(branding.accentColor)};">${escapeHtml(eyebrow)}</p>`
    : "";

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#F5F1EB;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EB;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;border-bottom:1px solid #F1F5F9;">
                ${headerBrandHtml}
                <p style="margin:14px 0 0;font-size:14px;line-height:20px;color:#6B7280;">${brandName}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${eyebrowHtml}
                <h1 style="margin:0 0 16px;font-size:30px;line-height:34px;font-weight:700;color:#111827;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#6B7280;">${escapeHtml(footerText)}</p>
                ${poweredByHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
