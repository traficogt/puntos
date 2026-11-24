import { createClient } from "redis";
import { config } from "../config/index.js";
import { tooManyRequests } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";
import { getRequestIp } from "../utils/request-ip.js";
import { checkRedisRateLimit } from "../utils/redis-rate-limit.js";
import { errorMessage } from "../utils/error-shape.js";

/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("express").NextFunction} NextFunction */
/**
 * In-memory fixed-window counter per key.
 * @typedef {Map<string, { count: number, resetTime: number }>} RateLimitStore
 */
/**
 * @typedef {object} RateLimitOptions
 * @property {string} [keyPrefix] namespace for the counter key
 * @property {(req: Request) => boolean} [skip] requests that bypass the limit
 * @property {string} [message] prefix of the 429 message
 */

/** @type {RateLimitStore} */
const userLimitStore = new Map();
/** @type {RateLimitStore} */
const phoneLimitStore = new Map();
/** @type {RateLimitStore} */
const ipLimitStore = new Map();

/** @param {string} url */
function createRateLimitRedisClient(url) {
  return createClient({ url, RESP: 2 });
}

/** @type {ReturnType<typeof createRateLimitRedisClient> | null} */
let redisClient = null;
let redisReady = false;
let redisRequested = false;

/**
 * Create the shared Redis client on first use, never at import time. Until the
 * connection is ready (or when Redis is not configured) the memory store is used.
 */
function ensureRedisClient() {
  if (redisRequested) return;
  redisRequested = true;
  if (config.RATE_LIMIT_DRIVER !== "redis" || !String(config.REDIS_URL || "").trim()) return;

  const client = createRateLimitRedisClient(config.REDIS_URL);
  redisClient = client;
  client.on("error", (err) => {
    redisReady = false;
    logger.warn({ err: err?.message }, "Redis rate-limit client error; using memory store");
  });
  client
    .connect()
    .then(() => {
      redisReady = true;
      logger.info("Redis rate-limit client connected");
    })
    .catch((err) => {
      redisReady = false;
      logger.warn(
        { err: err?.message },
        "Redis rate-limit client failed to connect; using memory store",
      );
    });
}

/** Close the Redis client on shutdown (no-op when it was never created). */
export async function closeRateLimitRedis() {
  const client = redisClient;
  redisClient = null;
  redisReady = false;
  if (!client) return;
  try {
    if (client.isOpen) await client.close();
    else client.destroy();
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, "Redis rate-limit client did not close cleanly");
  }
}

setInterval(
  () => {
    const now = Date.now();
    const ttl = 60 * 60 * 1000;

    for (const store of [userLimitStore, phoneLimitStore, ipLimitStore]) {
      for (const [key, value] of store.entries()) {
        if (!value || typeof value.resetTime !== "number" || now - value.resetTime > ttl) {
          store.delete(key);
        }
      }
    }
  },
  5 * 60 * 1000,
).unref();

/**
 * @param {Response} res
 * @param {{ max: number, remaining: number, resetIn: number }} limits
 */
function setRateLimitHeaders(res, { max, remaining, resetIn }) {
  res.set({
    "X-RateLimit-Limit": String(max),
    "X-RateLimit-Remaining": String(Math.max(0, Number(remaining ?? 0))),
    "X-RateLimit-Reset": String(Math.max(0, Number(resetIn ?? 0))),
  });
}

/**
 * @param {RateLimitStore} store
 * @param {string} key
 * @param {number} maxRequests
 * @param {number} windowMs
 */
function checkLimitMemory(store, key, maxRequests, windowMs) {
  const now = Date.now();
  const record = store.get(key);

  if (!record || now - record.resetTime > windowMs) {
    store.set(key, { count: 1, resetTime: now });
    return { allowed: true, remaining: maxRequests - 1, resetIn: Math.ceil(windowMs / 1000) };
  }

  const resetIn = Math.ceil((record.resetTime + windowMs - now) / 1000);
  if (record.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn };
  }

  record.count += 1;
  return { allowed: true, remaining: maxRequests - record.count, resetIn };
}

