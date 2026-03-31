function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function computePurchaseFrequencyPerMonth(totalTransactions, firstPurchaseAt, lastPurchaseAt) {
  const txCount = Number(totalTransactions || 0);
  if (txCount <= 0 || !firstPurchaseAt || !lastPurchaseAt) return 0;

  const first = new Date(firstPurchaseAt);
  const last = new Date(lastPurchaseAt);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 0;

  const elapsedMs = Math.max(last.getTime() - first.getTime(), 0);
  const monthsActive = Math.max(elapsedMs / (1000 * 60 * 60 * 24 * 30), 1 / 30);
  return Number((txCount / monthsActive).toFixed(2));
}

export function calculateVisitStreakMetrics(visitDates) {
  const normalized = [...new Set((visitDates || []).map(dateKey).filter(Boolean))].sort();
  if (!normalized.length) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastVisitDate: null,
      streakStartedAt: null
    };
  }

  let longest = 1;
  let currentRun = 1;
  let lastRunLength = 1;
  let lastRunStart = normalized[0];
  let runStart = normalized[0];

  for (let index = 1; index < normalized.length; index += 1) {
    const prev = new Date(`${normalized[index - 1]}T00:00:00.000Z`);
    const next = new Date(`${normalized[index]}T00:00:00.000Z`);
    const diffDays = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      currentRun += 1;
    } else {
      if (currentRun > longest) longest = currentRun;
      runStart = normalized[index];
      currentRun = 1;
    }

    if (index === normalized.length - 1) {
      lastRunLength = currentRun;
      lastRunStart = runStart;
      if (currentRun > longest) longest = currentRun;
    }
  }

  return {
    currentStreak: lastRunLength,
    longestStreak: longest,
    lastVisitDate: normalized[normalized.length - 1],
    streakStartedAt: lastRunStart
  };
}

function churnRiskScore(daysSinceLastPurchase, purchaseFrequency) {
  const daysFactor = Math.min(1, (Number(daysSinceLastPurchase ?? 9999) / 90)) * 0.6;
  const frequencyFactor = purchaseFrequency < 0.5 ? 0.4 : purchaseFrequency < 1 ? 0.2 : 0;
  return Number(Math.min(1, daysFactor + frequencyFactor).toFixed(2));
}

function predictedLtv(avgTransactionValue, purchaseFrequency) {
  if (!(purchaseFrequency > 0)) return 0;
  return Number((Number(avgTransactionValue || 0) * (purchaseFrequency * 12 * 2)).toFixed(2));
}

export async function refreshCustomerDerivedState(client, customerId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(amount_q), 0)::numeric(10,2) AS total_spend,
       COALESCE(SUM(visits), 0)::int AS total_visits,
       COUNT(*)::int AS total_transactions,
       COALESCE(AVG(amount_q), 0)::numeric(10,2) AS avg_transaction_value,
       MIN(created_at) AS first_purchase_at,
       MAX(created_at) AS last_purchase_at,
       EXTRACT(DAY FROM (now() - MAX(created_at)))::int AS days_since_last_purchase
     FROM transactions
     WHERE customer_id = $1
       AND type = 'PURCHASE'
       AND source <> 'reversal'
       AND status <> 'REVERSED'`,
    [customerId]
  );

  const aggregate = rows[0] || {};
  const purchaseFrequency = computePurchaseFrequencyPerMonth(
    aggregate.total_transactions,
    aggregate.first_purchase_at,
    aggregate.last_purchase_at
  );

  await client.query(
    `INSERT INTO customer_ltv (
       customer_id,
       total_spend,
       total_visits,
       total_transactions,
       avg_transaction_value,
       first_purchase_at,
       last_purchase_at,
       days_since_last_purchase,
       purchase_frequency,
       predicted_ltv,
       churn_risk_score,
       updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (customer_id)
     DO UPDATE SET
       total_spend = EXCLUDED.total_spend,
       total_visits = EXCLUDED.total_visits,
       total_transactions = EXCLUDED.total_transactions,
       avg_transaction_value = EXCLUDED.avg_transaction_value,
       first_purchase_at = EXCLUDED.first_purchase_at,
       last_purchase_at = EXCLUDED.last_purchase_at,
       days_since_last_purchase = EXCLUDED.days_since_last_purchase,
       purchase_frequency = EXCLUDED.purchase_frequency,
       predicted_ltv = EXCLUDED.predicted_ltv,
       churn_risk_score = EXCLUDED.churn_risk_score,
       updated_at = now()`,
    [
      customerId,
      aggregate.total_spend || 0,
      aggregate.total_visits || 0,
      aggregate.total_transactions || 0,
      aggregate.avg_transaction_value || 0,
      aggregate.first_purchase_at || null,
      aggregate.last_purchase_at || null,
      aggregate.days_since_last_purchase ?? null,
      purchaseFrequency,
      predictedLtv(aggregate.avg_transaction_value, purchaseFrequency),
      churnRiskScore(aggregate.days_since_last_purchase, purchaseFrequency)
    ]
  );

  const { rows: visitRows } = await client.query(
    `SELECT DISTINCT DATE(created_at) AS visit_date
     FROM transactions
     WHERE customer_id = $1
       AND type = 'PURCHASE'
       AND visits > 0
       AND source <> 'reversal'
       AND status <> 'REVERSED'
     ORDER BY visit_date ASC`,
    [customerId]
  );

  const streak = calculateVisitStreakMetrics(visitRows.map((row) => row.visit_date));
  if (streak.currentStreak <= 0) {
    await client.query(`DELETE FROM visit_streaks WHERE customer_id = $1`, [customerId]);
    return;
  }

  await client.query(
    `INSERT INTO visit_streaks (customer_id, current_streak, longest_streak, last_visit_date, streak_started_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (customer_id)
     DO UPDATE SET
       current_streak = EXCLUDED.current_streak,
       longest_streak = EXCLUDED.longest_streak,
       last_visit_date = EXCLUDED.last_visit_date,
       streak_started_at = EXCLUDED.streak_started_at,
       updated_at = now()`,
    [customerId, streak.currentStreak, streak.longestStreak, streak.lastVisitDate, streak.streakStartedAt]
  );
}
