/**
 * @typedef {{
 *   period: { start: string, end: string },
 *   as_of: string,
 *   points: { earned: number, redeemed: number, expired: number, adjustments: number },
 *   balance: { pending: number },
 *   rewards: { completed: number },
 * }} CustomerStatement
 */

/**
 * Render a read-only activity summary, separate from the current card balance.
 * @param {(selector: string) => Element | null} $
 * @param {CustomerStatement | null | undefined} statement
 * @param {{ isLive?: boolean, region?: { locale?: string, timezone?: string } }} [options]
 */
export function renderStatement($, statement, { isLive = false, region = undefined } = {}) {
  const root = $("#customerStatement");
  if (!root) return;
  root.replaceChildren();
  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string} text
   * @param {string} [className]
   * @returns {HTMLElementTagNameMap[K]}
   */
  const append = (tag, text, className = "") => {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    root.appendChild(element);
    return element;
  };
  if (!statement?.period || !statement?.points || !statement?.balance || !statement?.rewards) {
    append(
      "p",
      isLive
        ? "No se pudo cargar tu resumen. Usa “Actualizar tarjeta” para intentarlo de nuevo."
        : "Conéctate y actualiza la tarjeta para consultar tu resumen.",
      "small",
    );
    return;
  }
  /** @param {number} value */
  const number = (value) => new Intl.NumberFormat(region?.locale || "es-GT").format(value);
  /** @param {string} value */
  const date = (value) =>
    new Intl.DateTimeFormat(region?.locale || "es-GT", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: region?.timezone || "America/Guatemala",
    }).format(new Date(value));
  append("h3", "Tu resumen de 30 días");
  append("p", `${date(statement.period.start)} – ${date(statement.period.end)}`, "small");
  append(
    "p",
    isLive
      ? `Consultado al ${date(statement.as_of)}.`
      : `Resumen guardado al ${date(statement.as_of)}. Actualiza con conexión para ver cambios.`,
    isLive ? "small" : "small cus-statement-saved",
  );
  const list = document.createElement("dl");
  list.className = "cus-statement-totals";
  /** @type {[string, number, boolean][]} */
  const totals = [
    ["Puntos sumados", statement.points.earned, false],
    ["Usados en canjes", statement.points.redeemed, false],
    ["Vencidos", statement.points.expired, false],
    ["Ajustes y restituciones", statement.points.adjustments, true],
  ];
  for (const [label, value, signed] of totals) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const amount = document.createElement("dd");
    amount.textContent = `${signed && value > 0 ? "+" : ""}${number(value)} pts`;
    row.append(term, amount);
    list.appendChild(row);
  }
  root.appendChild(list);
  const completed = statement.rewards.completed;
  append(
    "p",
    `${number(completed)} canje${completed === 1 ? "" : "s"} completado${completed === 1 ? "" : "s"} en el período. ${number(statement.balance.pending)} puntos pendientes de confirmar al consultar.`,
    "small",
  );
  append(
    "p",
    "Puntos sumados incluye compras, bonificaciones y otros abonos confirmados registrados en este período; no significa que todos provengan de compras ni que sigan disponibles. Las devoluciones, correcciones y saldos transferidos aparecen en Ajustes. El saldo de tu tarjeta también incluye actividad anterior.",
    "small",
  );
  append("p", "Estos puntos no tienen una equivalencia en dinero en este resumen.", "small");
}
