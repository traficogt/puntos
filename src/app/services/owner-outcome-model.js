/**
 * Evidence as getOwnerOutcomeEvidence (./owner-outcome-service.js) returns it; the
 * redemption follow-up block comes from redemption-return-service and is read defensively.
 * @typedef {{
 *   as_of: string,
 *   period?: { days: number, start: unknown, end: unknown } | null,
 *   region?: { locale?: string | null, currency?: string | null },
 *   costs: { active: number, missing: number },
 *   hospitality: { total: number, fulfilled?: number, expired_unused: number, reserved_unused?: number },
 *   returns?: OwnerOutcomeReturns | null
 * }} OwnerOutcomeEvidence
 *
 * @typedef {{ customers: number, returned_customers?: number, [field: string]: unknown }} OwnerOutcomeCompletedCohort
 * @typedef {{
 *   completed?: OwnerOutcomeCompletedCohort | null,
 *   ongoing: { customers: number, [field: string]: unknown },
 *   cohort: { start: unknown, end: unknown }
 * }} OwnerOutcomeReturns
 * The follow-up block once the condition below established a completed cohort.
 * @typedef {OwnerOutcomeReturns & { completed: OwnerOutcomeCompletedCohort }} OwnerOutcomeMeasuredReturns
 *
 * @typedef {{
 *   key: string,
 *   priority: number,
 *   title: string,
 *   explanation: string,
 *   evidence: Record<string, unknown>,
 *   action: { label: string, href: string },
 *   observed_at: string,
 *   period: { days: number, start: unknown, end: unknown } | null
 * }} OwnerOutcomeFinding
 */

/**
 * Stable evidence excludes consultation instants, with window bounds carried separately as period metadata.
 * @param {OwnerOutcomeEvidence | null | undefined} outcomes
 * @returns {OwnerOutcomeFinding[]}
 */
export function ownerOutcomeFindings(outcomes) {
  if (!outcomes) return [];
  const {
    costs,
    hospitality,
    returns,
    region = /** @type {NonNullable<OwnerOutcomeEvidence["region"]>} */ ({}),
    as_of,
    period,
  } = outcomes;
  // Counts the evidence omitted format as NaN, exactly as before this file was typed.
  /** @param {number | undefined} value */
  const number = (value) =>
    new Intl.NumberFormat(region.locale || "es-GT").format(/** @type {number} */ (value));
  /** @param {number | undefined} value */
  const money = (value) =>
    new Intl.NumberFormat(region.locale || "es-GT", {
      style: "currency",
      currency: region.currency || "GTQ",
    }).format(/** @type {number} */ (value));
  /** @type {OwnerOutcomeFinding[]} */
  const items = [];
  /**
   * @param {string} key
   * @param {number} priority
   * @param {string} title
   * @param {string} explanation
   * @param {Record<string, unknown>} evidence
   * @param {{ label: string, href: string }} action
   * @param {{ days: number, start: unknown, end: unknown } | null} [window]
   */
  const add = (key, priority, title, explanation, evidence, action, window = null) =>
    items.push({
      key,
      priority,
      title,
      explanation,
      evidence,
      action,
      observed_at: as_of,
      period: window,
    });
  if (costs?.missing > 0)
    add(
      "operation-economics",
      20,
      "Completa los costos de tus recompensas",
      `${number(costs.missing)} de ${number(costs.active)} recompensas activas y vigentes no tienen costo registrado. Completa el costo antes de evaluar nuevos beneficios. Desconocido no significa costo cero; editarlo no cambia los costos históricos.`,
      { active_rewards: costs.active, missing_reward_costs: costs.missing },
      { label: "Completar costos", href: "#costos" },
    );
  if (hospitality?.expired_unused > 0)
    add(
      "hospitality-unused",
      30,
      "Revisa las cortesías que vencieron sin usarse",
      `${number(hospitality.expired_unused)} de ${number(hospitality.total)} cortesías cuyo plazo terminó en los últimos 30 días vencieron sin entrega registrada. Su compromiso reservado es ${money(hospitality.reserved_unused)}; no es gasto realizado. Revisa el plazo y el beneficio antes de autorizar otra prueba. El presupuesto no se repone automáticamente.`,
      { ...hospitality, currency: region.currency || "GTQ" },
      { label: "Revisar cortesías", href: "#cortesias" },
      period,
    );
  // An absent follow-up block compares as false, exactly as the untyped code did.
  if (/** @type {number} */ (returns?.completed?.customers) > 0)
    add(
      "redemption-follow-up",
      40,
      "Revisa las visitas después de canjear",
      `${number(/** @type {OwnerOutcomeMeasuredReturns} */ (returns).completed.returned_customers)} de ${number(/** @type {OwnerOutcomeMeasuredReturns} */ (returns).completed.customers)} clientes con 30 días completos volvieron a comprar en otra fecha local. ${number(/** @type {OwnerOutcomeMeasuredReturns} */ (returns).ongoing.customers)} siguen en seguimiento y quedan fuera de ese denominador. Se analizan canjes de los últimos 90 días. Son compras registradas en PF; no demuestran que la recompensa causó el regreso.`,
      {
        completed: /** @type {OwnerOutcomeMeasuredReturns} */ (returns).completed,
        ongoing: /** @type {OwnerOutcomeMeasuredReturns} */ (returns).ongoing,
        scope: "all_branches",
        follow_up_days: 30,
      },
      { label: "Ver seguimiento después del canje", href: "?ver=visitas-tras-canje#resumen" },
      {
        days: 90,
        start: /** @type {OwnerOutcomeMeasuredReturns} */ (returns).cohort.start,
        end: /** @type {OwnerOutcomeMeasuredReturns} */ (returns).cohort.end,
      },
    );
  return items;
}

/**
 * @template {{ key: string, priority: number, fallback?: boolean }} T
 * @param {T[]} candidates
 */
export function selectWeeklyFindings(candidates) {
  const sorted = [...candidates].sort(
    (a, b) => a.priority - b.priority || a.key.localeCompare(b.key),
  );
  return {
    findings: sorted.slice(0, 3),
    additional_count: sorted.slice(3).filter((item) => !item.fallback).length,
  };
}
