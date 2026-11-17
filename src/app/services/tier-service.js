import { TierRepository } from "../repositories/tier-repository.js";
import { dbQuery, withTransaction } from "../database.js";
import { notFound, badRequest, forbidden } from "../../utils/http-error.js";

// Created for new businesses. Migration 2026-11-17-ledger-default-tier-text
// gave these names and perks to businesses whose tiers were still the original
// English defaults; tiers an owner changed keep their own text.
export const DEFAULT_TIERS = [
  {
    name: "Bronce",
    tier_level: 1,
    min_points: 0,
    points_multiplier: 1,
    perks: ["Acumula puntos en tus compras", "Canjea recompensas"],
    color: "#CD7F32"
  },
  {
    name: "Plata",
    tier_level: 2,
    min_points: 500,
    points_multiplier: 1.25,
    perks: ["Acceso anticipado a nuevas recompensas", "Bono de cumpleaños"],
    color: "#C0C0C0"
  },
  {
    name: "Oro",
    tier_level: 3,
    min_points: 2000,
    points_multiplier: 1.5,
    perks: ["Recompensas exclusivas", "Atención prioritaria", "Envío gratis"],
    color: "#FFD700"
  }
];

// Earned points: applied, positive rows that are not refund reversals. Expiry
// does not undo an earning; refunded awards (REVERSED) and refunds of
// redemptions do not count. Rolling tier windows use this definition for both
// upgrades and the retention sweep.
const EARNED_ROW = `t.points > 0
  AND t.source <> 'reversal'
  AND t.status IN ('POSTED', 'EXPIRED')`;

/** @param {Record<string, any> | null | undefined} policy */
export function normalizeTierPolicy(policy = {}) {
  const value = policy && typeof policy === "object" ? policy : {};
  return {
    mode: String(value.mode || "lifetime") === "rolling_days" ? "rolling_days" : "lifetime",
    rollingDays: Math.max(30, Number(value.rolling_days || 365)),
    graceDays: Math.max(0, Number(value.grace_days || 0)),
    reentryExtraPoints: Math.max(0, Number(value.reentry_extra_points || 0))
  };
}

/**
 * Points a tier requires from this customer. In a rolling window, a level the
 * customer held before and lost requires the configured re-entry margin.
 */
function tierRequirement(tier, { mode, reentryExtraPoints, currentLevel, historicalMaxLevel }) {
  const minPoints = Number(tier.min_points || 0);
  const level = Number(tier.tier_level || 0);
  const reentry = mode === "rolling_days" && reentryExtraPoints > 0
    && level <= historicalMaxLevel && level > currentLevel;
  return minPoints + (reentry ? reentryExtraPoints : 0);
}

async function readTierEvaluationContext(client, customerId) {
  // Lock the balance like other ledger writers: its update trigger also assigns
  // tiers, and serializing avoids duplicate history for one upgrade.
  await client.query(`SELECT customer_id FROM customer_balances WHERE customer_id = $1 FOR UPDATE`, [customerId]);
  const { rows } = await client.query(
    `SELECT c.business_id,
            b.program_json->'tier_policy' AS tier_policy,
            COALESCE(cb.points, 0) AS available_points,
            COALESCE(cb.lifetime_points, 0) AS lifetime_points,
            ct.tier_id,
            lt.tier_level
     FROM customers c
     JOIN businesses b ON b.id = c.business_id
     LEFT JOIN customer_balances cb ON cb.customer_id = c.id
     LEFT JOIN customer_tiers ct ON ct.customer_id = c.id
     LEFT JOIN loyalty_tiers lt ON lt.id = ct.tier_id
     WHERE c.id = $1`,
    [customerId]
  );
  const customer = rows[0];
  if (!customer) throw notFound("Customer not found");

  const policy = normalizeTierPolicy(customer.tier_policy);
  const currentLevel = Number(customer.tier_level || 0);
  let tierPoints = Number(customer.lifetime_points || 0);
  let historicalMaxLevel = currentLevel;
  if (policy.mode === "rolling_days") {
    const earned = await client.query(
      `SELECT COALESCE(SUM(t.points), 0)::bigint AS points
       FROM transactions t
       WHERE t.customer_id = $1
         AND ${EARNED_ROW}
         AND t.created_at >= now() - ($2 || ' days')::interval`,
      [customerId, String(policy.rollingDays)]
    );
    tierPoints = Number(earned.rows[0]?.points || 0);
    const history = await client.query(
      `SELECT COALESCE(MAX(lt.tier_level), 0) AS level
       FROM tier_history th
       JOIN loyalty_tiers lt ON lt.id = th.to_tier_id
       WHERE th.customer_id = $1`,
      [customerId]
    );
    historicalMaxLevel = Math.max(currentLevel, Number(history.rows[0]?.level || 0));
  }

  const { rows: tiers } = await client.query(
    `SELECT * FROM loyalty_tiers
     WHERE business_id = $1 AND active = true
     ORDER BY tier_level ASC`,
    [customer.business_id]
  );

  return {
    customer,
    policy,
    tiers,
    tierPoints,
    availablePoints: Number(customer.available_points || 0),
    currentLevel,
    historicalMaxLevel
  };
}

