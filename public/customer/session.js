const viewCleanups = new Set();
export function onCustomerViewClear(callback) {
  viewCleanups.add(callback);
  return () => viewCleanups.delete(callback);
}
const IDENTITY_KEY = "pf_customer_identity";
const EPOCH_KEY = "pf_customer_epoch";
let memoryEpoch = "";

export function readCustomerStorage(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function getCustomerEpoch() {
  try { return localStorage.getItem(EPOCH_KEY) || ""; } catch { return memoryEpoch; }
}

export function getCustomerIdentity() {
  try {
    const identity = JSON.parse(readCustomerStorage(IDENTITY_KEY));
    if (typeof identity?.businessId !== "string" || !identity.businessId || typeof identity?.customerId !== "string" || !identity.customerId) return null;
    return { businessId: identity.businessId, customerId: identity.customerId, slug: String(identity.slug || "") };
  } catch { return null; }
}

export function invalidateCustomerIdentity({ block = false } = {}) {
  memoryEpoch = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  try {
    localStorage.setItem(EPOCH_KEY, memoryEpoch);
    localStorage.removeItem(IDENTITY_KEY);
    localStorage.removeItem("pf_phone");
    if (block) localStorage.setItem("pf_customer_blocked", "1");
    else localStorage.removeItem("pf_customer_blocked");
  } catch { /* Restricted storage disables offline identity recovery. */ }
}

export function rememberCustomerIdentity(me) {
  const identity = { businessId: String(me.business.id), customerId: String(me.customer.id), slug: String(me.business.slug || "") };
  const previous = getCustomerIdentity();
  if (previous && (previous.businessId !== identity.businessId || previous.customerId !== identity.customerId)) invalidateCustomerIdentity();
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    localStorage.setItem("pf_customer_slug", identity.slug);
  } catch { /* A valid online wallet does not depend on local storage. */ }
  return identity;
}

export function isCustomerAuthError(error) {
  const code = String(error?.code || "");
  return error?.status === 401 || code.startsWith("AUTH_") || code === "CUSTOMER_NOT_FOUND"
    || /^(No autenticado|Token invalido|Customer not found)(?:\s|$)/i.test(String(error?.message || ""));
}

export function clearWalletView($) {
  for (const cleanup of viewCleanups) cleanup();
  $("#customerStatement")?.replaceChildren();
  for (const selector of ["#rewardEntitlementsSection", "#growthOffersSection", "#main", "#btnLogout", "#tierSection", "#referralsSection", "#achievementsSection", "#billeteras", "#nativeWalletConfirm"]) {
    const element = $(selector);
    if (element) { element.hidden = true; element.classList.toggle("is-hidden", true); }
  }
  for (const selector of ["#rewardEntitlements", "#growthOffers", "#who", "#points", "#pendingPoints", "#lifetime", "#lastVisit", "#bizName", "#nextReward", "#nextRewardBalance", "#nextRewardConditions", "#nextRewardEarning", "#tx", "#red", "#qrExp", "#qrHint", "#syncBadge", "#rewards", "#achievements", "#referralStats", "#tierPerks", "#qrWrap", "#nativeWalletStatus"]) {
    const element = $(selector);
    if (element) element.replaceChildren();
  }
  const referralCode = $("#referralCode");
  if (referralCode) referralCode.value = "";
  const nativeWallet = $("#billeteras");
  if (nativeWallet?.dataset) nativeWallet.dataset.nativeWalletOwner = "";
}
