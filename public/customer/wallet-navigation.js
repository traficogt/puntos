import { getCustomerEpoch } from "./session.js";

// Wallet links select a browser section; authentication is always checked separately.
export function walletDestination(value) {
  return value === "ofertas" || value === "beneficios" ? value : "";
}

export function createWalletNavigation({ $ }) {
  let observedHash;
  let pending = false;
  let ready = false;
  let readyEpoch = "";

  const visible = (element) => element && !element.closest("[hidden], .is-hidden");

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
    const heading = target.querySelector("h1, h2") || target;
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
