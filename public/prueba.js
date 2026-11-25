import { toast } from "/lib.js";
import { initTrialSignup } from "./trial-signup.js";

// No service worker registration here: the signup is a one-time public page, like the
// customer join page. The owner panel registers the worker after the hand-off.
initTrialSignup().catch((error) => {
  console.error(error);
  toast("No pudimos preparar el formulario. Recarga la página e inténtalo de nuevo.");
});
