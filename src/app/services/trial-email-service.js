// Spanish trial emails (design section 7.5) with PF branding, sent through the dedicated
// SMTP provider with strict acceptance: the caller writes the trial_notifications marker
// only when the relay accepted the message, so a failed send retries the next day.
import { config } from "../../config/index.js";
import { createSmtpProvider } from "./messaging/providers/smtp-provider.js";
import { PLATFORM_EMAIL_BRANDING } from "./messaging/email-branding.js";
import {
  renderBaseEmailTemplate,
  renderHtmlParagraphs,
  renderTextParagraphs,
} from "./messaging/email-templates/base-template.js";
import { formatTrialDate, TRIAL_COPY } from "./trial-state.js";
import { isErrorLike } from "../../utils/error-shape.js";

export const trialEmailReady = () => Boolean(config.SMTP_HOST && config.SMTP_FROM);
/** @typedef {"welcome" | "day10" | "day13" | "locked" | "purge7"} TrialEmailKind */
export const TRIAL_EMAIL_KINDS = Object.freeze(["welcome", "day10", "day13", "locked", "purge7"]);

/**
 * @typedef {{
 *   businessName: string,
 *   panelUrl: string,
 *   joinUrl: string,
 *   planUrl: string,
 *   exportUrl: string,
 *   endsAt: Date | string | null,
 *   purgeAfter?: Date | string | null,
 *   timezone?: string,
 *   planName: string,
 *   priceUsd: number,
 *   progress?: { active_customers: number, genuine_awards: number, genuine_redemptions: number } | null
 * }} TrialEmailContext
 */
/**
 * The provider surface this service uses (./messaging/providers/smtp-provider.js); tests inject fakes.
 * @typedef {{
 *   canSend: (message: { destinations: { email: string, phone: null } }) => boolean,
 *   send: (message: {
 *     destinations: { email: string, phone: null }, body: string, subject: string, html: string, strictAcceptance: boolean
 *   }) => Promise<{ ok?: boolean, providerId?: string | null }>
 * }} TrialEmailProvider
 */
/** @typedef {{ ok: boolean, providerId?: string | null, definiteFailure?: boolean, error?: string }} TrialEmailOutcome */

/** @param {unknown} value */
const escape = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * @param {string} label
 * @param {string} url
 */
function button(label, url) {
  return `<p style="margin:20px 0 14px;"><a href="${escape(url)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:${PLATFORM_EMAIL_BRANDING.primaryColor};color:#FFFFFF;font-weight:700;text-decoration:none;">${escape(label)}</a></p>`;
}

/**
 * @param {TrialEmailKind} kind
 * @param {TrialEmailContext} ctx
 */
