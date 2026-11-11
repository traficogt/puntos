import { clearRewardEntitlements, loadRewardEntitlements } from "./reward-entitlements.js";
import { clearGrowthOffers, loadGrowthOffers } from "./growth-offers.js";
import { clearCustomerCache, getCustomerCacheSnapshot, putCustomerCache } from "/idb.js";
import { setHidden } from "/lib.js";
import { setOnlineBadge } from "./network.js";
import { renderFromMe } from "./me.js";
import { clearWalletView, getCustomerEpoch, getCustomerIdentity, invalidateCustomerIdentity, isCustomerAuthError, readCustomerStorage, rememberCustomerIdentity } from "./session.js";

let latestLoad = 0;

function isNetworkFailure(error) {
  if (error?.status || error?.code) return false;
  return !navigator.onLine || /NetworkError|Failed to fetch|Load failed|abort/i.test(String(error?.message || ""));
}

export async function loadAll({ api, $, toast, silent = false }) {
  const loadId = ++latestLoad;
  let epoch = getCustomerEpoch();
  const isCurrent = () => loadId === latestLoad && epoch === getCustomerEpoch();
  setOnlineBadge($);
  clearGrowthOffers($);
  clearRewardEntitlements($);
  const identity = getCustomerIdentity();
  const cachedSlug = identity?.slug || readCustomerStorage("pf_customer_slug").trim();
  if (readCustomerStorage("pf_customer_blocked") === "1") {
    clearWalletView($);
    setHidden($("#needLogin"), false);
    return { status: "auth" };
  }

  try {
    const me = await api("/api/customer/me");
    if (!isCurrent()) return { status: "superseded" };
    if (!me?.business?.id || !me?.customer?.id) throw new Error("Respuesta de tarjeta inválida");
    const currentIdentity = rememberCustomerIdentity(me);
    epoch = getCustomerEpoch();
    await putCustomerCache("me", me, currentIdentity).catch(() => {});
    if (!isCurrent()) return { status: "superseded" };
    const snapshot = await getCustomerCacheSnapshot(currentIdentity).catch(() => null);
    if (!isCurrent()) return { status: "superseded" };
    const result = await renderFromMe({ api, $, toast, isCurrent, identity: currentIdentity }, me, true, snapshot);
    if (!isCurrent()) return { status: "superseded" };
    await Promise.all([loadGrowthOffers({ api, $, isCurrent, region: me.business.region }), loadRewardEntitlements({ api, $, isCurrent })]);
    if (!isCurrent()) return { status: "superseded" };
    if (!silent) toast(result?.status === "partial" ? "Algunos datos no se pudieron actualizar. Intenta de nuevo." : "Tarjeta actualizada.");
    return result || { status: "live" };
  } catch (error) {
    if (!isCurrent()) return { status: "superseded" };
    if (isCustomerAuthError(error)) {
      invalidateCustomerIdentity();
      clearWalletView($);
      await clearCustomerCache().catch(() => {});
      if (cachedSlug) {
        location.href = `/ingresar/${encodeURIComponent(cachedSlug)}?motivo=sesion-vencida`;
        return { status: "auth" };
      }
      setHidden($("#needLogin"), false);
      const subtitle = $("#customerEntrySubtitle");
      if (subtitle) subtitle.textContent = "No tienes una sesión activa. Entra desde el acceso del negocio para abrir tu tarjeta.";
      return { status: "auth" };
    }

    if (isNetworkFailure(error) && identity) {
      const snapshot = await getCustomerCacheSnapshot(identity).catch(() => null);
      if (!isCurrent()) return { status: "superseded" };
      const me = snapshot?.sections?.me;
      if (me?.business?.id === identity.businessId && me?.customer?.id === identity.customerId) {
        await renderFromMe({ api, $, toast, isCurrent, identity }, me, false, snapshot);
        return { status: "offline" };
      }
    }

    clearWalletView($);
    setHidden($("#needLogin"), false);
    const subtitle = $("#customerEntrySubtitle");
    if (subtitle) subtitle.textContent = "No pudimos cargar tu tarjeta. Revisa tu conexión e intenta actualizar de nuevo.";
    if (!silent) toast("No se pudo actualizar la tarjeta.");
    return { status: "error" };
  }
}
