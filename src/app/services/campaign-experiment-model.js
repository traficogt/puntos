import { badRequest } from '../../utils/http-error.js';

const PLAN_FIELDS = ['version', 'baseline_return_rate_pct', 'minimum_detectable_lift_pp', 'observation_days', 'reconciliation_days'];
const Z975 = 1.959963984540054, Z80 = 0.8416212335729143;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateAllocation(holdoutPercent) {
  if (!finite(holdoutPercent) || holdoutPercent <= 0 || holdoutPercent >= 100) throw badRequest('La proporción del grupo de comparación debe estar entre 0 y 100 %.');
}

export function normalizeMeasurementPlan(input, { durationDays = 1, holdoutPercent = 50 } = {}) {
  if (input == null) return null;
  validateAllocation(holdoutPercent);
  if (!object(input) || Object.keys(input).some(key => !PLAN_FIELDS.includes(key)) || input.version !== undefined && input.version !== 1) throw badRequest('Revisa los campos del plan de medición.');
  const baseline = input.baseline_return_rate_pct, lift = input.minimum_detectable_lift_pp;
  if (!finite(baseline) || baseline < 1 || baseline > 95 || !finite(lift) || lift <= 0 || lift > 50 || baseline + lift >= 100) throw badRequest('Indica una tasa habitual entre 1 y 95 % y un aumento positivo de hasta 50 puntos porcentuales, sin llegar al 100 %.');
  if (!Number.isInteger(durationDays) || durationDays < 1 || !Number.isInteger(input.observation_days) || input.observation_days < durationDays || input.observation_days > 180) throw badRequest('La observación debe cubrir la oferta y durar como máximo 180 días.');
  const reconciliation = input.reconciliation_days === undefined ? 7 : input.reconciliation_days;
  if (!Number.isInteger(reconciliation) || reconciliation < 0 || reconciliation > 30) throw badRequest('La conciliación debe durar entre 0 y 30 días completos.');
  return { version: 1, baseline_return_rate_pct: baseline, minimum_detectable_lift_pp: lift, observation_days: input.observation_days, reconciliation_days: reconciliation };
}

function allocate(total, holdoutPercent) {
  // Matches campaign activation: Fisher–Yates followed by this fixed count.
  const control = total === 0 ? 0 : Math.max(1, Math.round(total * holdoutPercent / 100));
  return { treatment: total - control, control };
}

