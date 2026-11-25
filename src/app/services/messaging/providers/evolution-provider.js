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
 *   EVOLUTION_BASE_URL?: string,
 *   EVOLUTION_API_KEY?: string,
 *   EVOLUTION_INSTANCE?: string,
 *   MESSAGE_PROVIDER_TIMEOUT_MS?: unknown,
 * }} EvolutionConfig
 */

/** @param {{ config: EvolutionConfig, fetchImpl?: typeof fetch }} options */
export function createEvolutionProvider({ config, fetchImpl = fetch }) {
  const instance = String(config.EVOLUTION_INSTANCE || "").trim();
  const url = providerUrl(
    config.EVOLUTION_BASE_URL,
    `message/sendText/${encodeURIComponent(instance)}`,
  );
  const ready = Boolean(url && instance && config.EVOLUTION_API_KEY?.trim());
  return {
    name: "evolution",
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
        headers: { apikey: config.EVOLUTION_API_KEY },
        payload: { number: phone, text: body },
        timeoutMs: config.MESSAGE_PROVIDER_TIMEOUT_MS,
        fetchImpl,
      });
      return { ok: true, providerId: providerReceipt("evolution", data?.key?.id) };
    },
  };
}
