/**
 * The Redis commands the rate limiter uses; satisfied by a connected `redis`
 * client.
 * @typedef {object} RateLimitCounterStore
 * @property {(key: string) => Promise<number>} incr
 * @property {(key: string, milliseconds: number) => Promise<unknown>} pExpire
 * @property {(key: string) => Promise<number>} pTTL
 */

/**
 * Shared Redis counter with a fixed expiry, used by all rate-limit dimensions.
 * @param {RateLimitCounterStore} client
 * @param {string} key
 * @param {number} maxRequests
 * @param {number} windowMs
 */
export async function checkRedisRateLimit(client, key, maxRequests, windowMs) {
  const count = await client.incr(key);
  if (count === 1) await client.pExpire(key, windowMs);
  const ttl = await client.pTTL(key);
  const resetIn = Math.ceil(Math.max(0, ttl) / 1000);
  return {
    allowed: count <= maxRequests,
    remaining: count > maxRequests ? 0 : maxRequests - count,
    resetIn,
  };
}
