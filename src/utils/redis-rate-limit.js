/** Shared Redis counter with a fixed expiry, used by all rate-limit dimensions. */
export async function checkRedisRateLimit(client, key, maxRequests, windowMs) {
  const count = await client.incr(key);
  if (count === 1) await client.pExpire(key, windowMs);
  const ttl = await client.pTTL(key);
  const resetIn = Math.ceil(Math.max(0, ttl) / 1000);
  return {
    allowed: count <= maxRequests,
    remaining: count > maxRequests ? 0 : maxRequests - count,
    resetIn
  };
}
