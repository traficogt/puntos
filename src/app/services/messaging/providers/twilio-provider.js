import { sendProviderJson, providerReceipt } from "./http-provider.js";

/** @typedef {import("../message-router.js").RoutedMessage} RoutedMessage */
/**
 * @typedef {{
 *   TWILIO_ACCOUNT_SID?: string,
 *   TWILIO_AUTH_TOKEN?: string,
 *   TWILIO_WHATSAPP_FROM?: string,
 *   MESSAGE_PROVIDER_TIMEOUT_MS?: unknown,
 * }} TwilioConfig
 */

/** @param {{ config: TwilioConfig, fetchImpl?: typeof fetch }} options */
export function createTwilioProvider({ config, fetchImpl = fetch }) {
  return {
    name: "twilio",
    /** @param {Pick<RoutedMessage, "destinations">} message */
    canSend({ destinations }) {
      return Boolean(
        destinations?.phone &&
        config.TWILIO_ACCOUNT_SID &&
        config.TWILIO_AUTH_TOKEN &&
        config.TWILIO_WHATSAPP_FROM,
      );
    },
    /** @param {Pick<RoutedMessage, "destinations" | "body">} message */
    async send({ destinations, body }) {
      const sid = String(config.TWILIO_ACCOUNT_SID || "").trim();
      const token = String(config.TWILIO_AUTH_TOKEN || "").trim();
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const data = await sendProviderJson({
        url,
        fetchImpl,
        timeoutMs: config.MESSAGE_PROVIDER_TIMEOUT_MS,
        form: true,
        headers: { Authorization: `Basic ${auth}` },
        payload: {
          To: `whatsapp:${destinations.phone}`,
          From: String(config.TWILIO_WHATSAPP_FROM || "").startsWith("whatsapp:")
            ? config.TWILIO_WHATSAPP_FROM
            : `whatsapp:${config.TWILIO_WHATSAPP_FROM}`,
          Body: body,
        },
      });
      return { ok: true, providerId: providerReceipt("twilio", data?.sid) };
    },
  };
}
