import { dbQuery } from "../database.js";

/**
 * Row of `achievements`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   description: string | null,
 *   icon_url: string | null,
 *   badge_image_url: string | null,
 *   requirement_type: string,
 *   requirement_value: number | null,
 *   requirement_config: Record<string, unknown> | null,
 *   points_reward: number,
 *   tier_boost: number,
 *   active: boolean,
 *   created_at: Date,
 *   updated_at: Date
 * }} AchievementRow
 */

/**
 * Row of `customer_achievements` (provenance columns from the gamification-provenance migration).
 * @typedef {{
 *   id: string,
 *   customer_id: string,
 *   achievement_id: string,
 *   earned_at: Date,
 *   progress: number,
 *   source_transaction_id: string | null,
 *   reward_transaction_id: string | null
 * }} CustomerAchievementRow
 */

/**
 * Earned achievement joined with its definition ({@link GamificationRepository.getCustomerAchievements}).
 * @typedef {CustomerAchievementRow & Pick<AchievementRow,
 *   "name" | "description" | "icon_url" | "badge_image_url" | "requirement_type" | "points_reward">} CustomerAchievementDetailRow
 */

/**
 * Row of `challenges`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   description: string | null,
 *   challenge_type: string,
 *   requirement_type: string,
 *   requirement_value: number,
 *   reward_points: number,
 *   start_date: Date,
 *   end_date: Date | null,
 *   recurrence: string | null,
 *   max_completions: number | null,
 *   active: boolean,
 *   created_at: Date,
 *   updated_at: Date
 * }} ChallengeRow
 */

/**
 * Row of `customer_challenges`.
 * @typedef {{
 *   id: string,
 *   customer_id: string,
 *   challenge_id: string,
 *   progress: number,
 *   completed: boolean,
 *   completed_at: Date | null,
 *   times_completed: number,
 *   last_reset_at: Date | null,
 *   last_source_transaction_id: string | null,
 *   last_reward_transaction_id: string | null,
 *   completion_history: unknown[],
 *   created_at: Date,
 *   updated_at: Date
 * }} CustomerChallengeRow
 */

/**
 * Active challenge with the customer's (possibly absent) progress
 * ({@link GamificationRepository.getCustomerActiveChallenges}).
 * @typedef {ChallengeRow & {
 *   progress: number | null,
 *   completed: boolean | null,
 *   times_completed: number | null,
 *   completed_at: Date | null
 * }} CustomerActiveChallengeRow
 */

/**
 * Row of `visit_streaks`.
 * @typedef {{
 *   customer_id: string,
 *   current_streak: number,
 *   longest_streak: number,
 *   last_visit_date: Date | null,
 *   streak_started_at: Date | null,
 *   updated_at: Date
 * }} VisitStreakRow
 */

/**
 * @typedef {{
 *   business_id: string,
 *   name: string,
 *   description?: string | null,
 *   icon_url?: string | null,
 *   badge_image_url?: string | null,
 *   requirement_type: string,
 *   requirement_value?: number | null,
 *   requirement_config?: Record<string, unknown> | null,
 *   points_reward?: number | null,
 *   tier_boost?: number | null,
 *   active?: boolean
 * }} AchievementCreateInput
 */

/**
 * Column assignments accepted by {@link GamificationRepository.updateAchievementScoped}.
 * @typedef {Partial<Pick<AchievementRow,
 *   | "name" | "description" | "icon_url" | "badge_image_url" | "requirement_type"
 *   | "requirement_value" | "requirement_config" | "points_reward" | "tier_boost" | "active">>} AchievementPatch
 */

/**
 * @typedef {{
 *   business_id: string,
 *   name: string,
 *   description?: string | null,
 *   challenge_type: string,
 *   requirement_type: string,
 *   requirement_value: number,
 *   reward_points: number,
 *   start_date: Date | string,
 *   end_date?: Date | string | null,
 *   recurrence?: string | null,
 *   max_completions?: number | null,
 *   active?: boolean
 * }} ChallengeCreateInput
 */