/** @param {{plan?: object|null, holdoutPercent?: number, availableMembers?: number|null}} options */
export function planCampaignExperiment({ plan, holdoutPercent = 50, availableMembers } = {}) {
  if (plan == null) return null;
  const normalized = normalizeMeasurementPlan(plan, { holdoutPercent });
  if (availableMembers != null && (!Number.isSafeInteger(availableMembers) || availableMembers < 0)) throw badRequest('El tamaño de la audiencia debe ser un número entero de clientes.');
  const p0 = normalized.baseline_return_rate_pct / 100, delta = normalized.minimum_detectable_lift_pp / 100;
  const p1 = p0 + delta, ratio = holdoutPercent / (100 - holdoutPercent);
  const pooled = (p1 + ratio * p0) / (1 + ratio);
  // Pooled null / unpooled alternative normal approximation, fixed horizon.
  // https://www.statsmodels.org/dev/generated/statsmodels.stats.proportion.samplesize_proportions_2indep_onetail.html
  // Two-sided alpha/2 critical value; ignoring the opposite tail is conservative
  // for this approximation. No continuity correction or clustering adjustment.
  const nullVariance = pooled * (1 - pooled) * (1 + 1 / ratio);
  const alternativeVariance = p1 * (1 - p1) + p0 * (1 - p0) / ratio;
  const treatmentMinimum = Math.ceil((Z975 * Math.sqrt(nullVariance) + Z80 * Math.sqrt(alternativeVariance)) ** 2 / delta ** 2);
  const controlMinimum = Math.ceil(treatmentMinimum * ratio);
  // Reserve enough total participants for both arms after activation rounding.
  let total = treatmentMinimum + controlMinimum;
  if (!Number.isSafeInteger(total)) throw badRequest('El aumento elegido requiere una muestra demasiado grande para calcularla con precisión.');
  let required = allocate(total, holdoutPercent);
  while (required.treatment < treatmentMinimum || required.control < controlMinimum) {
    total += 1;
    if (!Number.isSafeInteger(total)) throw badRequest('El aumento elegido requiere una muestra demasiado grande para calcularla con precisión.');
    required = allocate(total, holdoutPercent);
  }
  const available = availableMembers ?? null, planned = available == null ? null : allocate(available, holdoutPercent);
  return {
    method: 'two_proportion_normal_fixed_horizon', alpha: 0.05, power: 0.8,
    baseline_return_rate_pct: normalized.baseline_return_rate_pct, minimum_detectable_lift_pp: normalized.minimum_detectable_lift_pp,
    required_treatment: required.treatment, required_control: required.control, required_total: total,
    available_members: available, planned_treatment: planned?.treatment ?? null, planned_control: planned?.control ?? null,
    feasible: planned == null ? null : planned.treatment >= required.treatment && planned.control >= required.control,
    assumptions: [
      'Aproximación normal para dos grupos independientes, comparación bilateral al 5 % y potencia objetivo del 80 %; omite la cola opuesta y la corrección de continuidad.',
      'La tasa habitual y el aumento son supuestos previos para el período elegido; no se estiman a partir del resultado de esta campaña.',
      'Requiere asignación aleatoria, seguimiento completo y un análisis al finalizar el plazo; no contempla agrupación, pérdidas ni pruebas repetidas.',
      'Es una orientación de planificación, no una garantía de detectar un efecto ni una demostración de rentabilidad.',
      'Tener 30 clientes por grupo no demuestra potencia suficiente. Los resultados se interpretan con su incertidumbre.',
    ],
  };
}

const COST_FIELDS = ['gross_margin_pct', 'fulfillment_cost_q', 'messaging_cost_q', 'other_cost_q', 'outstanding_reward_cost_q'];
const INCURRED_FIELDS = ['fulfillment_cost_q', 'messaging_cost_q', 'other_cost_q'];
const money = value => value == null || !Number.isFinite(value) ? null : Math.round((value + Number.EPSILON) * 100) / 100;
const comparableSales = group => group != null && Number.isSafeInteger(group.members) && group.members > 0 && finite(group.recorded_sales_q);

