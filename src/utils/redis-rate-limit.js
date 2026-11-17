import { defineScript } from "redis";

// One server-side step increments the counter and guarantees an expiry. A
// separate INCR and PEXPIRE could leave a permanent counter if the client
// failed between them; a key found without a TTL (-1) is also repaired here.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

// Returns an allowance without creating a key, so an expired window is never
// recreated without a TTL.
const RELEASE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  local count = redis.call('DECR', KEYS[1])
  if count < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL') end
  return count
end
return 0
`;

/**
 * Lua scripts for the rate-limit client: pass as `scripts` to `createClient`.
 * The client runs them by SHA (EVALSHA) and sends the source again only when
 * Redis does not have it, for example after a restart.
 */
export const rateLimitScripts = {
  rateLimitHit: defineScript({
    SCRIPT: HIT_SCRIPT,
    NUMBER_OF_KEYS: 1,
    /** @param {import("redis").CommandParser} parser @param {string} key @param {number} windowMs */
    parseCommand(parser, key, windowMs) {
      parser.pushKey(key);
      parser.push(String(windowMs));
    },
    /** @param {unknown} reply */
    transformReply: (reply) => reply
  }),
  rateLimitRelease: defineScript({
    SCRIPT: RELEASE_SCRIPT,
    NUMBER_OF_KEYS: 1,
    /** @param {import("redis").CommandParser} parser @param {string} key */
    parseCommand(parser, key) {
      parser.pushKey(key);
    },
    /** @param {unknown} reply */
    transformReply: (reply) => reply
  })
};

/**
 * Shared Redis counter with a fixed expiry, used by all rate-limit dimensions.
 * @param {{ rateLimitHit: (key: string, windowMs: number) => Promise<unknown> }} client created with `rateLimitScripts`
 */
export async function checkRedisRateLimit(client, key, maxRequests, windowMs) {
  const reply = await client.rateLimitHit(key, Math.max(1, Math.floor(windowMs)));
  const [rawCount, rawTtl] = Array.isArray(reply) ? reply : [];
  const count = Number(rawCount);
  if (!Number.isFinite(count)) throw new Error("Unexpected Redis rate-limit reply");
  const resetIn = Math.ceil(Math.max(0, Number(rawTtl) || 0) / 1000);
  return {
    allowed: count <= maxRequests,
    remaining: count > maxRequests ? 0 : maxRequests - count,
    resetIn
  };
}

/**
 * Returns one allowance to an existing window (for example after a successful login).
 * @param {{ rateLimitRelease: (key: string) => Promise<unknown> }} client created with `rateLimitScripts`
 */
export async function releaseRedisRateLimit(client, key) {
  await client.rateLimitRelease(key);
}
