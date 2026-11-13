import {demoRegion} from './demo-region.js';
// Synthetic data, isolated to this browser module; no outbound requests.
let settings = { gross_margin_pct: null, cost_per_point_q: null };
const rewards = [
  { id: 'demo-coffee', name: 'Café de la casa', points_cost: 50, active: true, valid_until: null, unit_cost_q: 4.5,retail_value_q:12 },
  { id: 'demo-dessert', name: 'Postre del día', points_cost: 100, active: true, valid_until: null, unit_cost_q: null,retail_value_q:null },
  { id: 'demo-upgrade', name: 'Tamaño grande', points_cost: 25, active: true, valid_until: null, unit_cost_q: 0,retail_value_q:null },
];
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
function valid(value, max, places) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && Math.abs(value * (10 ** places) - Math.round(value * (10 ** places))) < 0.000001);
}
export function demoEconomics(url, options = {}) {
  const base = '/api/admin/reward-economics', method = options.method || 'GET';
  if (url.pathname === `${base}/settings` && method === 'PUT') {
    const body = JSON.parse(options.body || '{}');
    if (Object.keys(body).length !== 2 || !valid(body.gross_margin_pct, 100, 2) || !valid(body.cost_per_point_q, 1000, 6)) throw new Error('Revisa los supuestos.');
    settings = { gross_margin_pct: body.gross_margin_pct, cost_per_point_q: body.cost_per_point_q };
    return structuredClone({ ok: true, settings });
  }
  if (url.pathname.startsWith(`${base}/rewards/`) && method === 'PUT') {
    const reward = rewards.find(row => row.id === url.pathname.slice(`${base}/rewards/`.length));
    const body = JSON.parse(options.body || '{}');
    if (!reward || Object.keys(body).some(key=>!['unit_cost_q','retail_value_q'].includes(key)) || !valid(body.unit_cost_q, 1000000, 2)||(body.retail_value_q!==undefined&&!valid(body.retail_value_q,1000000,2))) throw new Error('Revisa el costo de la recompensa.');
    reward.unit_cost_q = body.unit_cost_q;
    if(body.retail_value_q!==undefined)reward.retail_value_q=body.retail_value_q;
    return structuredClone({ ok: true, reward_id: reward.id, unit_cost_q: reward.unit_cost_q });
  }
  if(url.pathname===`${base}/commitments`&&method==='GET')return {ok:true,region:demoRegion().region,generated_at:new Date().toISOString(),points_separate:true,groups:[{kind:'protected_reward',currency:'GTQ',units:5,known_retail_value:36,known_fulfillment_cost:13.5,unknown_retail_units:2,unknown_cost_units:2,historical_unknown_units:2},{kind:'hospitality',currency:'GTQ',units:2,known_retail_value:24,known_fulfillment_cost:9,unknown_retail_units:0,unknown_cost_units:0,historical_unknown_units:0},{kind:'offer',currency:'GTQ',units:10,known_retail_value:0,known_fulfillment_cost:20,unknown_retail_units:10,unknown_cost_units:0,historical_unknown_units:0}],notes:['Datos ficticios: los valores emitidos permanecen fijos cuando editas costos futuros.','Las opciones de un ciclo son alternativas; no se entregan todas.','Los puntos se estiman por separado. El costo de bonos usa un supuesto, no una entrega observada.']};
  if (url.pathname !== base || method !== 'GET') throw new Error('Acción de costos no disponible en la demostración.');
  const days = url.searchParams.get('days') === '90' ? 90 : 30;
  const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get('offset') || 0)));
  const observed = days === 30
    ? { recorded_sales_q: 1250, recorded_purchases: 25, completed_redemptions: 12, costed_redemptions: 9, unknown_cost_redemptions: 3, known_reward_cost_q: 34.5, points_redeemed: 625, cost_coverage_pct: 75 }
    : { recorded_sales_q: 3600, recorded_purchases: 72, completed_redemptions: 28, costed_redemptions: 22, unknown_cost_redemptions: 6, known_reward_cost_q: 82.5, points_redeemed: 1500, cost_coverage_pct: 78.57 };
  Object.assign(observed, { outstanding_points: 8400, pending_points: 350, negative_balance_points: 0 });
  return structuredClone({
    ok: true, currency: 'GTQ', timezone: 'America/Guatemala', generated_at: '2026-11-10T18:00:00.000Z',
    period: { days, start: new Date(Date.UTC(2026, 10, 11 - days, 6)).toISOString(), end: '2026-11-10T18:00:00.000Z' },
    observed, settings,
    estimates: {
      gross_margin_before_rewards_q: settings.gross_margin_pct === null ? null : round(observed.recorded_sales_q * settings.gross_margin_pct / 100),
      margin_after_rewards_q: null,
      margin_unavailable_reason: settings.gross_margin_pct === null ? 'missing_gross_margin' : 'incomplete_reward_costs',
      outstanding_points_cost_q: settings.cost_per_point_q === null ? null : round(observed.outstanding_points * settings.cost_per_point_q),
      pending_points_cost_q: settings.cost_per_point_q === null ? null : round(observed.pending_points * settings.cost_per_point_q),
    },
    rewards: rewards.slice(offset, offset + 50),
    rewards_pagination: { total: rewards.length, limit: 50, offset, has_more: offset + 50 < rewards.length },
    notes: [
      'Datos ficticios de demostración; no son resultados de un negocio real. Los cambios se conservan solo en esta sesión.',
      'Las ventas son registros del programa y excluyen compras completamente revertidas. Devoluciones parciales o pendientes del POS pueden seguir incluidas.',
      'Editar un costo afecta futuros canjes. No completa costos históricos desconocidos ni cambia el costo guardado de un canje.',
      'Los saldos de puntos son actuales y no se limitan al período. Las estimaciones usan tus supuestos; no son utilidad neta, obligaciones contables ni retorno causado por el programa.',
    ],
  });
}
