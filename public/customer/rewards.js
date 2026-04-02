/**
 * @typedef {import("../types.js").CustomerReward} CustomerReward
 */

/**
 * @param {number} points
 * @param {CustomerReward} reward
 */
export function getRewardViewModel(points, reward) {
  const normalizedPoints = Number(points || 0);
  const cost = Number(reward?.points_cost || 0);
  const remainingPoints = Math.max(0, cost - normalizedPoints);
  const canRedeem = remainingPoints === 0;

  return {
    reward,
    canRedeem,
    remainingPoints,
    statusLabel: canRedeem
      ? "Disponible para canje en caja"
      : `Te faltan ${remainingPoints} puntos para canjear`
  };
}

/**
 * @param {number} points
 * @param {CustomerReward[] | undefined} rewards
 */
export function rewardsWithState(points, rewards) {
  const sorted = [...(rewards || [])]
    .map((reward) => getRewardViewModel(points, reward))
    .sort((a, b) => {
      if (a.canRedeem !== b.canRedeem) return a.canRedeem ? -1 : 1;
      return Number(a.reward.points_cost || 0) - Number(b.reward.points_cost || 0);
    });

  const eligible = sorted.filter((entry) => entry.canRedeem);
  const next = sorted.find((entry) => !entry.canRedeem)?.reward || sorted[0]?.reward || null;
  const remain = next ? Math.max(0, Number(next.points_cost || 0) - Number(points || 0)) : 0;

  return { sorted, eligible, next, remain };
}
