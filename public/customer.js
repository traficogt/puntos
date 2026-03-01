import { api, $, toast, mountIosInstallHint, modalAlert, modalConfirm } from "/lib.js";
import { initCustomerPage } from "./customer/index.js";

initCustomerPage({ api, $, toast, mountIosInstallHint, modalAlert, modalConfirm }).catch((e) => {
  // Avoid breaking the entire page due to a boot error.
  console.error(e);
  toast(e?.message || "Error");
});
