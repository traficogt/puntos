import { isDeepStrictEqual } from 'node:util';
import { awardSchema } from './transaction-evidence-schema.js';
import { evaluatePointRules } from './transaction-rule-evidence.js';

// This module has no database or mutation dependency. Replay is an explanation,
// never an award, and never reads today's program configuration.
export function replaySavedAward(raw, recordedPoints) {
  const parsed = awardSchema.safeParse(raw);
  if (!parsed.success || !Number.isSafeInteger(recordedPoints)) return {
    status: 'unavailable', changes_balances: false,
    summary: 'No hay una versión histórica completa y compatible para repetir este cálculo.'
  };
  const e = parsed.data;
  const campaign_rules = e.rules.map(rule => rule.present ? {
    active: rule.active, program_type: rule.program_type,
    kind: rule.kind, value: rule.value,
    ...(rule.max_points === null ? {} : {max_points: rule.max_points}),
    condition: Object.fromEntries(Object.entries(rule.condition).filter(([,value]) => value !== null))
  } : null);
  const result = evaluatePointRules({program_type: e.program.type, program_json: {
    points_per_q: e.program.rate, points_per_visit: e.program.rate,
    points_per_item: e.program.rate, round: e.program.round, campaign_rules
  }}, e.inputs, {now: new Date(e.evaluated_at), timeZone: e.time_zone});
  const calculated = result.points + e.targeted_offer.bonus_points;
  const fields = ['rule_version','program','base_points','rules','program_points','local_hour','local_weekday'];
  const differences = fields.filter(field => !isDeepStrictEqual(result.evidence[field], e[field]));
  if (calculated !== e.awarded_points || calculated !== recordedPoints) differences.push('awarded_points');
  const criteria = e.targeted_offer.criteria;
  if (e.targeted_offer.bonus_points > 0 && typeof criteria === 'object') {
    const at = Date.parse(criteria.evaluated_at);
    if (at < Date.parse(criteria.starts_at) || at >= Date.parse(criteria.expires_at)
      || criteria.purchase.amount_q < criteria.minimum_purchase_q
      || criteria.points_committed_after - criteria.points_committed_before !== e.targeted_offer.bonus_points
      || (criteria.points_budget !== null && criteria.points_committed_after > criteria.points_budget)) differences.push('targeted_offer');
  }
  return { status: differences.length ? 'mismatch' : 'matched', changes_balances: false,
    algorithm: e.algorithm, rule_version: e.rule_version,
    calculated_points: calculated, recorded_points: recordedPoints,
    difference: calculated - recordedPoints, differences,
    summary: differences.length ? 'El cálculo histórico no coincide con toda la evidencia guardada. Revisa el movimiento antes de corregirlo.' : 'Las reglas guardadas reproducen los puntos registrados.',
    limitations: [
      'La repetición usa los importes, fechas y reglas guardados; no demuestra que el recibo físico fuera correcto.',
      ...(e.targeted_offer.bonus_points > 0 ? ['El bono dirigido usa la asignación histórica registrada; no vuelve a seleccionar la audiencia ni a emitir la oferta.'] : [])
    ]
  };
}
