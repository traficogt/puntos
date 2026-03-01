import { GamificationRepository } from "../../repositories/gamification-repository.js";
import { dbQuery, withTransaction } from "../../database.js";
import { notFound } from "../../../utils/http-error.js";

async function getCustomerBusinessId(customerId) {
  const { rows } = await dbQuery(`SELECT business_id FROM customers WHERE id = $1`, [customerId]);
  if (!rows[0]) throw notFound("Customer not found");
  return rows[0].business_id;
}

async function awardChallenge(client, businessId, customerId, challenge) {
  await client.query(
    `UPDATE customer_balances
     SET points = points + $1, updated_at = now()
     WHERE customer_id = $2`,
    [challenge.reward_points, customerId]
  );
  await client.query(
    `INSERT INTO transactions
     (business_id, customer_id, type, points, meta)
     VALUES ($1, $2, 'CHALLENGE', $3, $4)`,
    [
      businessId,
      customerId,
      challenge.reward_points,
      JSON.stringify({
        challenge_id: challenge.id,
        challenge_name: challenge.name
      })
    ]
  );
}

export async function createChallenge(businessId, challengeData) {
  return GamificationRepository.createChallenge({
    business_id: businessId,
    ...challengeData
  });
}

export async function getCustomerChallenges(customerId, businessId) {
  return GamificationRepository.getCustomerActiveChallenges(customerId, businessId);
}

export async function updateChallengeProgress(customerId, challengeType, incrementValue = 1) {
  return withTransaction(async (client) => {
    const businessId = await getCustomerBusinessId(customerId);
    const challenges = await GamificationRepository.listActiveChallenges(businessId);
    const matchingChallenges = challenges.filter((challenge) => challenge.requirement_type === challengeType);
    const completed = [];

    for (const challenge of matchingChallenges) {
      let progress = await GamificationRepository.getCustomerChallengeProgress(customerId, challenge.id);
      if (!progress) progress = { progress: 0, times_completed: 0 };
      if (challenge.max_completions && progress.times_completed >= challenge.max_completions) continue;

      const newProgress = Number(progress.progress || 0) + Number(incrementValue || 0);
      await GamificationRepository.updateChallengeProgress(customerId, challenge.id, newProgress);
      if (newProgress < Number(challenge.requirement_value || 0)) continue;

      await GamificationRepository.completeChallengeForCustomer(customerId, challenge.id);
      await awardChallenge(client, businessId, customerId, challenge);
      if (challenge.recurrence) {
        await GamificationRepository.updateChallengeProgress(customerId, challenge.id, 0);
      }
      completed.push(challenge);
    }

    return completed;
  });
}
