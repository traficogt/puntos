// Fictional, fixed snapshot. Recent cohorts must not look like completed results.
export function demoFirstPurchaseReturns(url) {
  const monday = Date.parse('2026-11-16T00:00:00Z');
  const date = milliseconds => new Date(milliseconds).toISOString().slice(0, 10);
  const availableWeeks = Array.from({ length: 52 }, (_, index) => date(monday - index * 7 * 86400000));
  const requested = url.searchParams.get('week_start');
  const week = availableWeeks.includes(requested) ? requested : availableWeeks[1];
  const branch = url.searchParams.get('branch_id') || null;
  const age = availableWeeks.indexOf(week);
  const customers = age > 40 ? 0 : branch ? 10 : 20;
  const completed = age > 5 ? customers : age === 5 ? customers / 2 : 0;
  const returned = completed * 0.4;
  const ongoing = customers - completed;
  const start = Date.parse(`${week}T06:00:00Z`);
  return {
    ok: true, generated_at: '2026-11-16T18:00:00.000Z', timezone: 'America/Guatemala',
    scope: { branch_id: branch, first_purchase_scope: 'business', return_scope: 'business' },
    available_weeks: availableWeeks,
    cohort: { week_start: week, week_end: date(start + 6 * 86400000), start: new Date(start).toISOString(),
      end: new Date(start + 7 * 86400000).toISOString(), customers, legacy_timestamp_customers: completed ? 1 : 0 },
    follow_up: { days: 30, definition: 'later_local_day_within_720_hours' },
    completed: { customers: completed, returned_customers: returned, without_return_customers: completed - returned, return_rate_pct: completed ? 40 : null },
    ongoing: { customers: ongoing, returned_customers: age === 0 ? 0 : Math.floor(ongoing * 0.2) },
    data_readiness: { state: 'recorded_only', inactivity_allowed: true, summary: 'Solo se conocen las compras registradas en PF.' },
    notes: ['Ejemplo ficticio, sin datos ni resultados de un negocio real. Los retornos no demuestran un efecto causado por el programa.']
  };
}
