/**
 * @param {(selector: string) => Element | null} $
 */
export function setOnlineBadge($) {
  const el = /** @type {HTMLElement | null} */ ($("#netBadge"));
  if (!el) return;
  const online = navigator.onLine;
  el.textContent = online ? "En línea" : "Sin conexión";
  el.classList.toggle("status-online", online);
  el.classList.toggle("status-offline", !online);
}