// Upgrades only. Downgrades belong to the rolling-window retention sweep.
async function evaluateTierProgression(client, customerId) {
  const context = await readTierEvaluationContext(client, customerId);
  const { customer, policy, tiers, tierPoints, currentLevel, historicalMaxLevel } = context;
  const requirementContext = { ...policy, currentLevel, historicalMaxLevel };
  const newTier = tiers
    .filter((tier) => Number(tier.tier_level || 0) > currentLevel
      && tierPoints >= tierRequirement(tier, requirementContext))
    .at(-1);

  if (!newTier) return { ...context, upgraded: false, newTier: null };

  await client.query(
    `INSERT INTO customer_tiers (customer_id, tier_id)
     VALUES ($1, $2)
     ON CONFLICT (customer_id)
     DO UPDATE SET tier_id = $2, updated_at = now()`,
    [customerId, newTier.id]
  );
  await client.query(
    `INSERT INTO tier_history (customer_id, from_tier_id, to_tier_id, reason)
     VALUES ($1, $2, $3, 'points')`,
    [customerId, customer.tier_id, newTier.id]
  );
  return { ...context, upgraded: true, newTier, currentLevel: Number(newTier.tier_level || 0) };
}

/**
 * Progress toward the next active tier, never negative. current_points is the
 * earned-points measure the tiers use (lifetime or rolling window), so it can
 * be compared with next_tier_points; available_points is the spendable balance.
 */
function withTierProgress(tier, evaluation) {
  const currentLevel = Number(tier.tier_level || 0);
  const requirementContext = { ...evaluation.policy, currentLevel, historicalMaxLevel: evaluation.historicalMaxLevel };
  const next = evaluation.tiers.find((candidate) => Number(candidate.tier_level || 0) > currentLevel) ?? null;
  const nextRequirement = next ? tierRequirement(next, requirementContext) : null;
  return {
    ...tier,
    current_points: evaluation.tierPoints,
    available_points: evaluation.availablePoints,
    tier_points_mode: evaluation.policy.mode,
    next_tier_name: next?.name ?? null,
    next_tier_points: nextRequirement,
    points_to_next_tier: next ? Math.max(0, nextRequirement - evaluation.tierPoints) : null
  };
}

async function findDefaultTier(customerId) {
  const { rows } = await dbQuery(
    `SELECT lt.*
     FROM loyalty_tiers lt
     JOIN customers c ON c.business_id = lt.business_id
     WHERE c.id = $1 AND lt.tier_level = 1 AND lt.active = true
     LIMIT 1`,
    [customerId]
  );

  return rows[0];
}

async function getOwnedTier(tierId, businessId, action) {
  const tier = await TierRepository.getById(tierId);

  if (!tier) {
    throw notFound("Tier not found");
  }

  if (tier.business_id !== businessId) {
    throw forbidden(`Not authorized to ${action} this tier`);
  }

  return tier;
}

async function ensureUniqueTierLevel(businessId, tierLevel) {
  const existingTiers = await TierRepository.listByBusiness(businessId);
  if (existingTiers.some((tier) => tier.tier_level === tierLevel)) {
    throw badRequest(`Tier level ${tierLevel} already exists`);
  }
}

async function countCustomersInTier(tierId) {
  const { rows } = await dbQuery(
    `SELECT COUNT(*) AS count FROM customer_tiers WHERE tier_id = $1`,
    [tierId]
  );

  return Number.parseInt(rows[0]?.count ?? 0, 10);
}

function pickRetentionTier(tiers, customer, policy) {
  const points = Number(customer.rolling_points || 0);
  const requirementContext = {
    ...policy,
    currentLevel: Number(customer.current_tier_level || 0),
    historicalMaxLevel: Number(customer.historical_max_level || 0)
  };
  return tiers.filter((tier) => points >= tierRequirement(tier, requirementContext)).at(-1) || tiers[0];
}

async function createDefaultTiers(businessId, _programType = "SPEND") {
  const tiers = [];

  for (const tierData of DEFAULT_TIERS) {
    tiers.push(await TierRepository.create({
      business_id: businessId,
      ...tierData
    }));
  }

  return tiers;
}

// Balances change through writers that never call the award hooks (imports,
// bonuses, integrations, settlement inside other transactions), so reading the
// tier evaluates it first instead of trusting a possibly stale assignment.
async function getCustomerTierInfo(customerId) {
  return withTransaction(async (client) => {
    const evaluation = await evaluateTierProgression(client, customerId);
    const tierInfo = await TierRepository.getCustomerTier(customerId);
    if (tierInfo) {
      return withTierProgress(tierInfo, evaluation);
    }

    const base = await findDefaultTier(customerId);
    if (!base) {
      return null;
    }

    await TierRepository.assignCustomerToTier(customerId, base.id);
    return withTierProgress(base, evaluation);
  });
}

async function checkTierProgression(customerId) {
  return withTransaction(async (client) => {
    const evaluation = await evaluateTierProgression(client, customerId);
    return evaluation.upgraded ? { upgraded: true, newTier: evaluation.newTier } : { upgraded: false };
  });
}

