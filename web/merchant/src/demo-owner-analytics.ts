import {DEMO_CATALOG} from './demo-catalog.js';
import {ivaCsv, IVA_FILENAME} from './owner-analytics-model.ts';
import type {ActivityRow, BranchPerformanceRow, ChurnCustomer, CohortRow, IvaDayRow, LinkedTransaction, RewardRedemptionRow} from './owner-analytics-model.ts';

// Synthetic, browser-only preview for the analytics suite (wave 15a): dashboard aggregates, churn
// list, cohorts, the 30-day comparison, the reward redemption ledger and the IVA export. No request
// here reaches a PF API. The daily series is the same arithmetic the Overview preview uses, so the
// two screens agree on what the example café sold.
const branchId = '22222222-2222-4222-8222-222222222222';
const uuid = (value: number) => `77777777-7777-4777-8777-${String(value).padStart(12, '0')}`;
const fail = (message: string, status: number) => Object.assign(new Error(message), {status});
const round2 = (value: number) => Math.round(value * 100) / 100;

interface DemoDay {date: string; purchases: number; sales: number}
/** Day `index` of the series that ends on `end`; same arithmetic as demo-api.js overview(). */
function dailySeries(end: Date, days: number, scale: number): DemoDay[] {
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1 - days, 6));
  return Array.from({length: days}, (_, index) => {
    const purchases = Math.round((12 + ((index * 7) % 19)) * scale);
    return {date: new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10), purchases, sales: purchases * (42 + ((index * 3) % 18))};
  });
}