/**
 * Column assignments accepted by the challenge update methods.
 * @typedef {Partial<Pick<ChallengeRow,
 *   | "name" | "description" | "challenge_type" | "requirement_type" | "requirement_value"
 *   | "reward_points" | "recurrence" | "max_completions" | "active">>
 *   & { start_date?: Date | string, end_date?: Date | string | null }} ChallengePatch
 */

/**
 * Ledger provenance recorded with an award.
 * @typedef {{ sourceTransactionId?: string | null, rewardTransactionId?: string | null }} GamificationProvenance
 */

/**
 * Details recorded when a customer completes a challenge.
 * @typedef {GamificationProvenance & {
 *   completedAt?: Date | string | null,
 *   historyEntry?: Record<string, unknown> | null
 * }} ChallengeCompletion
 */

/**
 * @typedef {{
 *   current_streak: number,
 *   longest_streak: number,
 *   last_visit_date: Date | string | null,
 *   streak_started_at: Date | string | null
 * }} StreakInput
 */

/**
 * Points leaderboard entry; SUM/COUNT aggregates arrive as strings (bigint).
 * @typedef {{ id: string, name: string | null, total_points: string, transaction_count: string }} PointsLeaderboardRow
 */

/**
 * @typedef {{ id: string, name: string | null } & Pick<VisitStreakRow,
 *   "current_streak" | "longest_streak" | "last_visit_date">} StreakLeaderboardRow
 */

