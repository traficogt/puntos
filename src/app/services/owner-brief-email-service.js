import { createSmtpProvider } from "./messaging/providers/smtp-provider.js";
import { config } from "../../config/index.js";
import { isErrorLike } from "../../utils/error-shape.js";
export const ownerBriefEmailReady = () => Boolean(config.SMTP_HOST && config.SMTP_FROM);

/**
 * The message handed to the SMTP provider (./messaging/providers/smtp-provider.js).
 * @typedef {{ destinations: { email: string, phone: null }, body: string, subject: string, strictAcceptance: boolean }} OwnerBriefEmailMessage
 *
 * The provider surface this service uses; tests inject fakes.
 * @typedef {{
 *   canSend: (message: Pick<OwnerBriefEmailMessage, "destinations">) => boolean,
 *   send: (message: OwnerBriefEmailMessage) => Promise<{ ok?: boolean, providerId?: string | null }>
 * }} OwnerBriefEmailProvider
 *
 * @typedef {{
 *   ok?: boolean,
 *   accepted?: boolean,
 *   provider?: string,
 *   providerId?: string | null,
 *   definiteFailure?: boolean,
 *   error?: string
 * }} OwnerBriefEmailOutcome
 */

// Dedicated SMTP delivery avoids simulated acceptance and phone-provider fallbacks.
/**
 * @param {{ to: string, body: string, subject?: string }} message
 * @param {{ provider?: OwnerBriefEmailProvider }} [injected]
 * @returns {Promise<OwnerBriefEmailOutcome>}
 */
export async function sendOwnerBriefEmail(
  { to, body, subject = "PuntosFieles · Tu resumen semanal" },
  injected = {},
) {
  /** @type {OwnerBriefEmailProvider} */
  const provider = injected.provider ?? createSmtpProvider({ config });
  if (!provider.canSend({ destinations: { email: to, phone: null } }))
    return { ok: false, definiteFailure: true, error: "NO_DELIVERY_PROVIDER" };
  try {
    const result = await provider.send({
      destinations: { email: to, phone: null },
      body,
      subject,
      strictAcceptance: true,
    });
    return { ...result, accepted: true, provider: "smtp_email" };
  } catch (error) {
    return {
      ok: false,
      definiteFailure: isErrorLike(error) && error.deliveryUncertain === false,
      error: "DELIVERY_UNCERTAIN",
    };
  }
}
