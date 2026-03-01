import { api, $, toast } from "/lib.js";
import { initSuperPage } from "./super/index.js";

initSuperPage({ api, $, toast }).catch((e) => {
  console.error(e);
  toast(e?.message || "Error");
});