export function createOwnerAnalyticsDemoApi(now = () => new Date('2026-11-10T18:00:00Z')) {
  const customers = ['Ana López', 'Carlos Méndez', 'Cliente de ejemplo 7', 'Cliente de ejemplo 12', 'Cliente de ejemplo 15', 'Cliente de ejemplo 19', 'Cliente de ejemplo 21', 'Cliente de ejemplo 24', 'Cliente de ejemplo 26'];
  const churn: ChurnCustomer[] = customers.map((name, index) => ({
    id: uuid(100 + index),
    name,
    phone: `5025555${String(index + 1).padStart(4, '0')}`,
    churn_risk_score: String(round2(0.94 - index * 0.025)),
    days_since_last_purchase: 48 + index * 9,
    total_spend: String(round2(910 - index * 83)),
    total_visits: 9 - Math.floor(index / 2),
    last_purchase_at: new Date(now().getTime() - (48 + index * 9) * 86400000).toISOString(),
  }));

  const rewards: Record<string, {name: string; points_cost: number}> = {
    'demo-coffee': {name: DEMO_CATALOG.coffee.name, points_cost: Number(DEMO_CATALOG.coffee.points_cost ?? 100)},
    'demo-bread': {name: DEMO_CATALOG.bread.name, points_cost: 80},
  };
  const redemptionRows: Array<RewardRedemptionRow & {reward_id: string; customer_id: string; staff_name: string | null}> = [
    ['demo-coffee', 1, 'Ana López', 2, 1, 'Lucía Pérez'],
    ['demo-coffee', 2, 'Carlos Méndez', 3, 1, 'Lucía Pérez'],
    ['demo-coffee', 3, 'Cliente de ejemplo 9', 5, 0, 'Dueña de ejemplo'],
    ['demo-coffee', 4, 'Cliente de ejemplo 4', 6, 1, 'Lucía Pérez'],
    ['demo-coffee', 5, 'Cliente de ejemplo 11', 9, 1, null],
    ['demo-bread', 6, 'Ana López', 1, 1, 'Lucía Pérez'],
    ['demo-bread', 7, 'Cliente de ejemplo 16', 8, 1, 'Lucía Pérez'],
  ].map(entry => {
    const [rewardId, sequence, customerName, daysAgo, linkedCount, staffName] = entry as [string, number, string, number, number, string | null];
    const cost = rewards[rewardId].points_cost;
    return {
      id: uuid(200 + sequence),
      reward_id: rewardId,
      customer_id: uuid(300 + sequence),
      created_at: new Date(now().getTime() - daysAgo * 86400000 - sequence * 3600000).toISOString(),
      status: 'REDEEMED',
      code: `CJ-DEMO-${String(sequence).padStart(4, '0')}`,
      points_cost: cost,
      customer_name: customerName,
      customer_phone: `5025555${String(sequence).padStart(4, '0')}`,
      linked_points_total: linkedCount === 1 ? -cost : 0,
      linked_transaction_count: linkedCount,
      staff_name: staffName,
    };
  });
  const linkedTransactions = (row: (typeof redemptionRows)[number]): LinkedTransaction[] =>
    Number(row.linked_transaction_count) === 0
      ? []
      : [{id: uuid(400 + Number(row.code.slice(-4))), created_at: row.created_at, source: 'redeem', status: 'POSTED', amount_q: '0.00', points: -Number(row.points_cost), original_transaction_id: null, reversed_transaction_id: null, reversal_reason: null, meta: {redemption_id: row.id}}];

  const cohorts = (months: number): CohortRow[] => {
    const current = now();
    const rows: CohortRow[] = [];
    const sizes = [34, 41, 29, 38, 27, 23];
    for (let back = 5; back >= 0; back -= 1) {
      const start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - back, 1));
      const name = start.toISOString().slice(0, 7);
      const size = sizes[back];
      for (let month = 0; month <= months; month += 1) {
        const started = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 1) <= current.getTime();
        const rate = month === 0 ? 100 : Math.max(0, Math.round((44 - month * 5 + (back % 3) * 2) * 10) / 10);
        const active = started ? Math.round((size * rate) / 100) : 0;
        rows.push({cohort_name: name, cohort_date: start.toISOString(), cohort_size: size, month_number: month, active_customers: String(active), retention_rate: started ? String(rate.toFixed(2)) : '0', revenue: String(active * 46)});
      }
    }
    return rows.sort((a, b) => b.cohort_date.localeCompare(a.cohort_date) || Number(a.month_number) - Number(b.month_number));
  };

  return (url: URL, options: RequestInit = {}): unknown => {
    const path = url.pathname, method = options.method || 'GET';
    if (method !== 'GET') return undefined;
    const branch = url.searchParams.get('branch_id');
    const scale = branch ? 0.55 : 1;
    // Only the endpoints this fixture answers validate the branch; the Overview preview keeps its own.
    if (branch && branch !== branchId && (path === '/api/admin/analytics/dashboard' || path === '/api/admin/analytics/churn-risk')) throw fail('branch_id no válido', 400);

    if (path === '/api/admin/analytics/dashboard') {
      const series = dailySeries(now(), 30, scale);
      const purchases = series.reduce((sum, day) => sum + day.purchases, 0);
      const sales = series.reduce((sum, day) => sum + day.sales, 0);
      const recent: ActivityRow[] = series.map(day => ({date: day.date, active_customers: String(Math.round(day.purchases / 1.6)), transactions: String(day.purchases), revenue: String(day.sales)})).reverse();
      const total = Math.round(212 * scale), risk = Math.round(9 * scale);
      const performance: BranchPerformanceRow[] = [{
        branch_id: branchId,
        branch_name: 'Zona 4 · demo',
        branch_code: 'jacaranda-centro',
        tx_30d: Math.round(purchases * (branch ? 1 : 0.55)),
        revenue_30d: round2(sales * (branch ? 1 : 0.55)).toFixed(2),
        active_customers_30d: Math.round(184 * 0.55),
        redemptions_30d: Math.round(purchases * 0.1 * (branch ? 1 : 0.55)),
        avg_ticket_30d: round2(sales / Math.max(1, purchases)).toFixed(2),
      }];
      return {
        ok: true,
        summary: {total_customers: String(total), new_customers_30d: String(Math.round(23 * scale)), total_points_issued: String(Math.round(sales * 0.1)), avg_points_per_customer: String(round2((sales * 0.1) / total)), high_churn_risk_count: String(risk), avg_customer_spend: String(round2(318.4 * (branch ? 0.92 : 1))), avg_purchase_frequency: String(branch ? '1.60' : '1.80')},
        rfm_distribution: [
          {segment: 'Champions', count: String(Math.round(38 * scale))},
          {segment: 'Loyal', count: String(Math.round(71 * scale))},
          {segment: 'At Risk', count: String(Math.round(56 * scale))},
          {segment: 'Lost', count: String(Math.round(47 * scale))},
        ],
        recent_activity: recent,
        branch_performance: performance,
        branch_id: branch || null,
      };
    }
    if (path === '/api/admin/analytics/churn-risk') {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
      const threshold = Number(url.searchParams.get('threshold') || 0.7);
      const rows = churn.filter(row => Number(row.churn_risk_score) >= threshold).filter((_, index) => !branch || index % 2 === 0).slice(0, limit);
      return {ok: true, customers: rows, threshold, branch_id: branch || null, count: rows.length};
    }
    if (path === '/api/admin/analytics/cohorts') {
      const months = Math.max(1, Math.min(60, Number(url.searchParams.get('months') || 12)));
      return {ok: true, cohorts: cohorts(months)};
    }
    if (path === '/api/admin/roi') {
      const days = Math.max(7, Math.min(120, Number(url.searchParams.get('days') || 30)));
      const current = dailySeries(now(), days, 1);
      const revenue = current.reduce((sum, day) => sum + day.sales, 0), tx = current.reduce((sum, day) => sum + day.purchases, 0);
      const previousRevenue = Math.round(revenue * 0.83), previousTx = Math.round(tx * 0.85);
      const customersTotal = 212, customersActive = Math.min(customersTotal, Math.round(184 * Math.min(1.15, Math.sqrt(days / 30))));
      const redemptions = Math.round(tx * 0.1);
      return {
        ok: true,
        days,
        roi: {
          revenue_current_q: revenue,
          revenue_previous_q: previousRevenue,
          revenue_growth_pct: ((revenue - previousRevenue) / previousRevenue) * 100,
          tx_current: tx,
          tx_previous: previousTx,
          tx_growth_pct: ((tx - previousTx) / previousTx) * 100,
          customers_total: customersTotal,
          customers_active: customersActive,
          repeat_rate_pct: (customersActive / customersTotal) * 100,
          redemptions,
          redemption_rate_pct: (redemptions / tx) * 100,
        },
      };
    }
    const rewardMatch = path.match(/^\/api\/admin\/analytics\/rewards\/([^/]+)\/redemptions$/);
    if (rewardMatch) {
      const rewardId = decodeURIComponent(rewardMatch[1]);
      const reward = rewards[rewardId];
      if (!reward) throw fail('Recompensa no encontrada', 404);
      const rows = redemptionRows.filter(row => row.reward_id === rewardId).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
      const recent: RewardRedemptionRow[] = rows.map(({reward_id: _reward, customer_id: _customer, staff_name: _staff, ...row}) => row);
      return {
        ok: true,
        reward: {id: rewardId, business_id: '11111111-1111-4111-8111-111111111111', name: reward.name, description: null, points_cost: reward.points_cost, active: true, stock: rewardId === 'demo-coffee' ? 100 : 50},
        summary: {recent_redemption_count: recent.length, mismatch_count: recent.filter(row => Number(row.linked_points_total) !== -Number(row.points_cost) || Number(row.linked_transaction_count) !== 1).length},
        recent_redemptions: recent,
      };
    }
    const redemptionMatch = path.match(/^\/api\/admin\/analytics\/redemptions\/([^/]+)$/);
    if (redemptionMatch) {
      const row = redemptionRows.find(entry => entry.id === decodeURIComponent(redemptionMatch[1]));
      if (!row) throw fail('Canje no encontrado', 404);
      const transactions = linkedTransactions(row);
      const linked = transactions.reduce((sum, tx) => sum + Number(tx.points), 0), expected = -Number(row.points_cost);
      return {
        ok: true,
        redemption: {id: row.id, created_at: row.created_at, status: row.status, code: row.code, points_cost: row.points_cost, business_id: '11111111-1111-4111-8111-111111111111', customer_id: row.customer_id, reward_id: row.reward_id, staff_user_id: row.staff_name ? uuid(101) : null, customer_name: row.customer_name, customer_phone: row.customer_phone, reward_name: rewards[row.reward_id].name, reward_description: null, staff_name: row.staff_name},
        ledger: {expected_points_total: expected, linked_points_total: linked, delta_points: linked - expected, linked_transaction_count: transactions.length, consistent: linked === expected && transactions.length === 1},
        transactions,
      };
    }
    if (path === '/api/admin/billing/iva.csv') {
      // The real endpoint answers CSV text with a Content-Disposition name; the preview hands the
      // view the same file generated here so the download works offline.
      const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
      const days: IvaDayRow[] = dailySeries(now(), 120, 1).filter(day => (!from || day.date >= from) && (!to || day.date <= to)).map(day => ({fecha: day.date, transacciones: day.purchases, monto_bruto_q: day.sales}));
      return {ok: true, filename: IVA_FILENAME, csv: ivaCsv(days), rows: days.length};
    }
    return undefined;
  };
}
const ownerAnalyticsDemo = createOwnerAnalyticsDemoApi();
export function demoOwnerAnalytics(url: URL, options: RequestInit = {}) {return ownerAnalyticsDemo(url, options);}