/**
 * Shared check: Redis when ready, otherwise (or on a Redis failure) the memory store.
 * @param {RateLimitStore} store
 * @param {string} key
 * @param {number} maxRequests
 * @param {number} windowMs
 */
async function checkLimit(store, key, maxRequests, windowMs) {
  ensureRedisClient();
  if (!redisReady || !redisClient) return checkLimitMemory(store, key, maxRequests, windowMs);
  try {
    return await checkRedisRateLimit(redisClient, key, maxRequests, windowMs);
  } catch (err) {
    // The key may carry an IP or phone number, so only the error is logged.
    logger.warn({ err: errorMessage(err) }, "Redis rate-limit check failed; using memory store");
    return checkLimitMemory(store, key, maxRequests, windowMs);
  }
}

/** @param {Request} req */
function getIp(req) {
  return getRequestIp(req) || "unknown";
}

/**
 * @param {number} [max]
 * @param {number} [windowMs]
 * @param {RateLimitOptions} [opts]
 * @returns {import("express").RequestHandler}
 */
export function rateLimitByIp(max = 120, windowMs = 60_000, opts = {}) {
  const keyPrefix = String(opts.keyPrefix || "ip:");
  const skip = typeof opts.skip === "function" ? opts.skip : null;
  const message = String(opts.message || "Rate limit exceeded.");

  return async (req, res, next) => {
    try {
      if (skip && skip(req)) return next();
      const ip = getIp(req);
      const key = `${keyPrefix}${ip}`;

      const result = await checkLimit(ipLimitStore, key, max, windowMs);

      setRateLimitHeaders(res, { max, remaining: result.remaining, resetIn: result.resetIn });
      if (!result.allowed) {
        return next(tooManyRequests(`${message} Try again in ${result.resetIn} seconds.`));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * @param {number} [max]
 * @param {number} [windowMs]
 * @returns {import("express").RequestHandler}
 */
export function rateLimitByUser(max = 100, windowMs = 60_000) {
  return async (req, res, next) => {
    try {
      const userId = req.staff?.id || req.customerAuth?.id;
      if (!userId) return next();

      const key = `user:${userId}`;
      const result = await checkLimit(userLimitStore, key, max, windowMs);

      setRateLimitHeaders(res, { max, remaining: result.remaining, resetIn: result.resetIn });
      if (!result.allowed) {
        return next(
          tooManyRequests(`Rate limit exceeded. Try again in ${result.resetIn} seconds.`),
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * @param {number} [max]
 * @param {number} [windowMs]
 * @param {Pick<RateLimitOptions, "keyPrefix">} [opts]
 * @returns {import("express").RequestHandler}
 */
export function rateLimitByPhone(max = 3, windowMs = 60_000, opts = {}) {
  const keyPrefix = String(opts.keyPrefix || "phone:");
  return async (req, res, next) => {
    try {
      const phone = req.body?.phone || req.query?.phone;
      if (!phone) return next();

      const normalizedPhone = String(phone).replace(/\D/g, "");
      const key = `${keyPrefix}${normalizedPhone}`;
      const result = await checkLimit(phoneLimitStore, key, max, windowMs);

      setRateLimitHeaders(res, { max, remaining: result.remaining, resetIn: result.resetIn });
      if (!result.allowed) {
        return next(
          tooManyRequests(
            `Too many requests for this phone number. Try again in ${result.resetIn} seconds.`,
          ),
        );
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export const strictRateLimit = rateLimitByIp(5, 15 * 60 * 1000, {
  keyPrefix: "ip:strict:",
  message: "Too many attempts.",
});
export const moderateRateLimit = rateLimitByIp(60, 60 * 1000, { keyPrefix: "ip:moderate:" });
export const lenientRateLimit = rateLimitByIp(120, 60 * 1000, { keyPrefix: "ip:lenient:" });

/** @param {(req: Request) => boolean} skip requests exempt from the global limit */
export function globalApiRateLimit(skip) {
  return rateLimitByIp(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS, {
    keyPrefix: "ip:api:",
    skip,
  });
}
