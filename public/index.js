import { mountIosInstallHint } from "/lib.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
mountIosInstallHint();
