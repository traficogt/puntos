import { TierRepository } from "../repositories/tier-repository.js";
import { dbQuery, withTransaction } from "../database.js";
import { notFound, badRequest, forbidden } from "../../utils/http-error.js";

const DEFAULT_TIERS = [
  {
    name: "Bronze",
    tier_level: 1,
    min_points: 0,
    points_multiplier: 1,
    perks: ["Earn points on purchases", "Redeem rewards"],
    color: "#CD7F32"
  },
  {
    name: "Silver",
    tier_level: 2,
    min_points: 500,
    points_multiplier: 1.25,
    perks: ["25% bonus points", "Early access to new rewards", "Birthday bonus"],
    color: "#C0C0C0"
  },
  {
    name: "Gold",
    tier_level: 3,
    min_points: 2000,
    points_multiplier: 1.5,
    perks: ["50% bonus points", "Exclusive rewards", "Priority support", "Free delivery"],
    color: "#FFD700"
  }
];

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

function pickRetentionTier(tiers, customer, reentryExtraPoints) {
  const points = Number(customer.rolling_points || 0);
  const currentLevel = Number(customer.current_tier_level || 0);
  const historicalMaxLevel = Number(customer.historical_max_level || 0);

  const eligible = tiers.filter((tier) => {
    const minPoints = Number(tier.min_points || 0);
    if (minPoints > points) {
      return false;
    }

    const targetLevel = Number(tier.tier_level || 0);
    if (reentryExtraPoints > 0 && targetLevel <= historicalMaxLevel && targetLevel > currentLevel) {
      return points >= minPoints + reentryExtraPoints;
    }

    return true;
  });

  return eligible.at(-1) || tiers[0];
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

async function getCustomerTierInfo(customerId) {
  const tierInfo = await TierRepository.getCustomerTierWithProgress(customerId);
  if (tierInfo) {
    return tierInfo;
  }

  const bronze = await findDefaultTier(customerId);
  if (!bronze) {
    return null;
  }

  await TierRepository.assignCustomerToTier(customerId, bronze.id);
  return {
    ...bronze,
    current_points: 0,
    points_to_next_tier: null,
    next_tier_name: null
  };
}

async function checkTierProgression(customerId) {
  return withTransaction(async (client) => {
    const { rows: customerRows } = await client.query(
      `SELECT cb.points, c.business_id, ct.tier_id, lt.tier_level
       FROM customers c
       JOIN customer_balances cb ON cb.customer_id = c.id
       LEFT JOIN customer_tiers ct ON ct.customer_id = c.id
       LEFT JOIN loyalty_tiers lt ON lt.id = ct.tier_id
       WHERE c.id = $1`,
      [customerId]
    );
    const customer = customerRows[0];

    if (!customer) {
      throw notFound("Customer not found");
    }

    const currentTierLevel = customer.tier_level || 0;
    const { rows: eligibleTiers } = await client.query(
      `SELECT * FROM loyalty_tiers
       WHERE business_id = $1
         AND active = true
         AND min_points <= $2
         AND tier_level > $3
       ORDER BY tier_level DESC
       LIMIT 1`,
      [customer.business_id, customer.points, currentTierLevel]
    );
    const newTier = eligibleTiers[0];

    if (!newTier) {
      return { upgraded: false };
    }

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

    return { upgraded: true, newTier };
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
  const mode = String(policy.mode || "lifetime");
  if (mode !== "rolling_days") {
    return { businessId, skipped: true, reason: "mode_not_rolling" };
  }

  const rollingDays = Math.max(30, Number(policy.rolling_days || 365));
  const graceDays = Math.max(0, Number(policy.grace_days || 0));
  const reentryExtraPoints = Math.max(0, Number(policy.reentry_extra_points || 0));

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
              COALESCE(SUM(CASE WHEN t.points > 0 THEN t.points ELSE 0 END), 0) AS rolling_points,
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
        AND t.status = 'POSTED'
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
      const target = pickRetentionTier(tiers, customer, reentryExtraPoints);
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