export const GamificationRepository = {
  /**
   * Resolves to `AchievementRow`.
   * @param {AchievementCreateInput} achievementData
   */
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
        achievementData.active !== false,
      ],
    );
    return rows[0];
  },

  /**
   * Resolves to `AchievementRow[]`.
   * @param {string} businessId
   */
  async listAchievements(businessId) {
    const { rows } = await dbQuery(
      `SELECT * FROM achievements
       WHERE business_id = $1
       ORDER BY requirement_value ASC NULLS FIRST`,
      [businessId],
    );
    return rows;
  },

  /**
   * Resolves to `AchievementRow | undefined`.
   * @param {string} achievementId
   */
  async getAchievement(achievementId) {
    const { rows } = await dbQuery(`SELECT * FROM achievements WHERE id = $1`, [achievementId]);
    return rows[0];
  },

  /**
   * Resolves to `AchievementRow | undefined`.
   * @param {string} achievementId
   * @param {string} businessId
   * @param {AchievementPatch} updates
   */
  async updateAchievementScoped(achievementId, businessId, updates) {
    /** @type {string[]} */
    const fields = [];
    /** @type {unknown[]} */
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === "requirement_config" && value) {
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
       SET ${fields.join(", ")}
       WHERE id = $${paramCount} AND business_id = $${paramCount + 1}
       RETURNING *`,
      values,
    );
    return rows[0];
  },

  /** @param {string} achievementId */
  async deleteAchievement(achievementId) {
    await dbQuery(`DELETE FROM achievements WHERE id = $1`, [achievementId]);
  },

  /**
   * @param {string} achievementId
   * @param {string} businessId
   * @returns {Promise<number>} deleted row count
   */
  async deleteAchievementScoped(achievementId, businessId) {
    const r = await dbQuery(`DELETE FROM achievements WHERE id = $1 AND business_id = $2`, [
      achievementId,
      businessId,
    ]);
    return r.rowCount || 0;
  },

  /**
   * Resolves to `CustomerAchievementRow | undefined` (undefined when already earned).
   * @param {string} customerId
   * @param {string} achievementId
   * @param {number} [progress]
   * @param {GamificationProvenance} [provenance]
   * @param {typeof dbQuery} [query]
   */
  async awardAchievement(
    customerId,
    achievementId,
    progress = 100,
    provenance = {},
    query = dbQuery,
  ) {
    const { rows } = await query(
      `INSERT INTO customer_achievements (customer_id, achievement_id, progress, source_transaction_id, reward_transaction_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (customer_id, achievement_id) DO NOTHING
       RETURNING *`,
      [
        customerId,
        achievementId,
        progress,
        provenance?.sourceTransactionId || null,
        provenance?.rewardTransactionId || null,
      ],
    );
    return rows[0];
  },

  /**
   * Resolves to `CustomerAchievementDetailRow[]`.
   * @param {string} customerId
   */
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
      [customerId],
    );
    return rows;
  },

  /**
   * Resolves to `CustomerAchievementRow | undefined`.
   * @param {string} customerId
   * @param {string} achievementId
   * @param {typeof dbQuery} [query]
   */
  async checkAchievementEarned(customerId, achievementId, query = dbQuery) {
    const { rows } = await query(
      `SELECT * FROM customer_achievements
       WHERE customer_id = $1 AND achievement_id = $2`,
      [customerId, achievementId],
    );
    return rows[0];
  },

  /**
   * Resolves to `ChallengeRow`.
   * @param {ChallengeCreateInput} challengeData
   */
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
        challengeData.active !== false,
      ],
    );
    return rows[0];
  },

  /**
   * Resolves to `ChallengeRow[]`.
   * @param {string} businessId
   */
  async listActiveChallenges(businessId) {
    const { rows } = await dbQuery(
      `SELECT * FROM challenges
       WHERE business_id = $1
         AND active = true
         AND start_date <= now()
         AND (end_date IS NULL OR end_date >= now())
       ORDER BY end_date ASC NULLS LAST`,
      [businessId],
    );
    return rows;
  },

  /**
   * Resolves to `ChallengeRow | undefined`.
   * @param {string} challengeId
   */
  async getChallenge(challengeId) {
    const { rows } = await dbQuery(`SELECT * FROM challenges WHERE id = $1`, [challengeId]);
    return rows[0];
  },

  /**
   * Resolves to `ChallengeRow | undefined`.
   * @param {string} challengeId
   * @param {ChallengePatch} updates
   */
  async updateChallenge(challengeId, updates) {
    /** @type {string[]} */
    const fields = [];
    /** @type {unknown[]} */
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
       SET ${fields.join(", ")}
       WHERE id = $${paramCount}
       RETURNING *`,
      values,
    );
    return rows[0];
  },

  /** @param {string} challengeId */
  async deleteChallenge(challengeId) {
    await dbQuery(`DELETE FROM challenges WHERE id = $1`, [challengeId]);
  },

  /**
   * Resolves to `ChallengeRow | undefined`.
   * @param {string} challengeId
   * @param {string} businessId
   * @param {ChallengePatch} updates
   */
  async updateChallengeScoped(challengeId, businessId, updates) {
    /** @type {string[]} */
    const fields = [];
    /** @type {unknown[]} */
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
       SET ${fields.join(", ")}
       WHERE id = $${paramCount} AND business_id = $${paramCount + 1}
       RETURNING *`,
      values,
    );
    return rows[0];
  },

  /**
   * @param {string} challengeId
   * @param {string} businessId
   * @returns {Promise<number>} deleted row count
   */
  async deleteChallengeScoped(challengeId, businessId) {
    const r = await dbQuery(`DELETE FROM challenges WHERE id = $1 AND business_id = $2`, [
      challengeId,
      businessId,
    ]);
    return r.rowCount || 0;
  },

  /**
   * Resolves to `CustomerChallengeRow | undefined`.
   * @param {string} customerId
   * @param {string} challengeId
   * @param {typeof dbQuery} [query]
   */
  async getCustomerChallengeProgress(customerId, challengeId, query = dbQuery) {
    const { rows } = await query(
      `SELECT * FROM customer_challenges
       WHERE customer_id = $1 AND challenge_id = $2`,
      [customerId, challengeId],
    );
    return rows[0];
  },

  /**
   * Resolves to `CustomerChallengeRow`.
   * @param {string} customerId
   * @param {string} challengeId
   * @param {number} progress
   * @param {typeof dbQuery} [query]
   */
  async updateChallengeProgress(customerId, challengeId, progress, query = dbQuery) {
    const { rows } = await query(
      `INSERT INTO customer_challenges (customer_id, challenge_id, progress, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (customer_id, challenge_id)
       DO UPDATE SET
         progress = $3,
         updated_at = now()
       RETURNING *`,
      [customerId, challengeId, progress],
    );
    return rows[0];
  },

  /**
   * Resolves to `CustomerChallengeRow | undefined`.
   * @param {string} customerId
   * @param {string} challengeId
   * @param {typeof dbQuery} [query]
   */
  async resetRecurringChallengeProgress(customerId, challengeId, query = dbQuery) {
    const { rows } = await query(
      `UPDATE customer_challenges
       SET progress = 0,
           completed = false,
           completed_at = NULL,
           last_reset_at = now(),
           updated_at = now()
       WHERE customer_id = $1 AND challenge_id = $2
       RETURNING *`,
      [customerId, challengeId],
    );
    return rows[0];
  },

  /**
   * Resolves to `CustomerChallengeRow | undefined`.
   * @param {string} customerId
   * @param {string} challengeId
   * @param {ChallengeCompletion} [completion]
   * @param {typeof dbQuery} [query]
   */
  async completeChallengeForCustomer(customerId, challengeId, completion = {}, query = dbQuery) {
    const historyEntry = completion?.historyEntry ? JSON.stringify(completion.historyEntry) : null;
    const { rows } = await query(
      `UPDATE customer_challenges
       SET
         completed = true,
         completed_at = COALESCE($3::timestamptz, now()),
         times_completed = times_completed + 1,
         last_source_transaction_id = COALESCE($4::uuid, last_source_transaction_id),
         last_reward_transaction_id = COALESCE($5::uuid, last_reward_transaction_id),
         completion_history = CASE
           WHEN $6::jsonb IS NULL THEN completion_history
           ELSE COALESCE(completion_history, '[]'::jsonb) || jsonb_build_array($6::jsonb)
         END,
         updated_at = now()
       WHERE customer_id = $1 AND challenge_id = $2
       RETURNING *`,
      [
        customerId,
        challengeId,
        completion?.completedAt || null,
        completion?.sourceTransactionId || null,
        completion?.rewardTransactionId || null,
        historyEntry,
      ],
    );
    return rows[0];
  },

  /**
   * Resolves to `CustomerActiveChallengeRow[]`.
   * @param {string} customerId
   * @param {string} businessId
   */
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
      [customerId, businessId],
    );
    return rows;
  },

  // Streaks

  /**
   * Resolves to `VisitStreakRow | undefined`.
   * @param {string} customerId
   */
  async getCustomerStreak(customerId) {
    const { rows } = await dbQuery(`SELECT * FROM visit_streaks WHERE customer_id = $1`, [
      customerId,
    ]);
    return rows[0];
  },

  /**
   * Resolves to `VisitStreakRow`.
   * @param {string} customerId
   * @param {StreakInput} streakData
   */
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
        streakData.streak_started_at,
      ],
    );
    return rows[0];
  },

  // Leaderboards

  /**
   * Resolves to `PointsLeaderboardRow[]`.
   * @param {string} businessId
   * @param {number} [limit]
   * @param {"all_time" | "week" | "month" | string} [timeframe]
   */
  async getPointsLeaderboard(businessId, limit = 10, timeframe = "all_time") {
    let dateFilter = "";
    if (timeframe === "week") {
      dateFilter = `AND t.created_at > now() - interval '7 days'`;
    } else if (timeframe === "month") {
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
      [businessId, limit],
    );
    return rows;
  },

  /**
   * Resolves to `StreakLeaderboardRow[]`.
   * @param {string} businessId
   * @param {number} [limit]
   */
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
      [businessId, limit],
    );
    return rows;
  },
};
