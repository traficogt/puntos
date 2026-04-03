import { initCustomerAuthEntry } from "./customer-auth-entry.js";

initCustomerAuthEntry({ mode: "login" }).catch((error) => {
  console.error(error);
});
