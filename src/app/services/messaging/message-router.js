import { MessageProviderError } from './providers/http-provider.js';

/**
 * @typedef {{
 *   channel: string,
 *   strictAcceptance?: boolean,
 *   body: string,
 *   subject?: string | null,
 *   text?: string | null,
 *   html?: string | null,
 *   destinations: { phone?: string | null, email?: string | null }
 * }} RoutedMessage
 */

/**
 * @typedef {{
 *   name: string,
 *   canSend: (message: RoutedMessage) => boolean,
 *   send: (message: RoutedMessage) => Promise<{ ok?: boolean, providerId?: string | null }>
 * }} MessageProvider
 */

/**
 * @param {{
 *   order: string[],
 *   providers: Record<string, MessageProvider>
 * }} params
 */
export function createMessageRouter({ order, providers }) {
  return {
    canSend(message) { return order.some(name => Boolean(providers[name]?.canSend(message))); },
    /**
     * @param {RoutedMessage} message
     */
    async send(message) {
      const attempts = [];
      for (const name of order) {
        const provider = providers[name];
        if (!provider || !provider.canSend(message)) continue;
        attempts.push(name);
        try {
          const out = await provider.send(message);
          if (out?.ok === false) continue;
          return {
            ok: true,
            attempts,
            provider: name,
            providerId: out?.providerId ?? name
          };
        } catch (error) {
          // Do not send a second copy when a provider may have accepted the first.
          if (error instanceof MessageProviderError && error.deliveryUncertain) {
            return { ok: false, attempts, error: "DELIVERY_UNCERTAIN" };
          }
          if (message.strictAcceptance && !(error instanceof MessageProviderError)) {
            return { ok: false, attempts, error: "DELIVERY_UNCERTAIN" };
          }
          // Definitive failures retain the existing configured fallback behavior.
        }
      }
      return { ok: false, attempts, error: "NO_DELIVERY_PROVIDER" };
    }
  };
}
