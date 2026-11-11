import QRCode from "qrcode";
import { acquisitionSourceUrl } from "./acquisition-link.js";
import { badRequest } from "../../utils/http-error.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_INK = "#302820";
const QUIET_ZONE = 4;
const LOGO_POSITIONS = ["center", "header", "none"];

function color(value, fallback) {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toUpperCase() : fallback;
}

export function contrastOnWhite(value) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) return 0;
  const channels = [1, 3, 5].map(offset => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 + 0.05);
}

function xml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

// Never fetch tenant-provided URLs or embed SVG, HTML, or remote dependencies.
// Small pre-existing embedded PNG/JPEG logos remain portable inside the export.
function portableLogo(value) {
  if (typeof value !== "string" || value.length > 180000) return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.toString("base64") !== match[2]) return null;
  if (match[1] === "png" && bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 && width <= 2048 && height <= 2048 ? value : null;
  }
  if (match[1] === "jpeg" && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2, dimensionsValid = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) return null;
        const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
        if (!width || !height || width > 2048 || height > 2048) return null;
        dimensionsValid = true;
      }
      // A raster frame and scan must exist; dimensions are bounded before any decoding.
      if (marker === 218) return dimensionsValid && offset + length < bytes.length - 2 ? value : null;
      offset += length;
    }
  }
  return null;
}

export function brandedQrConfiguration(business, appOrigin, source = null) {
  const branding = business.customer_branding_json ?? {};
  const primary = color(branding.primary_color, FALLBACK_INK);
  const logo = portableLogo(branding.customer_logo_url);
  return {
    ok: true,
    business: { id: business.id, name: business.name, slug: business.slug },
    registration_url: source ? acquisitionSourceUrl(business, appOrigin, source) : `${new URL(appOrigin).origin}/registro/${encodeURIComponent(business.slug)}`,
    branding: {
      primary_color: primary,
      accent_color: color(branding.accent_color, "#F0DDA5"),
      logo_included: Boolean(logo),
      logo_note: logo ? "El logotipo se coloca en el centro del código QR de forma predeterminada." : branding.customer_logo_url
        ? "El logotipo está alojado fuera de PuntosFieles. Este archivo incluye el nombre y los colores de tu negocio, sin el logotipo externo."
        : "Este archivo usa el nombre y los colores de tu negocio. No hay un logotipo incorporado.",
    },
    defaults: { foreground: contrastOnWhite(primary) >= 4.5 ? primary : FALLBACK_INK, logo_position: "center" },
    capabilities: { error_correction: "H", quiet_zone_modules: QUIET_ZONE, minimum_contrast: 4.5, logo_positions: [...LOGO_POSITIONS] },
  };
}

/** @param {any} business @param {string} appOrigin @param {{ foreground?: string, logo_position?: "center"|"header"|"none", logo_data_url?: string|null }} options */
export function renderBrandedQr(business, appOrigin, { foreground, logo_position = "center", logo_data_url } = {}, source = null) {
  const configuration = brandedQrConfiguration(business, appOrigin, source);
  const ink = foreground === undefined ? configuration.defaults.foreground : color(foreground, null);
  if (!ink) throw badRequest("El color debe usar el formato #RRGGBB.");
  if (contrastOnWhite(ink) < 4.5) throw badRequest("Elige un color más oscuro: el QR necesita un contraste mínimo de 4.5:1 sobre blanco.");
  if (!LOGO_POSITIONS.includes(logo_position)) throw badRequest("Elige la posición del logotipo: centro, encabezado o sin logotipo.");
  const logo = logo_data_url === undefined ? portableLogo(business.customer_branding_json?.customer_logo_url) : portableLogo(logo_data_url);
  if (logo_data_url !== undefined && logo_data_url !== null && !logo) throw badRequest("El logotipo debe ser una imagen PNG o JPEG incorporada, de hasta 2048 × 2048 píxeles y 180,000 caracteres.");
  const qr = QRCode.create(configuration.registration_url, { errorCorrectionLevel: "H" });
  const size = qr.modules.size, dimension = size + QUIET_ZONE * 2;
  let path = "";
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (!qr.modules.get(row, column)) continue;
      const start = column;
      while (column + 1 < size && qr.modules.get(row, column + 1)) column++;
      path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${column - start + 1}v1H${start + QUIET_ZONE}z`;
    }
  }
  const headerLogo = logo_position === "header" ? logo : null;
  // Keep the entire obstruction, including its white padding, within 18% of
  // the code width. The quiet zone and finder patterns remain untouched.
  const backingSize = Number((size * 0.18).toFixed(3));
  const backingStart = Number(((dimension - backingSize) / 2).toFixed(3));
  const padding = backingSize * 0.15;
  const logoStart = Number((backingStart + padding).toFixed(3));
  const logoSize = Number((backingSize - padding * 2).toFixed(3));
  const centerLogo = logo && logo_position === "center" ? `<g data-logo-position="center">
<rect x="${backingStart}" y="${backingStart}" width="${backingSize}" height="${backingSize}" rx="${Number((backingSize * 0.08).toFixed(3))}" fill="#FFFFFF"/>
<image x="${logoStart}" y="${logoStart}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" href="${logo}"/>
</g>` : "";
  const name = Array.from(String(business.name || "Mi negocio").replace(/\s+/g, " ").trim());
  const shortName = name.length > 60 ? `${name.slice(0, 59).join("")}…` : name.join("");
  const nameSize = shortName.length > 35 ? 18 : shortName.length > 23 ? 22 : 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="680" viewBox="0 0 480 680" role="img" aria-labelledby="qr-title qr-description">
<title id="qr-title">QR de inscripción de ${xml(business.name)}</title>
<desc id="qr-description">Escanea para registrarte en el programa de ${xml(business.name)}.</desc>
<rect width="480" height="680" fill="#FFFFFF"/>
<rect x="18" y="18" width="444" height="644" rx="14" fill="#FFFFFF" stroke="${ink}"/>
<path d="M40 32H440" stroke="${configuration.branding.accent_color}" stroke-width="8"/>
${headerLogo ? `<image x="204" y="48" width="72" height="72" preserveAspectRatio="xMidYMid meet" href="${headerLogo}"/>` : ""}
<text x="240" y="${headerLogo ? 154 : 106}" text-anchor="middle" fill="${ink}" font-family="Bricolage Grotesque, sans-serif" font-size="${nameSize}" font-weight="700"${shortName.length > 40 ? ' textLength="384" lengthAdjust="spacingAndGlyphs"' : ""}>${xml(shortName)}</text>
${headerLogo ? "" : `<text x="240" y="139" text-anchor="middle" fill="${FALLBACK_INK}" font-family="Inter, sans-serif" font-size="16">Tu próxima visita empieza aquí</text>`}
<svg x="50" y="178" width="380" height="380" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">
<rect width="${dimension}" height="${dimension}" fill="#FFFFFF"/>
<path fill="${ink}" d="${path}"/>
${centerLogo}
</svg>
<text x="240" y="595" text-anchor="middle" fill="${ink}" font-family="Bricolage Grotesque, sans-serif" font-size="24" font-weight="700">Escanea y regístrate</text>
<text x="240" y="625" text-anchor="middle" fill="${FALLBACK_INK}" font-family="Inter, sans-serif" font-size="15">Únete a nuestro programa de puntos</text>
</svg>`;
}
