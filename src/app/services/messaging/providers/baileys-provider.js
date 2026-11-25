import { sendProviderJson, providerReceipt } from "./http-provider.js";

/** @typedef {import("../message-router.js").RoutedMessage} RoutedMessage */
/**
 * @typedef {{
 *   BAILEYS_SEND_URL?: string,
 *   BAILEYS_BASE_URL?: string,
 *   BAILEYS_API_KEY?: string,
 *   MESSAGE_PROVIDER_TIMEOUT_MS?: unknown,
 * }} BaileysConfig
 */

/** @param {{ config: BaileysConfig, fetchImpl?: typeof fetch }} options */
export function createBaileysProvider({ config, fetchImpl = fetch }) {
  return {
    name: "baileys",
    /** @param {Pick<RoutedMessage, "destinations">} message */
    canSend({ destinations }) {
      return Boolean(destinations?.phone && (config.BAILEYS_SEND_URL || config.BAILEYS_BASE_URL));
    },
    /** @param {Pick<RoutedMessage, "destinations" | "body">} message */
    async send({ destinations, body }) {
      const url =
        String(config.BAILEYS_SEND_URL || "").trim() ||
        new URL("/send-message", config.BAILEYS_BASE_URL).toString();
      const data = await sendProviderJson({
        url,
        fetchImpl,
        timeoutMs: config.MESSAGE_PROVIDER_TIMEOUT_MS,
        headers: config.BAILEYS_API_KEY
          ? { Authorization: `Bearer ${config.BAILEYS_API_KEY}` }
          : {},
        payload: { to: destinations.phone, body, text: body },
      });
      return { ok: true, providerId: providerReceipt("baileys", data?.id ?? data?.messageId) };
    },
  };
}
