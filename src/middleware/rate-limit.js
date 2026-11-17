import { createClient } from "redis";
import { config } from "../config/index.js";
import { tooManyRequests } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";
import { getRequestIp } from "../utils/request-ip.js";
import { checkRedisRateLimit, releaseRedisRateLimit } from "../utils/redis-rate-limit.js";

const userLimitStore = new Map();
const phoneLimitStore = new Map();
const ipLimitStore = new Map();
const accountLimitStore = new Map();

let redisClient = null;
let redisReady = false;

if (config.RATE_LIMIT_DRIVER === "redis" && String(config.REDIS_URL || "").trim()) {
  redisClient = createClient({ url: config.REDIS_URL, RESP: 2 });
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

  for (const store of [userLimitStore, phoneLimitStore, ipLimitStore, accountLimitStore]) {
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
  return checkRedisRateLimit(redisClient, key, maxRequests, windowMs);
}

function releaseLimitMemory(store, key, record) {
  const current = store.get(key);
  // Only return the allowance to the window that counted the request.
  if (current && current === record) current.count = Math.max(0, current.count - 1);
}

async function hitLimit(store, key, max, windowMs) {
  if (redisReady) {
    try {
      return { ...(await checkLimitRedis(key, max, windowMs)), release: () => releaseRedisRateLimit(redisClient, key) };
    } catch {
      // Fall through to the process-local counter.
    }
  }
  const result = checkLimitMemory(store, key, max, windowMs);
  const record = store.get(key);
  return { ...result, release: async () => releaseLimitMemory(store, key, record) };
}

/** Counts only failed responses: a request that finishes below 400 returns its allowance. */
function releaseOnSuccess(res, release) {
  res.once?.("finish", () => {
    if (Number(res.statusCode) < 400) {
      Promise.resolve().then(release).catch((err) => {
        logger.warn({ err: err?.message }, "Rate-limit release failed");
      });
    }
  });
}

function getIp(req) {
  return getRequestIp(req) || "unknown";
}

function rateLimitByKey(store, max, windowMs, { keyFor, message, skip = null, skipSuccessfulRequests = false }) {
  return async (req, res, next) => {
    try {
      if (skip && skip(req)) return next();
      const key = keyFor(req);
      const result = await hitLimit(store, key, max, windowMs);

      setRateLimitHeaders(res, { max, remaining: result.remaining, resetIn: result.resetIn });
      if (!result.allowed) {
        return next(tooManyRequests(`${message} Try again in ${result.resetIn} seconds.`));
      }
      if (skipSuccessfulRequests) releaseOnSuccess(res, result.release);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function rateLimitByIp(max = 120, windowMs = 60_000, opts = {}) {
  const keyPrefix = String(opts.keyPrefix || "ip:");
  return rateLimitByKey(ipLimitStore, max, windowMs, {
    keyFor: (req) => `${keyPrefix}${getIp(req)}`,
    message: String(opts.message || "Rate limit exceeded."),
    skip: typeof opts.skip === "function" ? opts.skip : null,
    skipSuccessfulRequests: opts.skipSuccessfulRequests === true
  });
}

function normalizeAccount(value) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 320) : "";
}

/**
 * Limits attempts against one account from one address, so a shared network
 * does not exhaust other people's budgets. The account is read from the body.
 */
export function rateLimitByAccountAndIp(max, windowMs, opts = {}) {
  const keyPrefix = String(opts.keyPrefix || "acct:");
  const accountField = String(opts.accountField || "email");
  return rateLimitByKey(accountLimitStore, max, windowMs, {
    keyFor: (req) => `${keyPrefix}${encodeURIComponent(normalizeAccount(req.body?.[accountField]))}:${getIp(req)}`,
    message: String(opts.message || "Too many attempts."),
    skipSuccessfulRequests: opts.skipSuccessfulRequests === true
  });
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

export function rateLimitByPhone(max = 3, windowMs = 60_000, opts = {}) {
  const keyPrefix = String(opts.keyPrefix || "phone:");
  return async (req, res, next) => {
    try {
      const phone = req.body?.phone || req.query?.phone;
      if (!phone) return next();

      const normalizedPhone = String(phone).replace(/\D/g, "");
      const key = `${keyPrefix}${normalizedPhone}`;
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

/** @deprecated Shared by every caller; use the endpoint-family limiters below. */
export const strictRateLimit = rateLimitByIp(5, 15 * 60 * 1000, { keyPrefix: "ip:strict:", message: "Too many attempts." });

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Authentication and enrollment limits by endpoint family. Each family has its
 * own counters, so customers requesting codes on a shared network cannot lock
 * out a cashier's login, and a contact form cannot block password resets.
 */
export const AUTH_RATE_LIMITS = Object.freeze({
  staffLoginAccount: { max: 5, windowMs: FIFTEEN_MINUTES_MS },
  staffLoginIp: { max: 30, windowMs: FIFTEEN_MINUTES_MS },
  superLoginAccount: { max: 5, windowMs: FIFTEEN_MINUTES_MS },
  superLoginIp: { max: 10, windowMs: FIFTEEN_MINUTES_MS },
  signup: { max: 5, windowMs: FIFTEEN_MINUTES_MS },
  passwordResetRequest: { max: 5, windowMs: FIFTEEN_MINUTES_MS },
  accountTokenConfirm: { max: 10, windowMs: FIFTEEN_MINUTES_MS },
  contact: { max: 5, windowMs: FIFTEEN_MINUTES_MS },
  customerCodeRequest: { max: 20, windowMs: FIFTEEN_MINUTES_MS }
});

function loginRateLimit(family, accountLimit, ipLimit) {
  // Failed attempts only. Account+IP runs first, so retries that it already
  // blocks do not also consume the address-wide budget shared by colleagues.
  return [
    rateLimitByAccountAndIp(accountLimit.max, accountLimit.windowMs, { keyPrefix: `acct:login:${family}:`, message: "Too many attempts.", skipSuccessfulRequests: true }),
    rateLimitByIp(ipLimit.max, ipLimit.windowMs, { keyPrefix: `ip:login:${family}:`, message: "Too many attempts.", skipSuccessfulRequests: true })
  ];
}

export const staffLoginRateLimit = loginRateLimit("staff", AUTH_RATE_LIMITS.staffLoginAccount, AUTH_RATE_LIMITS.staffLoginIp);
export const superLoginRateLimit = loginRateLimit("super", AUTH_RATE_LIMITS.superLoginAccount, AUTH_RATE_LIMITS.superLoginIp);
export const signupRateLimit = rateLimitByIp(AUTH_RATE_LIMITS.signup.max, AUTH_RATE_LIMITS.signup.windowMs, { keyPrefix: "ip:signup:", message: "Too many attempts." });
export const passwordResetRequestRateLimit = rateLimitByIp(AUTH_RATE_LIMITS.passwordResetRequest.max, AUTH_RATE_LIMITS.passwordResetRequest.windowMs, { keyPrefix: "ip:password-reset-request:", message: "Too many attempts." });
export const accountTokenConfirmRateLimit = rateLimitByIp(AUTH_RATE_LIMITS.accountTokenConfirm.max, AUTH_RATE_LIMITS.accountTokenConfirm.windowMs, { keyPrefix: "ip:account-token-confirm:", message: "Too many attempts.", skipSuccessfulRequests: true });
export const contactRateLimit = rateLimitByIp(AUTH_RATE_LIMITS.contact.max, AUTH_RATE_LIMITS.contact.windowMs, { keyPrefix: "ip:contact:", message: "Too many attempts." });
export const customerCodeRequestRateLimit = rateLimitByIp(AUTH_RATE_LIMITS.customerCodeRequest.max, AUTH_RATE_LIMITS.customerCodeRequest.windowMs, { keyPrefix: "ip:customer-code-request:", message: "Too many attempts." });
export const moderateRateLimit = rateLimitByIp(60, 60 * 1000, { keyPrefix: "ip:moderate:" });
export const lenientRateLimit = rateLimitByIp(120, 60 * 1000, { keyPrefix: "ip:lenient:" });

export function globalApiRateLimit(skip) {
  return rateLimitByIp(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS, { keyPrefix: "ip:api:", skip });
}
