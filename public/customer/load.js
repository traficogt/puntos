import { clearCustomerCache, getCustomerCacheSnapshot, putCustomerCache } from "/idb.js";
import { setHidden } from "/lib.js";
import { setOnlineBadge } from "./network.js";
import { renderFromMe } from "./me.js";

/** @typedef {import("../types.js").CustomerMeResponse} CustomerMeResponse */

/**
 * @param {(selector: string) => Element | null} $
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function safeEl($, id) {
  return /** @type {HTMLElement | null} */ ($(id));
}

function isAuthError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "AUTH_REQUIRED"
    || code === "AUTH_INVALID_TOKEN"
    || code === "FORBIDDEN"
    || /No autenticado|Token invalido|No autorizado/.test(message);
}

function isNetworkFailure(error) {
  const message = String(error?.message || "");
  return !navigator.onLine || /NetworkError|Failed to fetch|fetch|abort/i.test(message);
}

export async function loadAll({ api, $, toast }) {
  setOnlineBadge($);

  try {
    const me = /** @type {CustomerMeResponse} */ (await api("/api/customer/me"));
    await putCustomerCache("me", me);
    await renderFromMe({ api, $, toast }, me, true);
    return;
  } catch (error) {
    if (isAuthError(error) && navigator.onLine) {
      await clearCustomerCache().catch(() => {});
      const needLogin = safeEl($, "#needLogin");
      setHidden(needLogin, false);
      return;
    }

    if (isNetworkFailure(error)) {
      const snapshot = await getCustomerCacheSnapshot().catch(() => null);
      const me = snapshot?.sections?.me;
      if (me) {
        await renderFromMe({ api, $, toast }, /** @type {CustomerMeResponse} */ (me), false, snapshot);
        return;
      }
    }

    const needLogin = safeEl($, "#needLogin");
    setHidden(needLogin, false);
  }
}
