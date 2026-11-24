import { getCustomerEpoch } from "./session.js";

/** @typedef {import("../types.js").CustomerLoadResult} CustomerLoadResult */
/** @typedef {import("../types.js").CustomerQueryFn} CustomerQueryFn */

/**
 * Wallet links select a browser section; authentication is always checked separately.
 * @param {string} value
 */
export function walletDestination(value) {
  return value === "ofertas" || value === "beneficios" ? value : "";
}

/** @param {{ $: CustomerQueryFn }} deps */
export function createWalletNavigation({ $ }) {
  /** @type {string | undefined} */
  let observedHash;
  let pending = false;
  let ready = false;
  let readyEpoch = "";

  /**
   * @param {HTMLElement | null | undefined} element
   * @returns {element is HTMLElement}
   */
  const visible = (element) => Boolean(element && !element.closest("[hidden], .is-hidden"));

  function navigate() {
    const hash = location.hash || "";
    const destination = walletDestination(hash.slice(1));
    if (hash !== observedHash) {
      observedHash = hash;
      pending = Boolean(destination);
    }
    if (
      !pending ||
      !ready ||
      readyEpoch !== getCustomerEpoch() ||
      !navigator.onLine ||
      document.visibilityState === "hidden" ||
      !visible($("#main"))
    )
      return;

    const section = destination === "ofertas" ? $("#growthOffersSection") : $("#tierSection");
    const fallback = destination === "ofertas" ? $("#rewards")?.parentElement : $("#bizName");
    const target = visible(section) ? section : fallback;
    if (!visible(target)) return;
    const heading = /** @type {HTMLElement | null} */ (target.querySelector("h1, h2")) || target;
    heading.setAttribute("tabindex", "-1");
    // Consume before focus: window focus revalidation must not navigate again.
    pending = false;
    heading.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: "instant", block: "start" });
  }

  return {
    navigate,
    pause() {
      ready = false;
    },
    /** @param {CustomerLoadResult | null | undefined} result */
    afterLoad(result) {
      if (result?.status === "superseded") return;
      // Saved offline content stays labeled by the existing wallet UI. Wait for
      // a live authenticated response before treating a Wallet action as ready.
      ready = result?.status === "live" || result?.status === "partial";
      readyEpoch = getCustomerEpoch();
      navigate();
    },
  };
}
