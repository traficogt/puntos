/** Stable evidence excludes consultation instants, with window bounds carried separately as period metadata. */
export function ownerOutcomeFindings(outcomes) {
  if (!outcomes) return [];
  const { costs, hospitality, returns, region = {}, as_of, period } = outcomes;
  const number = value => new Intl.NumberFormat(region.locale || 'es-GT').format(value);
  const money = value => new Intl.NumberFormat(region.locale || 'es-GT', { style: 'currency', currency: region.currency || 'GTQ' }).format(value);
  const items = [];
  const add = (key, priority, title, explanation, evidence, action, window = null) => items.push({ key, priority, title, explanation, evidence, action, observed_at: as_of, period: window });
  if (costs?.missing > 0) add('operation-economics', 20, 'Completa los costos de tus recompensas',
    `${number(costs.missing)} de ${number(costs.active)} recompensas activas y vigentes no tienen costo registrado. Completa el costo antes de evaluar nuevos beneficios. Desconocido no significa costo cero; editarlo no cambia los costos históricos.`,
    { active_rewards: costs.active, missing_reward_costs: costs.missing }, { label: 'Completar costos', href: '#costos' });
  if (hospitality?.expired_unused > 0) add('hospitality-unused', 30, 'Revisa las cortesías que vencieron sin usarse',
    `${number(hospitality.expired_unused)} de ${number(hospitality.total)} cortesías cuyo plazo terminó en los últimos 30 días vencieron sin entrega registrada. Su compromiso reservado es ${money(hospitality.reserved_unused)}; no es gasto realizado. Revisa el plazo y el beneficio antes de autorizar otra prueba. El presupuesto no se repone automáticamente.`,
    { ...hospitality, currency: region.currency || 'GTQ' },
    { label: 'Revisar cortesías', href: '#cortesias' }, period);
  if (returns?.completed?.customers > 0) add('redemption-follow-up', 40, 'Revisa las visitas después de canjear',
    `${number(returns.completed.returned_customers)} de ${number(returns.completed.customers)} clientes con 30 días completos volvieron a comprar en otra fecha local. ${number(returns.ongoing.customers)} siguen en seguimiento y quedan fuera de ese denominador. Se analizan canjes de los últimos 90 días. Son compras registradas en PF; no demuestran que la recompensa causó el regreso.`,
    { completed: returns.completed, ongoing: returns.ongoing, scope: 'all_branches', follow_up_days: 30 },
    { label: 'Ver seguimiento después del canje', href: '?ver=visitas-tras-canje#resumen' }, { days: 90, start: returns.cohort.start, end: returns.cohort.end });
  return items;
}

export function selectWeeklyFindings(candidates) {
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  return { findings: sorted.slice(0, 3), additional_count: sorted.slice(3).filter(item => !item.fallback).length };
}
