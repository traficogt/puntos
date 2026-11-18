import { NativeWalletRepo } from "../repositories/native-wallet-repository.js";

// Lifecycle automations prefer the free wallet-push channel when the customer holds an
// active pass. We set a transient, self-expiring message on the pass and mark it due; the
// wallet worker (processDue) delivers the Apple/Google push on its next tick. Marketing
// consent and the frequency/quiet-hour guardrails are enforced upstream in the outbox
// dispatch, exactly as for the SMS path, so this function only performs the delivery.
export const WALLET_MESSAGE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * @param {{ businessId: string, customerId: string, body: string, now?: () => Date, ttlMs?: number,
 *   repo?: { queueWalletMessage: (args: { businessId: string, customerId: string, message: string, expiresAt: Date }) => Promise<Array<{ id: string, provider: string }>> } }} params
 */
export async function deliverLifecycleWalletMessage({
  businessId,
  customerId,
  body,
  now = () => new Date(),
  ttlMs = WALLET_MESSAGE_TTL_MS,
  repo = NativeWalletRepo
}) {
  const expiresAt = new Date(now().getTime() + ttlMs);
  const passes = await repo.queueWalletMessage({ businessId, customerId, message: body, expiresAt });
  if (!passes.length) return null;
  // Shaped like a messaging-service success so classifyCampaignSend records it accepted.
  return { ok: true, accepted: true, provider: "wallet", providerId: "wallet", id: null, walletPasses: passes.length };
}
