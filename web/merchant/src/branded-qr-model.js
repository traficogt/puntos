export function validateQrForeground(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    return "Escribe un color de seis dígitos, por ejemplo #302820.";
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const contrast = 1.05 / (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 + 0.05);
  return contrast >= 4.5
    ? ""
    : "Elige un color más oscuro: se necesita un contraste mínimo de 4.5:1 sobre blanco.";
}

export function qrEnrollmentUrl(data, staff) {
  try {
    const url = new URL(data.registration_url);
    if (
      data.business?.id !== staff.business_id ||
      !data.business?.slug ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== `/registro/${encodeURIComponent(data.business.slug)}`
    ) return "";
    return url.href;
  } catch { return ""; }
}

export function qrSourceEnrollmentUrl(data, staff, sourceId) {
  const base = qrEnrollmentUrl(data, staff);
  if (!base || !sourceId) return base;
  const source = data.sources?.find(item => item.id === sourceId);
  if (!source || source.business_id !== staff.business_id || !/^[A-Za-z0-9_-]{16}$/.test(source.code || "")) return "";
  const url = new URL(base);
  url.searchParams.set("origen", source.code);
  return url.href;
}

export function brandedQrPath(foreground, logoPosition, sourceId) {
  return `/api/admin/customer-enrollment/branded-qr.svg?${new URLSearchParams({ foreground, ...(logoPosition ? { logo_position: logoPosition } : {}), ...(sourceId ? { source_id: sourceId } : {}) })}`;
}
