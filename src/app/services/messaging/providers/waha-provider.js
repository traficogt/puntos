import {
  internationalPhoneDigits,
  MessageProviderError,
  providerReceipt,
  providerUrl,
  sendProviderJson,
} from "./http-provider.js";

/** @typedef {import("../message-router.js").RoutedMessage} RoutedMessage */
/**
 * @typedef {{
 *   WAHA_BASE_URL?: string,
 *   WAHA_API_KEY?: string,
 *   WAHA_SESSION?: string,
 *   MESSAGE_PROVIDER_TIMEOUT_MS?: unknown,
 * }} WahaConfig
 */

/** @param {{ config: WahaConfig, fetchImpl?: typeof fetch }} options */
export function createWahaProvider({ config, fetchImpl = fetch }) {
  const url = providerUrl(config.WAHA_BASE_URL, "api/sendText");
  const ready = Boolean(url && config.WAHA_API_KEY?.trim());
  return {
    name: "waha",
    /** @param {Pick<RoutedMessage, "destinations">} message */
    canSend({ destinations }) {
      return Boolean(ready && internationalPhoneDigits(destinations?.phone));
    },
    /** @param {Pick<RoutedMessage, "destinations" | "body">} message */
    async send({ destinations, body }) {
      const phone = internationalPhoneDigits(destinations?.phone);
      if (!ready || !phone) throw new MessageProviderError("MESSAGE_PROVIDER_NOT_READY");
      const data = await sendProviderJson({
        url,
        headers: { "X-Api-Key": config.WAHA_API_KEY },
        payload: { session: config.WAHA_SESSION || "default", chatId: `${phone}@c.us`, text: body },
        timeoutMs: config.MESSAGE_PROVIDER_TIMEOUT_MS,
        fetchImpl,
      });
      const messageId =
        typeof data?.id === "string"
          ? data.id
          : (data?.id?._serialized ?? data?.id?.id ?? data?.messageId);
      return { ok: true, providerId: providerReceipt("waha", messageId) };
    },
  };
}
