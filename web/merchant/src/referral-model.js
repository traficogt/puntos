import {merchantRegion} from './region.js';
export function editableReferralSettings(settings) {
  return {
    enabled: settings.enabled === true,
    referrer_reward_points: Number(settings.referrer_reward_points),
    referred_reward_points: Number(settings.referred_reward_points),
    min_purchase_to_complete:
      settings.min_purchase_to_complete == null
        ? 0
        : Number(settings.min_purchase_to_complete),
    reward_on_signup: settings.reward_on_signup === true,
    custom_message: settings.custom_message ?? null,
  };
}

export function validateReferralSettings(values) {
  for (const key of ["referrer_reward_points", "referred_reward_points"]) {
    if (
      typeof values[key] !== "number" ||
      !Number.isInteger(values[key]) ||
      values[key] < 0 ||
      values[key] > 100000
    )
      return "Usa puntos enteros entre 0 y 100,000 para cada persona.";
  }
  const minimum = values.min_purchase_to_complete;
  if (
    typeof minimum !== "number" ||
    !Number.isFinite(minimum) ||
    minimum < 0 ||
    minimum > 99999999.99 ||
    Math.abs(minimum * 100 - Math.round(minimum * 100)) > 0.000001
  )
    return "Usa un importe acumulado entre 0 y 99,999,999.99 en la moneda del negocio, con hasta dos decimales.";
  if (
    typeof values.enabled !== "boolean" ||
    typeof values.reward_on_signup !== "boolean"
  )
    return "Revisa la activación y el momento de entrega del premio.";
  return null;
}

export function referralPayload(values) {
  return {
    ...values,
    min_purchase_to_complete: values.min_purchase_to_complete || null,
  };
}

export function referralTriggerText(values, region=merchantRegion()) {
  if (values.reward_on_signup)
    return "Los bonos se entregan cuando se aplica el código de recomendación al registro. No se exige una compra.";
  if (Number(values.min_purchase_to_complete) > 0) {
    const amount = new Intl.NumberFormat(region.locale, {
      style: "currency",
      currency: region.currency,
    }).format(Number(values.min_purchase_to_complete));
    return `Los bonos se evalúan al procesar una compra, cuando el importe acumulado registrado del cliente llega a ${amount}. No es un mínimo por ticket.`;
  }
  return "Los bonos se evalúan al procesar una compra del cliente recomendado, sin un importe acumulado mínimo.";
}

export function enrollmentLink(data, businessId) {
  try {
    const url = new URL(data.registration_url);
    if (
      data.business?.id !== businessId ||
      !data.business?.slug ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/registro/${encodeURIComponent(data.business.slug)}`
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}
