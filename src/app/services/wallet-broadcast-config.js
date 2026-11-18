// Platform-owned wallet-broadcast policy.
//
// PuntosFieles sends every business's wallet pushes through ONE shared Apple Pass
// Type ID certificate and ONE Google Wallet issuer account. A single tenant that
// blasts broadcasts could get that shared account throttled or (on abuse patterns)
// banned, which would break wallet delivery for every business at once. So the
// platform owner — not the merchant — decides per business whether campaign
// broadcasts may use the wallet channel, and the ceilings below hold even at the
// maximum a business could request.
//
// These are deliberately conservative. The per-customer cross-channel frequency cap
// (marketing-frequency-service, default 7 days) already limits any one pass to about
// one notifying push per week, far under Google's hard 3-per-pass/24h quota; these
// per-business caps are the second guard, bounding total broadcast volume and cost.

export const WALLET_BROADCAST_DAILY_CEIL = 1; // at most 1 broadcast per business / 24h
export const WALLET_BROADCAST_MONTHLY_CEIL = 4; // at most 4 broadcasts per business / calendar month
export const CHANNEL_POLICIES = ["wallet_first_sms_fallback", "wallet_only", "sms_only"];
export const DEFAULT_CHANNEL_POLICY = "wallet_first_sms_fallback";

function clampCap(value, ceiling) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return ceiling;
  return Math.min(n, ceiling);
}

/**
 * Resolve the effective wallet-broadcast settings for one business from the
 * platform-owned settings map (`platform_settings.wallet_broadcast_settings`).
 * A business absent from the map is NOT opted in. Configured caps are clamped to
 * the platform ceilings so a per-business override can only ever lower the limit.
 * Defensive against malformed stored JSON: any non-object input yields safe defaults.
 * @param {any} settingsMap
 * @param {string} businessId
 */
export function resolveWalletBroadcast(settingsMap, businessId) {
  const raw = (settingsMap && typeof settingsMap === "object" && settingsMap[businessId]) || null;
  const channelPolicy = CHANNEL_POLICIES.includes(raw?.channel_policy) ? raw.channel_policy : DEFAULT_CHANNEL_POLICY;
  return {
    enabled: raw?.enabled === true,
    dailyCap: clampCap(raw?.daily_cap, WALLET_BROADCAST_DAILY_CEIL),
    monthlyCap: clampCap(raw?.monthly_cap, WALLET_BROADCAST_MONTHLY_CEIL),
    channelPolicy
  };
}

/**
 * Pure per-recipient channel decision for a campaign broadcast. Wallet is tried only
 * when the business is opted in, the recipient holds a pass, and the policy permits
 * wallet; SMS is a fallback only when the policy permits phone and a number exists.
 * `wallet_only` never falls back to paid SMS; `sms_only` never uses wallet.
 * @param {{enabled:boolean, channelPolicy:string, hasPass:boolean, hasPhone:boolean}} input
 * @returns {{tryWallet:boolean, smsFallback:boolean}}
 */
export function walletBroadcastDelivery({ enabled, channelPolicy, hasPass, hasPhone }) {
  const policy = CHANNEL_POLICIES.includes(channelPolicy) ? channelPolicy : DEFAULT_CHANNEL_POLICY;
  return {
    tryWallet: enabled === true && hasPass === true && policy !== "sms_only",
    smsFallback: policy !== "wallet_only" && hasPhone === true
  };
}