async function calculatePointsWithMultiplier(customerId, basePoints) {
  const tier = await TierRepository.getCustomerTier(customerId);
  if (!tier?.points_multiplier) {
    return basePoints;
  }

  return Math.floor(basePoints * tier.points_multiplier);
}

async function createTier(businessId, tierData) {
  await ensureUniqueTierLevel(businessId, tierData.tier_level);
  return TierRepository.create({
    business_id: businessId,
    ...tierData
  });
}

async function updateTier(tierId, businessId, updates) {
  await getOwnedTier(tierId, businessId, "update");
  return TierRepository.update(tierId, updates);
}

async function deleteTier(tierId, businessId) {
  await getOwnedTier(tierId, businessId, "delete");

  if (await countCustomersInTier(tierId)) {
    throw badRequest("Cannot delete tier with active customers. Deactivate it instead.");
  }

  await TierRepository.delete(tierId);
}

async function runTierRetentionSweep(businessId, policy = {}) {
  const normalized = normalizeTierPolicy(policy);
  if (normalized.mode !== "rolling_days") {
    return { businessId, skipped: true, reason: "mode_not_rolling" };
  }

  const { rollingDays, graceDays, reentryExtraPoints } = normalized;

  return withTransaction(async (client) => {
    const { rows: tiers } = await client.query(
      `SELECT id, tier_level, min_points
       FROM loyalty_tiers
       WHERE business_id = $1 AND active = true
       ORDER BY tier_level ASC`,
      [businessId]
    );
    if (!tiers.length) {
      return { businessId, skipped: true, reason: "no_tiers" };
    }

    const { rows: customers } = await client.query(
      `SELECT c.id AS customer_id,
              COALESCE(SUM(t.points), 0) AS rolling_points,
              ct.tier_id AS current_tier_id,
              lt.tier_level AS current_tier_level,
              ct.achieved_at,
              COALESCE((
                SELECT MAX(lt2.tier_level)
                FROM tier_history th
                JOIN loyalty_tiers lt2 ON lt2.id = th.to_tier_id
                WHERE th.customer_id = c.id
              ), COALESCE(lt.tier_level, 0)) AS historical_max_level
       FROM customers c
       LEFT JOIN transactions t
         ON t.customer_id = c.id
        AND ${EARNED_ROW}
        AND t.created_at >= now() - ($2 || ' days')::interval
       LEFT JOIN customer_tiers ct ON ct.customer_id = c.id
       LEFT JOIN loyalty_tiers lt ON lt.id = ct.tier_id
       WHERE c.business_id = $1 AND c.deleted_at IS NULL
       GROUP BY c.id, ct.tier_id, lt.tier_level, ct.achieved_at`,
      [businessId, String(rollingDays)]
    );

    let upgrades = 0;
    let downgrades = 0;

    for (const customer of customers) {
      const target = pickRetentionTier(tiers, customer, normalized);
      const currentLevel = Number(customer.current_tier_level || 0);
      const targetLevel = Number(target.tier_level || 0);

      if (!customer.current_tier_id) {
        await client.query(
          `INSERT INTO customer_tiers (customer_id, tier_id, achieved_at)
           VALUES ($1, $2, now())
           ON CONFLICT (customer_id) DO NOTHING`,
          [customer.customer_id, target.id]
        );
        await client.query(
          `INSERT INTO tier_history (customer_id, from_tier_id, to_tier_id, reason)
           VALUES ($1, NULL, $2, 'retention_bootstrap')`,
          [customer.customer_id, target.id]
        );
        continue;
      }

      if (targetLevel === currentLevel) {
        continue;
      }

      if (targetLevel < currentLevel && graceDays > 0 && customer.achieved_at) {
        const held = await client.query(
          `SELECT now() - $1::timestamptz < ($2 || ' days')::interval AS in_grace`,
          [customer.achieved_at, String(graceDays)]
        );
        if (held.rows?.[0]?.in_grace) {
          continue;
        }
      }

      await client.query(
        `UPDATE customer_tiers
         SET tier_id = $2,
             updated_at = now(),
             achieved_at = CASE WHEN $3 > $4 THEN now() ELSE achieved_at END
         WHERE customer_id = $1`,
        [customer.customer_id, target.id, targetLevel, currentLevel]
      );
      await client.query(
        `INSERT INTO tier_history (customer_id, from_tier_id, to_tier_id, reason)
         VALUES ($1, $2, $3, 'retention_window')`,
        [customer.customer_id, customer.current_tier_id, target.id]
      );

      if (targetLevel > currentLevel) {
        upgrades += 1;
      } else {
        downgrades += 1;
      }
    }

    return {
      businessId,
      rollingDays,
      graceDays,
      reentryExtraPoints,
      upgrades,
      downgrades,
      customers: customers.length
    };
  });
}

export const TierService = {
  createDefaultTiers,
  getCustomerTierInfo,
  checkTierProgression,
  calculatePointsWithMultiplier,
  getBusinessTiersWithStats(businessId) {
    return TierRepository.getTierStats(businessId);
  },
  createTier,
  updateTier,
  deleteTier,
  runTierRetentionSweep
};
