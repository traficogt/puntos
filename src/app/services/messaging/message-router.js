/**
 * @typedef {{
 *   channel: string,
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
          return {
            ok: true,
            attempts,
            provider: name,
            providerId: out?.providerId ?? name
          };
        } catch (_error) {
          // Fall through to the next configured provider.
        }
      }
      return { ok: false, attempts, error: "NO_DELIVERY_PROVIDER" };
    }
  };
}
