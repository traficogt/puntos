// Fixed fictional snapshot: dates and totals stay reproducible in the demo.
export function demoRedemptionReturns(url) {
  const requested = Number(url.searchParams.get('days') || 90);
  const days = [7, 30, 90].includes(requested) ? requested : 90;
  const branchId = url.searchParams.get('branch_id') || null;
  const completedCustomers = days === 90 ? (branchId ? 10 : 30) : 0;
  const completedReturned = days === 90 ? (branchId ? 4 : 12) : 0;
  const ongoingCustomers = days === 7 ? (branchId ? 2 : 5) : (branchId ? 4 : 12);
  const ongoingReturned = days === 7 ? (branchId ? 0 : 1) : (branchId ? 1 : 3);
  return {
    ok: true,
    generated_at: '2026-11-11T18:00:00.000Z',
    timezone: 'America/Guatemala',
    scope: { branch_id: branchId },
    cohort: {
      days,
      start: new Date(Date.parse('2026-11-11T06:00:00Z') - (days - 1) * 86400000).toISOString(),
      end: '2026-11-11T18:00:00.000Z',
      customers: completedCustomers + ongoingCustomers,
      legacy_timestamp_customers: days === 90 ? (branchId ? 1 : 2) : 0
    },
    follow_up: { days: 30, definition: 'later_local_day_within_720_hours' },
    completed: {
      customers: completedCustomers,
      returned_customers: completedReturned,
      without_return_customers: completedCustomers - completedReturned,
      return_rate_pct: completedCustomers ? 40 : null
    },
    ongoing: { customers: ongoingCustomers, returned_customers: ongoingReturned },
    notes: [
      'Ejemplo ficticio: estos clientes y visitas no representan los resultados de un negocio real.',
      'Cada cliente entra una vez en su primer canje válido dentro del período. El porcentaje usa a todos los clientes con 30 días completos.',
      'La sucursal seleccionada se aplica tanto al canje como a la compra posterior.',
      'Muestra una asociación; no demuestra visitas causadas por la recompensa ni retorno de inversión.'
    ]
  };
}
