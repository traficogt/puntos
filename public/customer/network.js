/**
 * @param {(selector: string) => Element | null} $
 */
export function setOnlineBadge($) {
  const el = /** @type {HTMLElement | null} */ ($("#netBadge"));
  if (!el) return;
  el.textContent = navigator.onLine ? "En línea" : "Sin conexión";
  el.style.background = navigator.onLine ? "rgba(54,211,153,.12)" : "rgba(255,255,255,.06)";
  el.style.borderColor = navigator.onLine ? "rgba(54,211,153,.35)" : "rgba(255,255,255,.1)";
  el.style.color = navigator.onLine ? "#c8ffe7" : "var(--muted)";
}
