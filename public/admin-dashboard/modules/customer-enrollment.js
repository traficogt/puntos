import { captureDashboardSession, isDashboardSessionBlocked } from "../logout-controller.js";

/** @param {import("../types.js").AdminDashboardApp} app */
export function createCustomerEnrollment(app) {
  const field = /** @type {HTMLInputElement|null} */ (app.$("#customerEnrollmentUrl"));
  const copy = /** @type {HTMLButtonElement|null} */ (app.$("#customerEnrollmentCopy"));
  const retry = /** @type {HTMLButtonElement|null} */ (app.$("#customerEnrollmentRetry"));
  const qr = /** @type {HTMLImageElement|null} */ (app.$("#customerEnrollmentQr"));
  const download = /** @type {HTMLAnchorElement|null} */ (app.$("#customerEnrollmentDownload"));
  const feedback = app.$("#customerEnrollmentFeedback");
  const panel = app.$("#customerEnrollment");
  let generation = 0;
  let current = () => false;
  let ready = false;

  const scope = () => JSON.stringify([app.state.currentStaff?.id, app.state.currentStaff?.business_id, app.state.currentStaff?.role]);
  const allowed = () => app.state.currentStaff?.role === "OWNER" && !isDashboardSessionBlocked();
  function message(text) { if (feedback) feedback.textContent = text; }
  function clear() {
    ready = false;
    if (field) field.value = "";
    if (copy) copy.disabled = true;
    if (qr) { qr.hidden = true; qr.removeAttribute("src"); }
    if (download) {
      download.removeAttribute("href");
      download.setAttribute("aria-disabled", "true");
      download.tabIndex = -1;
    }
  }
  function invalidate() {
    generation++;
    current = () => false;
    clear();
    if (retry) retry.hidden = true;
    panel?.setAttribute("aria-busy", "false");
    message("");
  }

  async function load() {
    const request = ++generation;
    clear();
    if (retry) retry.hidden = true;
    if (!allowed()) { invalidate(); return; }
    const session = captureDashboardSession();
    const staffScope = scope();
    const businessId = String(app.state.currentStaff.business_id);
    const valid = () => request === generation && allowed() && session() && scope() === staffScope;
    current = valid;
    panel?.setAttribute("aria-busy", "true");
    message("Cargando enlace de registro…");
    try {
      const data = await app.api("/api/admin/customer-enrollment");
      if (!valid()) return;
      const url = new URL(data.registration_url);
      if (String(data.business?.id) !== businessId || !data.business?.slug ||
          !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
          url.pathname !== `/registro/${encodeURIComponent(data.business.slug)}`) throw new Error("Invalid invitation scope");
      if (field) field.value = url.href;
      if (copy) copy.disabled = false;
      if (download) {
        download.href = "/api/admin/customer-enrollment/qr.svg?download=1";
        download.setAttribute("aria-disabled", "false");
        download.tabIndex = 0;
      }
      ready = true;
      if (qr) qr.src = "/api/admin/customer-enrollment/qr.svg";
      message("Enlace listo para compartir.");
    } catch {
      if (!valid()) return;
      clear();
      message("No pudimos cargar tu enlace. Revisa tu conexión y vuelve a intentarlo.");
      if (retry) retry.hidden = false;
    } finally {
      if (valid()) panel?.setAttribute("aria-busy", "false");
    }
  }

  copy?.addEventListener("click", async () => {
    if (!ready || !current() || !field) { invalidate(); return; }
    const valid = current;
    const url = field.value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (valid()) message("Enlace copiado.");
    } catch {
      if (!valid()) return;
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
      message("Selecciona y copia el enlace para compartirlo.");
    }
  });
  retry?.addEventListener("click", load);
  download?.addEventListener("click", event => {
    if (!ready || !current()) { event.preventDefault(); invalidate(); }
  });
  qr?.addEventListener("load", () => { if (ready && current()) qr.hidden = false; });
  qr?.addEventListener("error", () => {
    if (!ready || !current()) return;
    qr.hidden = true;
    message("El enlace está listo, pero no pudimos cargar el QR. Puedes volver a intentarlo.");
    if (retry) retry.hidden = false;
  });
  window.addEventListener("storage", event => {
    if (event.key === "pf_staff_epoch" || event.key === "pf_staff_logout_pending" && event.newValue === "1") invalidate();
  });
  window.addEventListener("pagehide", invalidate);
  window.addEventListener("pageshow", event => { if (event.persisted) void load(); });
  clear();
  return { load };
}
