import { dbQuery } from "../database.js";

export const GamificationRepository = {
  async createAchievement(achievementData) {
    const { rows } = await dbQuery(
      `INSERT INTO achievements 
       (business_id, name, description, icon_url, badge_image_url,
        requirement_type, requirement_value, requirement_config, 
        points_reward, tier_boost, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        achievementData.business_id,
        achievementData.name,
        achievementData.description || null,
        achievementData.icon_url || null,
        achievementData.badge_image_url || null,
        achievementData.requirement_type,
        achievementData.requirement_value || null,
        JSON.stringify(achievementData.requirement_config || {}),
        achievementData.points_reward || 0,
        achievementData.tier_boost || 0,
        achievementData.active !== false
      ]
    );
    return rows[0];
  },

  async listAchievements(businessId) {
    const { rows } = await dbQuery(
      `SELECT * FROM achievements 
       WHERE business_id = $1 
       ORDER BY requirement_value ASC NULLS FIRST`,
      [businessId]
    );
    return rows;
  },

  async getAchievement(achievementId) {
    const { rows } = await dbQuery(
      `SELECT * FROM achievements WHERE id = $1`,
      [achievementId]
    );
    return rows[0];
  },

  async updateAchievementScoped(achievementId, businessId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'requirement_config' && value) {
        fields.push(`${key} = $${paramCount}`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
      }
      paramCount++;
    }

    fields.push(`updated_at = now()`);
    values.push(achievementId);
    values.push(businessId);

    const { rows } = await dbQuery(
      `UPDATE achievements 
       SET ${fields.join(', ')}
       WHERE id = $${paramCount} AND business_id = $${paramCount + 1}
       RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteAchievement(achievementId) {
    await dbQuery(`DELETE FROM achievements WHERE id = $1`, [achievementId]);
  },

  async deleteAchievementScoped(achievementId, businessId) {
    const r = await dbQuery(
      `DELETE FROM achievements WHERE id = $1 AND business_id = $2`,
      [achievementId, businessId]
    );
    return r.rowCount || 0;
  },

  async awardAchievement(customerId, achievementId, progress = 100) {
    const { rows } = await dbQuery(
      `INSERT INTO customer_achievements (customer_id, achievement_id, progress)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, achievement_id) DO NOTHING
       RETURNING *`,
      [customerId, achievementId, progress]
    );
    return rows[0];
  },

  async getCustomerAchievements(customerId) {
    const { rows } = await dbQuery(
      `SELECT 
         ca.*,
         a.name,
         a.description,
         a.icon_url,
         a.badge_image_url,
         a.requirement_type,
         a.points_reward
       FROM customer_achievements ca
       JOIN achievements a ON a.id = ca.achievement_id
       WHERE ca.customer_id = $1
       ORDER BY ca.earned_at DESC`,
      [customerId]
    );
    return rows;
  },

  async checkAchievementEarned(customerId, achievementId) {
    const { rows } = await dbQuery(
      `SELECT * FROM customer_achievements 
       WHERE customer_id = $1 AND achievement_id = $2`,
      [customerId, achievementId]
    );
    return rows[0];
  },

  async createChallenge(challengeData) {
    const { rows } = await dbQuery(
      `INSERT INTO challenges 
       (business_id, name, description, challenge_type, requirement_type,
        requirement_value, reward_points, start_date, end_date, recurrence,
        max_completions, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        challengeData.business_id,
        challengeData.name,
        challengeData.description || null,
        challengeData.challenge_type,
        challengeData.requirement_type,
        challengeData.requirement_value,
        challengeData.reward_points,
        challengeData.start_date,
        challengeData.end_date || null,
        challengeData.recurrence || null,
        challengeData.max_completions || null,
        challengeData.active !== false
      ]
    );
    return rows[0];
  },

  async listActiveChallenges(businessId) {
    const { rows } = await dbQuery(
      `SELECT * FROM challenges 
       WHERE business_id = $1 
         AND active = true
         AND start_date <= now()
         AND (end_date IS NULL OR end_date >= now())
       ORDER BY end_date ASC NULLS LAST`,
      [businessId]
    );
    return rows;
  },

  async getChallenge(challengeId) {
    const { rows } = await dbQuery(
      `SELECT * FROM challenges WHERE id = $1`,
      [challengeId]
    );
    return rows[0];
  },

  async updateChallenge(challengeId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    fields.push(`updated_at = now()`);
    values.push(challengeId);

    const { rows } = await dbQuery(
      `UPDATE challenges 
       SET ${fields.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteChallenge(challengeId) {
    await dbQuery(`DELETE FROM challenges WHERE id = $1`, [challengeId]);
  },

  async updateChallengeScoped(challengeId, businessId, updates) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    fields.push(`updated_at = now()`);
    values.push(challengeId, businessId);

    const { rows } = await dbQuery(
      `UPDATE challenges
       SET ${fields.join(', ')}
       WHERE id = $${paramCount} AND business_id = $${paramCount + 1}
       RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteChallengeScoped(challengeId, businessId) {
    const r = await dbQuery(
      `DELETE FROM challenges WHERE id = $1 AND business_id = $2`,
      [challengeId, businessId]
    );
    return r.rowCount || 0;
  },

  async getCustomerChallengeProgress(customerId, challengeId) {
    const { rows } = await dbQuery(
      `SELECT * FROM customer_challenges 
       WHERE customer_id = $1 AND challenge_id = $2`,
      [customerId, challengeId]
    );
    return rows[0];
  },

  async updateChallengeProgress(customerId, challengeId, progress) {
    const { rows } = await dbQuery(
      `INSERT INTO customer_challenges (customer_id, challenge_id, progress, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (customer_id, challenge_id)
       DO UPDATE SET 
         progress = $3,
         updated_at = now()
       RETURNING *`,
      [customerId, challengeId, progress]
    );
    return rows[0];
  },

  async completeChallengeForCustomer(customerId, challengeId) {
    const { rows } = await dbQuery(
      `UPDATE customer_challenges
       SET 
         completed = true,
         completed_at = now(),
         times_completed = times_completed + 1,
         updated_at = now()
       WHERE customer_id = $1 AND challenge_id = $2
       RETURNING *`,
      [customerId, challengeId]
    );
    return rows[0];
  },

  async getCustomerActiveChallenges(customerId, businessId) {
    const { rows } = await dbQuery(
      `SELECT 
         c.*,
         cc.progress,
         cc.completed,
         cc.times_completed,
         cc.completed_at
       FROM challenges c
       LEFT JOIN customer_challenges cc ON 
         cc.challenge_id = c.id AND cc.customer_id = $1
       WHERE c.business_id = $2
         AND c.active = true
         AND c.start_date <= now()
         AND (c.end_date IS NULL OR c.end_date >= now())
         AND (c.max_completions IS NULL OR COALESCE(cc.times_completed, 0) < c.max_completions)
       ORDER BY c.end_date ASC NULLS LAST`,
      [customerId, businessId]
    );
    return rows;
  },

  // Streaks

  async getCustomerStreak(customerId) {
    const { rows } = await dbQuery(
      `SELECT * FROM visit_streaks WHERE customer_id = $1`,
      [customerId]
    );
    return rows[0];
  },

  async updateStreak(customerId, streakData) {
    const { rows } = await dbQuery(
      `INSERT INTO visit_streaks 
       (customer_id, current_streak, longest_streak, last_visit_date, 
        streak_started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (customer_id)
       DO UPDATE SET
         current_streak = $2,
         longest_streak = GREATEST(visit_streaks.longest_streak, $3),
         last_visit_date = $4,
         streak_started_at = $5,
         updated_at = now()
       RETURNING *`,
      [
        customerId,
        streakData.current_streak,
        streakData.longest_streak,
        streakData.last_visit_date,
        streakData.streak_started_at
      ]
    );
    return rows[0];
  },

  // Leaderboards

  async getPointsLeaderboard(businessId, limit = 10, timeframe = 'all_time') {
    let dateFilter = '';
    if (timeframe === 'week') {
      dateFilter = `AND t.created_at > now() - interval '7 days'`;
    } else if (timeframe === 'month') {
      dateFilter = `AND t.created_at > now() - interval '30 days'`;
    }

    const { rows } = await dbQuery(
      `SELECT 
         c.id,
         c.name,
         COALESCE(SUM(t.points), 0) as total_points,
         COUNT(t.id) as transaction_count
       FROM customers c
       LEFT JOIN transactions t ON t.customer_id = c.id ${dateFilter}
       WHERE c.business_id = $1 AND c.deleted_at IS NULL
       GROUP BY c.id, c.name
       HAVING COALESCE(SUM(t.points), 0) > 0
       ORDER BY total_points DESC
       LIMIT $2`,
      [businessId, limit]
    );
    return rows;
  },

  async getStreakLeaderboard(businessId, limit = 10) {
    const { rows } = await dbQuery(
      `SELECT 
         c.id,
         c.name,
         vs.current_streak,
         vs.longest_streak,
         vs.last_visit_date
       FROM customers c
       JOIN visit_streaks vs ON vs.customer_id = c.id
       WHERE c.business_id = $1 AND c.deleted_at IS NULL
       ORDER BY vs.current_streak DESC, vs.longest_streak DESC
       LIMIT $2`,
      [businessId, limit]
    );
    return rows;
  }
};