export function renderTrialEmail(kind, ctx) {
  const tz = ctx.timezone;
  const endDate = formatTrialDate(ctx.endsAt, tz);
  const purgeDate = formatTrialDate(ctx.purgeAfter ?? null, tz);
  const price = `${ctx.planName}: USD ${ctx.priceUsd} por sucursal al mes`;
  /** @type {{ subject: string, title: string, eyebrow: string, lines: string[], cta: { label: string, url: string } }} */
  let email;
  switch (kind) {
    case "welcome":
      email = {
        subject: "Tu prueba de PuntosFieles empezó",
        title: `Bienvenido, ${ctx.businessName}`,
        eyebrow: "Prueba de 14 días",
        lines: [
          `Tu prueba con ${ctx.planName} está activa hasta el ${endDate}. No pedimos tarjeta.`,
          "Qué hacer hoy: elige la regla de puntos, imprime tu QR e invita a tu equipo. En diez minutos tu primer cliente puede registrarse.",
          `Enlace de registro para tus clientes: ${ctx.joinUrl}`,
        ],
        cta: { label: "Abrir mi panel", url: ctx.panelUrl },
      };
      break;
    case "day10": {
      const p = ctx.progress;
      email = {
        subject: "Te quedan 4 días de prueba",
        title: "Te quedan 4 días de prueba",
        eyebrow: "Tu progreso",
        lines: [
          p
            ? `Hasta hoy: ${p.active_customers} ${p.active_customers === 1 ? "cliente registrado" : "clientes registrados"}, ${p.genuine_awards} ${p.genuine_awards === 1 ? "compra con puntos" : "compras con puntos"} y ${p.genuine_redemptions} ${p.genuine_redemptions === 1 ? "canje" : "canjes"}.`
            : "Revisa en tu panel cuántos clientes ya se registraron y cuántos puntos otorgaste.",
          `Tu prueba termina el ${endDate}. Para seguir sin pausa elige un plan: ${price}.`,
        ],
        cta: { label: TRIAL_COPY.banner_cta, url: ctx.planUrl },
      };
      break;
    }
    case "day13":
      email = {
        subject: "Mañana termina tu prueba",
        title: "Mañana termina tu prueba",
        eyebrow: "Último día",
        lines: [
          `El ${endDate} tu cuenta pasa a modo lectura: podrás ver clientes y reportes, tus clientes seguirán viendo su tarjeta, pero no se sumarán puntos nuevos ni se canjearán recompensas.`,
          `Elige un plan para que nada se detenga: ${price}.`,
        ],
        cta: { label: TRIAL_COPY.banner_cta, url: ctx.planUrl },
      };
      break;
    case "locked":
      email = {
        subject: "Tu prueba terminó",
        title: TRIAL_COPY.locked_title,
        eyebrow: "Modo lectura",
        lines: [
          TRIAL_COPY.locked_body,
          TRIAL_COPY.retention(purgeDate),
          `Puedes exportar tu lista de clientes desde el panel en cualquier momento: ${ctx.exportUrl}`,
        ],
        cta: { label: "Reactivar con un plan", url: ctx.planUrl },
      };
      break;
    case "purge7":
      email = {
        subject: `Tus datos se eliminarán el ${purgeDate}`,
        title: `Tus datos se eliminarán el ${purgeDate}`,
        eyebrow: "Última llamada",
        lines: [
          `Tu prueba terminó y no elegiste un plan. El ${purgeDate} eliminaremos el negocio ${ctx.businessName}, sus clientes y su historial.`,
          `Si quieres conservarlos, elige un plan antes de esa fecha o exporta tus clientes ahora: ${ctx.exportUrl}`,
        ],
        cta: { label: TRIAL_COPY.banner_cta, url: ctx.planUrl },
      };
      break;
    default:
      throw new RangeError(`Unknown trial email kind: ${String(kind)}`);
  }
  const text = renderTextParagraphs([
    email.title,
    "",
    ...email.lines,
    "",
    `${email.cta.label}: ${email.cta.url}`,
    "",
    "PuntosFieles · https://puntosfieles.com/",
  ]);
  const html = renderBaseEmailTemplate({
    branding: PLATFORM_EMAIL_BRANDING,
    preheader: email.lines[0] ?? email.subject,
    title: email.title,
    eyebrow: email.eyebrow,
    bodyHtml: `${renderHtmlParagraphs(email.lines)}${button(email.cta.label, email.cta.url)}`,
    footerText: "Recibes este correo porque creaste una prueba de PuntosFieles.",
  });
  return { subject: email.subject, text, html };
}

/**
 * @param {{ to: string, kind: TrialEmailKind, context: TrialEmailContext }} message
 * @param {{ provider?: TrialEmailProvider }} [injected]
 * @returns {Promise<TrialEmailOutcome>}
 */
export async function sendTrialEmail({ to, kind, context }, injected = {}) {
  /** @type {TrialEmailProvider} */
  const provider = injected.provider ?? createSmtpProvider({ config });
  const destinations = { email: to, phone: /** @type {null} */ (null) };
  if (!provider.canSend({ destinations }))
    return { ok: false, definiteFailure: true, error: "NO_DELIVERY_PROVIDER" };
  const rendered = renderTrialEmail(kind, context);
  try {
    const result = await provider.send({
      destinations,
      body: rendered.text,
      subject: rendered.subject,
      html: rendered.html,
      strictAcceptance: true,
    });
    return { ok: result?.ok !== false, providerId: result?.providerId ?? null };
  } catch (error) {
    return {
      ok: false,
      definiteFailure: isErrorLike(error) && error.deliveryUncertain === false,
      error: "DELIVERY_UNCERTAIN",
    };
  }
}
