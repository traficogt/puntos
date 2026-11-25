import { sendProviderJson, providerReceipt } from "./http-provider.js";

/** @typedef {import("../message-router.js").RoutedMessage} RoutedMessage */
/**
 * @typedef {{
 *   WA_PHONE_NUMBER_ID?: string,
 *   WA_ACCESS_TOKEN?: string,
 *   WA_API_VERSION?: string,
 *   MESSAGE_PROVIDER_TIMEOUT_MS?: unknown,
 * }} WhatsAppCloudConfig
 */

/** @param {{ config: WhatsAppCloudConfig, fetchImpl?: typeof fetch }} options */
export function createWhatsAppCloudProvider({ config, fetchImpl = fetch }) {
  return {
    name: "whatsapp_cloud",
    /** @param {Pick<RoutedMessage, "destinations">} message */
    canSend({ destinations }) {
      return Boolean(destinations?.phone && config.WA_PHONE_NUMBER_ID && config.WA_ACCESS_TOKEN);
    },
    /** @param {Pick<RoutedMessage, "destinations" | "body">} message */
    async send({ destinations, body }) {
      const apiVersion = String(config.WA_API_VERSION || "v21.0").trim() || "v21.0";
      const url = `https://graph.facebook.com/${apiVersion}/${config.WA_PHONE_NUMBER_ID}/messages`;
      const data = await sendProviderJson({
        url,
        fetchImpl,
        timeoutMs: config.MESSAGE_PROVIDER_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${config.WA_ACCESS_TOKEN}` },
        payload: {
          messaging_product: "whatsapp",
          to: destinations.phone,
          type: "text",
          text: { body },
        },
      });
      return { ok: true, providerId: providerReceipt("whatsapp_cloud", data?.messages?.[0]?.id) };
    },
  };
}
