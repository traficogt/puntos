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

export async function loadAll({ api, $, toast }) {
  setOnlineBadge($);

  try {
    const me = /** @type {CustomerMeResponse} */ (await api("/api/customer/me"));
    localStorage.setItem("pf_me", JSON.stringify(me));
    await renderFromMe({ api, $, toast }, me, true);
    return;
  } catch (_e) {
    const cached = localStorage.getItem("pf_me");
    if (cached) {
      try {
        const me = /** @type {CustomerMeResponse} */ (JSON.parse(cached));
        await renderFromMe({ api, $, toast }, me, false);
        return;
      } catch {}
    }
    const needLogin = safeEl($, "#needLogin");
    if (needLogin) needLogin.style.display = "block";
  }
}
