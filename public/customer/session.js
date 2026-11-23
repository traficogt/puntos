import { SESSION_SCOPES, newEpochId } from "../session-epoch.js";

const viewCleanups = new Set();
export function onCustomerViewClear(callback) {
  viewCleanups.add(callback);
  return () => viewCleanups.delete(callback);
}
const IDENTITY_KEY = "pf_customer_identity";
const EPOCH_KEY = SESSION_SCOPES.customer.epoch;
const memoryStorage = new Map();
let observedStorageEpoch;

export function readCustomerStorage(key) {
  try {
    const epoch = localStorage.getItem(EPOCH_KEY) || "";
    // A different tab's session supersedes local fallbacks, even when this tab
    // could not persist its own logout or verification.
    if (observedStorageEpoch !== undefined && epoch !== observedStorageEpoch) memoryStorage.clear();
    observedStorageEpoch = epoch;
    const stored = key === EPOCH_KEY ? epoch : localStorage.getItem(key) || "";
    const memory = memoryStorage.get(key);
    if (memory && (memory.stored === undefined || memory.stored === stored)) {
      memory.stored = stored;
      return memory.value;
    }
    memoryStorage.delete(key);
    return stored;
  } catch {
    return memoryStorage.get(key)?.value || "";
  }
}

function writeCustomerStorage(key, value) {
  let stored;
  try {
    stored = localStorage.getItem(key) || "";
  } catch {
    /* Reads may also be restricted. */
  }
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    stored = value;
  } catch {
    /* Keep this tab's session state when storage is full or restricted. */
  }
  memoryStorage.set(key, { value, stored });
  if (key === EPOCH_KEY && stored !== undefined) observedStorageEpoch = stored;
}

export function getCustomerEpoch() {
  return readCustomerStorage(EPOCH_KEY);
}

export function getCustomerIdentity() {
  try {
    const identity = JSON.parse(readCustomerStorage(IDENTITY_KEY));
    if (
      typeof identity?.businessId !== "string" ||
      !identity.businessId ||
      typeof identity?.customerId !== "string" ||
      !identity.customerId
    )
      return null;
    return {
      businessId: identity.businessId,
      customerId: identity.customerId,
      slug: String(identity.slug || ""),
    };
  } catch {
    return null;
  }
}

export function invalidateCustomerIdentity({ block = false } = {}) {
  getCustomerEpoch();
  writeCustomerStorage(EPOCH_KEY, newEpochId());
  writeCustomerStorage(IDENTITY_KEY, "");
  writeCustomerStorage("pf_phone", "");
  writeCustomerStorage("pf_customer_blocked", block ? "1" : "");
}

export function rememberCustomerIdentity(me) {
  const identity = {
    businessId: String(me.business.id),
    customerId: String(me.customer.id),
    slug: String(me.business.slug || ""),
  };
  const previous = getCustomerIdentity();
  if (
    previous &&
    (previous.businessId !== identity.businessId || previous.customerId !== identity.customerId)
  )
    invalidateCustomerIdentity();
  writeCustomerStorage(IDENTITY_KEY, JSON.stringify(identity));
  writeCustomerStorage("pf_customer_slug", identity.slug);
  return identity;
}

export function isCustomerAuthError(error) {
  const code = String(error?.code || "");
  return (
    error?.status === 401 ||
    code.startsWith("AUTH_") ||
    code === "CUSTOMER_NOT_FOUND" ||
    /^(No autenticado|Token invalido|Customer not found)(?:\s|$)/i.test(
      String(error?.message || ""),
    )
  );
}

export function clearWalletView($) {
  for (const cleanup of viewCleanups) cleanup();
  $("#customerStatement")?.replaceChildren();
  for (const selector of [
    "#rewardEntitlementsSection",
    "#growthOffersSection",
    "#main",
    "#btnLogout",
    "#tierSection",
    "#referralsSection",
    "#achievementsSection",
    "#billeteras",
    "#nativeWalletConfirm",
  ]) {
    const element = $(selector);
    if (element) {
      element.hidden = true;
      element.classList.toggle("is-hidden", true);
    }
  }
  for (const selector of [
    "#rewardEntitlements",
    "#growthOffers",
    "#who",
    "#points",
    "#pendingPoints",
    "#lifetime",
    "#lastVisit",
    "#bizName",
    "#nextReward",
    "#nextRewardBalance",
    "#nextRewardConditions",
    "#nextRewardEarning",
    "#tx",
    "#red",
    "#qrExp",
    "#qrHint",
    "#syncBadge",
    "#rewards",
    "#achievements",
    "#referralStats",
    "#tierPerks",
    "#qrWrap",
    "#nativeWalletStatus",
  ]) {
    const element = $(selector);
    if (element) element.replaceChildren();
  }
  const referralCode = $("#referralCode");
  if (referralCode) referralCode.value = "";
  const nativeWallet = $("#billeteras");
  if (nativeWallet?.dataset) nativeWallet.dataset.nativeWalletOwner = "";
}