/** @param {{treatment?: {members: number, recorded_sales_q: number}, control?: {members: number, recorded_sales_q: number}, costs?: Record<string, number|null>}} options */
export function campaignContribution({ treatment, control, costs = null } = {}) {
  if (costs != null && (!object(costs) || Object.keys(costs).some(key => !COST_FIELDS.includes(key)))) throw badRequest('Revisa los campos de costos de la campaña.');
  const inputs = Object.fromEntries(COST_FIELDS.map(key => [key, costs?.[key] ?? null]));
  for (const key of COST_FIELDS) {
    const value = inputs[key];
    if (value != null && (!finite(value) || value < 0 || key === 'gross_margin_pct' && value > 100)) throw badRequest('Los costos deben ser importes no negativos y el margen debe estar entre 0 y 100 %.');
  }
  const missing = COST_FIELDS.filter(key => inputs[key] == null);
  const validTreatment = comparableSales(treatment), validControl = comparableSales(control);
  if (!validTreatment) missing.push('treatment_sales');
  if (!validControl) missing.push('control_sales');
  const perMember = validTreatment && validControl ? treatment.recorded_sales_q / treatment.members - control.recorded_sales_q / control.members : null;
  const incrementalSales = perMember == null ? null : perMember * treatment.members;
  const gross = incrementalSales == null || inputs.gross_margin_pct == null ? null : incrementalSales * inputs.gross_margin_pct / 100;
  const incurred = INCURRED_FIELDS.every(key => inputs[key] != null) ? INCURRED_FIELDS.reduce((sum, key) => sum + inputs[key], 0) : null;
  const net = gross == null || incurred == null ? null : gross - incurred;
  return {
    sales_difference_per_member_q: money(perMember), incremental_recorded_sales_q: money(incrementalSales),
    incremental_gross_contribution_q: money(gross), incurred_cost_q: money(incurred), estimated_incremental_contribution_q: money(net),
    outstanding_reward_cost_q: money(inputs.outstanding_reward_cost_q),
    scenario_including_outstanding_q: net == null || inputs.outstanding_reward_cost_q == null ? null : money(net - inputs.outstanding_reward_cost_q),
    missing_inputs: missing, source: 'merchant_estimate',
    limitations: [
      'Estimación aproximada del negocio sobre ventas registradas; no es utilidad contable ni una conclusión causal de ganancia.',
      'El margen bruto debe descontar el costo habitual de la mercadería; registra como costos directos solo importes adicionales de esta campaña, sin duplicarlos.',
      'La diferencia por cliente asignado se escala al grupo con oferta; no mide la incertidumbre de ventas ni demuestra que el bono causó esa diferencia.',
      'Los costos realizados de premios, mensajes y otros gastos son totales ingresados por el negocio. Los compromisos pendientes se muestran por separado y su escenario supone que se cumplen.',
      'Los puntos son intercambiables: no se atribuyen canjes a esta campaña a partir de puntos emitidos ni se convierten automáticamente puntos en costos.',
      'Un campo vacío significa costo desconocido; escribe cero únicamente cuando hayas comprobado que no existe ese costo.',
    ],
  };
}

const verdict = (code, title, summary, next_action) => ({ code, title, summary, next_action, can_recommend_repeat: false });

/**
 * @typedef {{lower_pp:number, upper_pp:number, estimate_pp?:number}} ReturnDifference
 * @typedef {object} ExperimentMeasurement
 * @property {string} [state]
 * @property {{state?:string, reason?:string}} [data_readiness]
 * @property {boolean} [assignment_counts_match]
 * @property {number} [unavailable_members]
 * @property {{complete?:boolean}} [window]
 * @property {{treatment:number, control:number}} [sample_counts]
 * @property {ReturnDifference} [return_difference]
 * @typedef {object} ExperimentDiagnostics
 * @property {string} [capture_state]
 * @property {boolean} [assignment_counts_match]
 * @property {number} [missing_purchase_dates]
 * @property {number} [untrusted_time_purchases]
 * @property {number} [pending_refunds]
 * @property {number} [late_purchases]
 * @property {number} [overlap_members]
 * @property {number} [missing_preperiod_members]
 * @property {boolean} [baseline_imbalance]
 */
