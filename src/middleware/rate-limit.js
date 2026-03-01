import { createClient } from "redis";
import { config } from "../config/index.js";
import { tooManyRequests } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";
import { getRequestIp } from "../utils/request-ip.js";

const userLimitStore = new Map();
const phoneLimitStore = new Map();
const ipLimitStore = new Map();

let redisClient = null;
let redisReady = false;

if (config.RATE_LIMIT_DRIVER === "redis" && String(config.REDIS_URL || "").trim()) {
  redisClient = createClient({ url: config.REDIS_URL });
  redisClient.on("error", (err) => {
    redisReady = false;
    logger.warn({ err: err?.message }, "Redis rate-limit client error; using memory store");
  });
  redisClient.connect()
    .then(() => {
      redisReady = true;
      logger.info("Redis rate-limit client connected");
    })
    .catch((err) => {
      redisReady = false;
      logger.warn({ err: err?.message }, "Redis rate-limit client failed to connect; using memory store");
    });
}

setInterval(() => {
  const now = Date.now();
  const ttl = 60 * 60 * 1000;

  for (const store of [userLimitStore, phoneLimitStore, ipLimitStore]) {
    for (const [key, value] of store.entries()) {
      if (!value || typeof value.resetTime !== "number" || (now - value.resetTime > ttl)) {
        store.delete(key);
      }
    }
  }
}, 5 * 60 * 1000).unref();

function setRateLimitHeaders(res, { max, remaining, resetIn }) {
  res.set({
    "X-RateLimit-Limit": String(max),
    "X-RateLimit-Remaining": String(Math.max(0, Number(remaining ?? 0))),
    "X-RateLimit-Reset": String(Math.max(0, Number(resetIn ?? 0)))
  });
}

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

async function checkLimitRedis(key, maxRequests, windowMs) {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.pexpire(key, windowMs);
  }
  const ttl = await redisClient.pttl(key);
  const resetIn = Math.ceil(Math.max(0, ttl) / 1000);
  if (count > maxRequests) {
    return { allowed: false, remaining: 0, resetIn };
  }
  return { allowed: true, remaining: maxRequests - count, resetIn };
}

function getIp(req) {
  return getRequestIp(req) || "unknown";
}

export function rateLimitByIp(max = 120, windowMs = 60_000, opts = {}) {
  const keyPrefix = String(opts.keyPrefix || "ip:");
  const skip = typeof opts.skip === "function" ? opts.skip : null;
  const message = String(opts.message || "Rate limit exceeded.");

  return async (req, res, next) => {
    try {
      if (skip && skip(req)) return next();
      const ip = getIp(req);
      const key = `${keyPrefix}${ip}`;

      const result = redisReady
        ? await checkLimitRedis(key, max, windowMs).catch(() => checkLimitMemory(ipLimitStore, key, max, windowMs))
        : checkLimitMemory(ipLimitStore, key, max, windowMs);

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

export function rateLimitByUser(max = 100, windowMs = 60_000) {
  return async (req, res, next) => {
    try {
      const userId = req.staff?.id || req.customerAuth?.id;
      if (!userId) return next();

      const key = `user:${userId}`;
      const result = redisReady
        ? await checkLimitRedis(key, max, windowMs).catch(() => checkLimitMemory(userLimitStore, key, max, windowMs))
        : checkLimitMemory(userLimitStore, key, max, windowMs);

      setRateLimitHeaders(res, { max, remaining: result.remaining, resetIn: result.resetIn });
      if (!result.allowed) {
        return next(tooManyRequests(`Rate limit exceeded. Try again in ${result.resetIn} seconds.`));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function rateLimitByPhone(max = 3, windowMs = 60_000) {
  return async (req, res, next) => {
    try {
      const phone = req.body?.phone || req.query?.phone;
      if (!phone) return next();

      const normalizedPhone = String(phone).replace(/\D/g, "");
      const key = `phone:${normalizedPhone}`;
      const result = redisReady
        ? await checkLimitRedis(key, max, windowMs).catch(() => checkLimitMemory(phoneLimitStore, key, max, windowMs))
        : checkLimitMemory(phoneLimitStore, key, max, windowMs);

      setRateLimitHeaders(res, { max, remaining: result.remaining, resetIn: result.resetIn });
      if (!result.allowed) {
        return next(tooManyRequests(`Too many requests for this phone number. Try again in ${result.resetIn} seconds.`));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export const strictRateLimit = rateLimitByIp(5, 15 * 60 * 1000, { keyPrefix: "ip:strict:", message: "Too many attempts." });
export const moderateRateLimit = rateLimitByIp(60, 60 * 1000, { keyPrefix: "ip:moderate:" });
export const lenientRateLimit = rateLimitByIp(120, 60 * 1000, { keyPrefix: "ip:lenient:" });

export function globalApiRateLimit(skip) {
  return rateLimitByIp(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS, { keyPrefix: "ip:api:", skip });
}