/** @param {{measurement?: ExperimentMeasurement, planning?: ReturnType<typeof planCampaignExperiment>, diagnostics?: ExperimentDiagnostics, contribution?: ReturnType<typeof campaignContribution>, followup?: {state?:string,return_difference?:ReturnDifference}}} options */
export function campaignDecision({ measurement, planning, diagnostics = {}, contribution, followup } = {}) {
  if (!measurement) return verdict('incomplete_data', 'Completa la información', 'Todavía no hay una medición que permita interpretar esta campaña.', 'Revisa los participantes y las compras registradas.');
  if (measurement.state === 'not_started') return verdict('not_started', 'Define la prueba antes de empezar', 'La campaña todavía no tiene resultados. El tamaño previsto es una orientación basada en tus supuestos.', 'Revisa la tasa habitual, el aumento que vale la pena detectar y el plazo antes de activar.');
  if (measurement.data_readiness?.reason === 'sync_stale') return verdict('stale_data', 'Actualiza las compras', 'La sincronización está atrasada; la comparación puede omitir compras de ambos grupos.', 'Actualiza la fuente de compras y vuelve a revisar la medición.');
  if (measurement.assignment_counts_match === false || diagnostics.assignment_counts_match === false) return verdict('assignment_mismatch', 'Revisa los grupos asignados', 'Los participantes observados no coinciden con la asignación original.', 'Corrige el registro de participantes conservando a todos los asignados en su grupo original.');
  if (diagnostics.pending_refunds > 0) return verdict('pending_refunds', 'Concilia las devoluciones pendientes', 'Hay devoluciones todavía sin resolver que pueden cambiar las ventas y la contribución estimada.', 'Resuelve las devoluciones y actualiza los costos antes de cerrar la evaluación.');
  if (diagnostics.untrusted_time_purchases > 0 || diagnostics.missing_purchase_dates > 0) return verdict('untrusted_time', 'Verifica cuándo ocurrieron las compras', 'Hay compras con fecha de dispositivo o sin la fecha original del recibo. La fecha de carga no permite ubicarlas con certeza en el período.', 'Verifica las fechas originales antes de cerrar la medición.');
  if (measurement.state === 'incomplete_data' || measurement.unavailable_members > 0 || measurement.data_readiness?.state === 'blocked' || diagnostics.capture_state === 'incomplete') return verdict('incomplete_data', 'Completa los datos antes de decidir', 'Faltan datos o hay una interrupción de captura que puede alterar la comparación.', 'Revisa la cobertura de compras y los participantes faltantes antes de interpretar el resultado.');
  if (measurement.state === 'descriptive') return verdict('descriptive', 'Consulta lo registrado', 'Esta oferta no tiene un grupo de comparación aleatorio. Sus ventas y costos son descriptivos.', 'Usa los registros para revisar la operación y planifica una prueba con comparación si necesitas medir un efecto.');
  if (diagnostics.overlap_members > 0) return verdict('overlapping_campaigns', 'Revisa las otras ofertas', 'Hay participantes expuestos a otras campañas durante la observación; la diferencia no separa el efecto de cada oferta.', 'Revisa las coincidencias y organiza la próxima prueba para evitar ofertas simultáneas.');
  if (diagnostics.missing_preperiod_members > 0) return verdict('missing_preperiod', 'Revisa el punto de partida', 'Faltan antecedentes previos de algunos participantes; no podemos comprobar cómo eran los grupos antes de la oferta.', 'Recupera los antecedentes disponibles y conserva la limitación al interpretar el resultado.');
  if (diagnostics.baseline_imbalance === true) return verdict('baseline_imbalance', 'Revisa las diferencias previas', 'Los grupos ya tenían diferencias antes de la oferta. Esto puede ocurrir por azar y no demuestra que la asignación sea inválida.', 'Revisa los antecedentes y la incertidumbre antes de decidir una nueva prueba.');
  if (measurement.state === 'interrupted') return verdict('interrupted', 'Revisa la campaña interrumpida', 'La oferta se interrumpió y su ejecución no completó las condiciones previstas.', 'Documenta la interrupción y considera una nueva prueba con un plazo definido.');
  if (measurement.state === 'in_progress' || measurement.window?.complete !== true || !['complete', 'reconciling'].includes(followup?.state)) return verdict('waiting', 'Espera al cierre del seguimiento', 'La observación sigue abierta o su cierre no está confirmado. Los resultados parciales pueden cambiar y consultarlos repetidamente no convierte esta prueba en un análisis secuencial.', 'Mantén el plazo acordado y revisa la comparación cuando termine el seguimiento.');
  if (followup?.state === 'reconciling') return verdict('reconciling', 'Espera a completar la conciliación', 'Terminó la observación, pero todavía está abierto el plazo para conciliar compras y devoluciones.', 'Revisa los registros pendientes y vuelve al terminar la conciliación.');
  if (!planning) return verdict('plan_missing', 'Planifica la siguiente comparación', 'Esta campaña no tiene una tasa habitual y un aumento mínimo definidos antes de empezar. El tamaño por sí solo no establece potencia suficiente.', 'Conserva el resultado como referencia y define la muestra y el plazo de una nueva prueba antes de activarla.');
  const counts = measurement.sample_counts;
  if (measurement.state === 'insufficient_sample' || planning.feasible !== true || !Number.isSafeInteger(counts?.treatment) || !Number.isSafeInteger(counts?.control) || counts.treatment < planning.required_treatment || counts.control < planning.required_control) return verdict('insufficient_sample', 'La muestra no alcanza el plan', 'Uno o ambos grupos no alcanzan el tamaño previsto para el aumento que querías detectar. Tener 30 clientes por grupo no demuestra potencia suficiente.', 'Revisa el intervalo y planifica una nueva prueba con una audiencia suficiente; no prolongues esta campaña hasta obtener un resultado favorable.');
  const difference = measurement.return_difference;
  if (!finite(difference?.lower_pp) || !finite(difference?.upper_pp) || difference.lower_pp > difference.upper_pp) return verdict('incomplete_data', 'Revisa la comparación', 'No hay un intervalo válido para interpretar la diferencia de retorno.', 'Verifica las compras observadas y los denominadores originales.');
  if (difference.upper_pp < 0) return verdict('negative_difference', 'El retorno fue menor con la oferta', 'El intervalo de la diferencia de retorno queda por debajo de cero. Esto no cuantifica la ganancia ni la pérdida económica causada por la oferta.', 'Revisa la oferta, sus costos y su ejecución antes de plantear otra prueba.');
  if (difference.lower_pp <= 0) return verdict('inconclusive', 'El resultado sigue siendo incierto', 'El intervalo admite una diferencia nula o negativa de retorno. La comparación no permite afirmar que la oferta mejoró el retorno.', 'Conserva esta incertidumbre y revisa si una nueva prueba bien planificada merece su costo.');
  if (followup?.return_difference && finite(followup.return_difference.lower_pp) && followup.return_difference.lower_pp <= 0) return verdict('followup_weaker', 'El seguimiento no confirma la mejora', 'La diferencia favorable inicial no se confirma en el intervalo del seguimiento. Esto no prueba que las compras se hayan adelantado.', 'Revisa ambos períodos antes de considerar otra prueba y evita asumir una mejora sostenida.');
  if (!contribution || contribution.missing_inputs?.length !== 0 || !finite(contribution.estimated_incremental_contribution_q) || !finite(contribution.scenario_including_outstanding_q)) return verdict('costs_unknown', 'Completa los costos', 'Se observa una diferencia favorable de retorno, pero faltan datos para estimar la contribución y los compromisos pendientes.', 'Registra el margen y los costos directos; usa cero solo cuando esté comprobado.');
  if (contribution.estimated_incremental_contribution_q <= 0 || contribution.scenario_including_outstanding_q <= 0) return verdict('costs_unfavorable', 'Revisa el costo de la oferta', 'La diferencia de retorno es favorable, pero la contribución estimada no resulta positiva al considerar los costos o los compromisos pendientes.', 'Revisa el premio, el margen y los costos antes de considerar otra prueba.');
  if (diagnostics.capture_state !== 'complete') return verdict('capture_unknown', 'Verifica la cobertura de compras', 'La comparación describe las operaciones registradas; no está confirmado que incluyan todas las compras del período.', 'Comprueba la captura en ambas poblaciones antes de usar el resultado para decidir.');
  return verdict('review_repeat', 'Revisa una nueva prueba', 'El retorno fue mayor y la contribución aproximada resulta positiva bajo los costos declarados. Esto no demuestra una ganancia causada por la oferta ni utilidad contable.', 'Si estos supuestos siguen siendo razonables, considera una nueva prueba aleatoria y limitada; revisa el presupuesto y la incertidumbre antes de activarla.');
}
