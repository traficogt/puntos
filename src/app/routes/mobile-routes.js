import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../middleware/common.js';
import { setTenantForRequest } from '../../middleware/tenant.js';
import { moderateRateLimit, rateLimitByIp, rateLimitByPhone, strictRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../utils/validation.js';
import { businessCustomerBrandingSchema, requestJoinCodeSchema, verifyJoinCodeSchema } from '../../utils/schemas.js';
import { normalizePhone } from '../../utils/phone.js';
import { sanitizeProgramForClient } from '../../utils/program-secrets.js';
import { planFeaturesWithOverrides } from '../../utils/plan.js';
import { badRequest, notFound } from '../../utils/http-error.js';
import { logger } from '../../utils/logger.js';
import { getDbClient, withTransaction } from '../database.js';
import { BusinessRepo } from '../repositories/business-repository.js';
import { CustomerRepo } from '../repositories/customer-repository.js';
import { TxnRepo } from '../repositories/transaction-repository.js';
import { getCustomerRewardProgress } from '../services/customer-reward-progress.js';
import { RedemptionRepo } from '../repositories/redemption-repository.js';
import { requestJoinCode, verifyJoinCode, issueCustomerQr } from '../services/customer-service.js';
import {
  browserSessionStatus,
  getBrowserSession,
  touchBrowserSessionIfNeeded,
  invalidateBrowserSessionById,
  invalidateBrowserSessionsForActor
} from '../services/auth-session-service.js';
import { PlanConfigService } from '../services/plan-config-service.js';
import { settlePendingPointsForCustomer, expirePointsForCustomer } from '../services/loyalty-ops-service.js';
import { nativeWalletService } from '../services/native-wallet/runtime.js';
import { mobilePushService } from '../services/mobile-push/runtime.js';
import { mobileAccessService } from '../services/mobile-access-service.js';

const defaults = {
  BusinessRepo, CustomerRepo, TxnRepo, RedemptionRepo, PlanConfigService, getDbClient, getCustomerRewardProgress,
  setTenantForRequest, requestJoinCode, verifyJoinCode, issueCustomerQr,
  getBrowserSession, touchBrowserSessionIfNeeded,
  invalidateBrowserSessionById, invalidateBrowserSessionsForActor,
  settlePendingPointsForCustomer, expirePointsForCustomer, withTransaction,
  walletService: nativeWalletService,
  pushService: mobilePushService,
  accessService: mobileAccessService,
  accessRequestLimit: rateLimitByIp(5, 15 * 60 * 1000, { keyPrefix: 'ip:mobile-access-request:' }),
  accessVerifyLimit: rateLimitByIp(60, 60000, { keyPrefix: 'ip:mobile-access-verify:' }),
  accessSelectLimit: rateLimitByIp(30, 60000, { keyPrefix: 'ip:mobile-access-select:' }),
  accessRequestPhoneLimit: rateLimitByPhone(5, 60 * 60 * 1000, { keyPrefix: 'phone:mobile-access-request:' }),
  accessVerifyPhoneLimit: rateLimitByPhone(10, 10 * 60 * 1000, { keyPrefix: 'phone:mobile-access-verify:' }),
  pushRegisterLimit: rateLimitByIp(20, 60000, { keyPrefix: 'ip:push-register:' }),
  pushRevokeLimit: rateLimitByIp(10, 60000, { keyPrefix: 'ip:push-revoke:' }),
  pushTestLimit: rateLimitByIp(3, 60000, { keyPrefix: 'ip:push-test:' }),
  requestCodeLimit: strictRateLimit,
  verifyCodeLimit: moderateRateLimit,
  requestPhoneLimit: rateLimitByPhone(3, 10 * 60 * 1000),
  verifyPhoneLimit: rateLimitByPhone(10, 10 * 60 * 1000),
  walletIssueLimit: rateLimitByIp(20, 60000, { keyPrefix: 'ip:wallet-issue:' })
};

const accessPhoneSchema = z.string().max(30).regex(/^[+\d\s()-]+$/).transform(value => normalizePhone(value)).refine(phone => /^\d{8,15}$/.test(phone), 'Teléfono inválido');
const accessRequestSchema = z.object({ phone: accessPhoneSchema });
const accessVerifySchema = z.object({ phone: accessPhoneSchema, code: z.string().regex(/^\d{6}$/) });
const accessSelectSchema = z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), businessId: z.guid() });
const deleteSchema = z.object({ confirm: z.literal(true) });
const customerFields = ['id', 'name', 'phone', 'points', 'pending_points', 'lifetime_points'];
const rewardFields = ['id', 'name', 'description', 'points_cost', 'active', 'stock', 'valid_until', 'branch_ids', 'branch_labels'];
const transactionFields = ['id', 'points_delta', 'amount_q', 'source', 'created_at', 'reward_name'];
const redemptionFields = ['id', 'reward_name', 'points_cost', 'status', 'created_at', 'redeemed_at'];
const project = (record, fields) => Object.fromEntries(fields.map(key => [key, record[key]]));
const businessIdentity = business => ({ id: business.id, name: business.name, slug: business.slug });

function customerBranding(value) {
  const result = businessCustomerBrandingSchema.safeParse(value && typeof value === 'object' ? value : {});
  return result.success ? result.data : businessCustomerBrandingSchema.parse({});
}

function rejectAuth(res, code = 'AUTH_INVALID_SESSION') {
  return res.status(401).json({ error: 'No autenticado', code });
}

function prepareOtp(schema) {
  return (req, res, next) => {
    const result = validate(schema, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const phone = normalizePhone(result.data.phone);
    if (!phone) return next(badRequest('Falta el teléfono'));
    // Share the existing phone limiter across local and international formats.
    req.body = { ...result.data, phone };
    next();
  };
}

/** @param {Partial<typeof defaults>} overrides */
export function createMobileRoutes(overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const router = Router();
  router.use('/mobile', (_req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  async function missingCustomer(req, res) {
    if (req.authSession?.id) {
      await deps.invalidateBrowserSessionById(req.authSession.id, 'customer_missing').catch(() => {});
    }
    return res.status(404).json({ error: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' });
  }

  function matchesCustomer(customer, auth) {
    return Boolean(customer && !customer.deleted_at && String(customer.id) === auth.id && String(customer.business_id) === auth.business_id);
  }

  const requireMobileCustomer = asyncRoute(async (req, res, next) => {
    const bearer = /^Bearer ([A-Za-z0-9_-]{1,256})$/i.exec(req.get('Authorization') || '');
    if (!bearer) return rejectAuth(res, 'AUTH_REQUIRED');
    const session = await deps.getBrowserSession(bearer[1]);
    if (!browserSessionStatus(session).ok || session.actor_type !== 'CUSTOMER' || !session.id || !session.actor_id || !session.business_id) {
      return rejectAuth(res);
    }
    const auth = { id: String(session.actor_id), business_id: String(session.business_id) };
    // Never use URL, query, body, cookie, or pre-existing request tenant values.
    await deps.setTenantForRequest(req, auth.business_id);
    req.authSession = session;
    req.customerAuth = auth;
    const customer = await deps.CustomerRepo.getById(auth.id);
    if (!matchesCustomer(customer, auth)) return missingCustomer(req, res);
    const touched = await deps.touchBrowserSessionIfNeeded(session).catch(() => session);
    if (!browserSessionStatus(touched).ok) return rejectAuth(res);
    req.authSession = touched;
    next();
  });

  router.post('/mobile/access/request-code', deps.accessRequestLimit, prepareOtp(accessRequestSchema), deps.accessRequestPhoneLimit, asyncRoute(async (req, res) => {
    res.json(await deps.accessService.requestCode({ phone: req.body.phone }));
  }));
  router.post('/mobile/access/verify', deps.accessVerifyLimit, prepareOtp(accessVerifySchema), deps.accessVerifyPhoneLimit, asyncRoute(async (req, res) => {
    res.json(await deps.accessService.verify({ phone: req.body.phone, code: req.body.code }));
  }));
  router.post('/mobile/access/select', deps.accessSelectLimit, asyncRoute(async (req, res) => {
    const result = validate(accessSelectSchema, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(await deps.accessService.select(result.data));
  }));

  router.get('/mobile/business/:slug', asyncRoute(async (req, res) => {
    const business = await deps.BusinessRepo.getPublicBySlug(req.params.slug);
    if (!business) throw notFound('Negocio no encontrado');
    res.json({
      ...businessIdentity(business),
      category: business.category,
      program_type: business.program_type,
      program_json: sanitizeProgramForClient(business.program_json),
      customer_branding: customerBranding(business.customer_branding_json)
    });
  }));

  // Express 5 route strings no longer support inline regular expressions.
  // Keep the same accepted modes and 404 behavior before any OTP side effect.
  router.param('mode', (_req, _res, next, mode) => ['login', 'join'].includes(mode) ? next() : next('route'));
  router.param('provider', (_req, _res, next, provider) => ['apple', 'google'].includes(provider) ? next() : next('route'));
  const otpPath = '/mobile/business/:slug/:mode';
  router.post(`${otpPath}/request-code`, deps.requestCodeLimit, prepareOtp(requestJoinCodeSchema), deps.requestPhoneLimit, asyncRoute(async (req, res) => {
    const business = await deps.BusinessRepo.getPublicBySlug(req.params.slug);
    if (!business) throw notFound('Negocio no encontrado');
    await deps.setTenantForRequest(req, business.id);
    res.json(await deps.requestJoinCode({
      business, phone: req.body.phone, email: req.body.email ?? null,
      name: req.body.name ?? null, requireExisting: req.params.mode === 'login'
    }));
  }));

  router.post(`${otpPath}/verify`, deps.verifyCodeLimit, prepareOtp(verifyJoinCodeSchema), deps.verifyPhoneLimit, asyncRoute(async (req, res) => {
    const business = await deps.BusinessRepo.getPublicBySlug(req.params.slug);
    if (!business) throw notFound('Negocio no encontrado');
    await deps.setTenantForRequest(req, business.id);
    const { customer, token } = await deps.verifyJoinCode({
      business, phone: req.body.phone, code: req.body.code, name: req.body.name ?? null,
      referralCode: req.params.mode === 'join' ? req.body.referralCode ?? null : null,
      requireExisting: req.params.mode === 'login'
    });
    const session = await deps.getBrowserSession(token);
    if (!browserSessionStatus(session).ok || session.actor_type !== 'CUSTOMER'
      || String(session.actor_id) !== String(customer.id) || String(session.business_id) !== String(business.id)
      || !matchesCustomer(customer, { id: String(session.actor_id), business_id: String(business.id) })) {
      return rejectAuth(res);
    }
    res.json({
      ok: true, token, expiresAt: new Date(session.absolute_expires_at).toISOString(),
      customer: project(customer, customerFields), business: businessIdentity(business)
    });
  }));

  // This credential grants only revocation, including after bearer expiry.
  router.post('/mobile/customer/push-device/revoke', deps.pushRevokeLimit, asyncRoute(async (req, res) => {
    res.json(await deps.pushService.revoke(req.body));
  }));

  router.use('/mobile/customer', requireMobileCustomer);
  router.get('/mobile/customer/push-status', asyncRoute(async (_req, res) => {
    res.json(deps.pushService.status());
  }));
  router.put('/mobile/customer/push-device', deps.pushRegisterLimit, asyncRoute(async (req, res) => {
    res.json(await deps.pushService.register(req.customerAuth, req.authSession, req.body));
  }));
  router.post('/mobile/customer/push-device/test', deps.pushTestLimit, asyncRoute(async (req, res) => {
    res.json(await deps.pushService.test(req.customerAuth, req.body));
  }));
  router.get('/mobile/customer', asyncRoute(async (req, res) => {
    const auth = req.customerAuth;
    await deps.settlePendingPointsForCustomer(auth.id, auth.business_id).catch(err => {
      logger.warn({ err: err?.message, customerId: auth.id, businessId: auth.business_id }, 'settlePendingPointsForCustomer failed');
    });
    await deps.expirePointsForCustomer(auth.id, auth.business_id).catch(err => {
      logger.warn({ err: err?.message, customerId: auth.id, businessId: auth.business_id }, 'expirePointsForCustomer failed');
    });
    const customer = await deps.CustomerRepo.getById(auth.id);
    if (!matchesCustomer(customer, auth)) return missingCustomer(req, res);
    const business = await deps.BusinessRepo.getById(auth.business_id);
    if (!business || String(business.id) !== auth.business_id) return missingCustomer(req, res);
    const overrides = await deps.PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
    const features = planFeaturesWithOverrides(business.plan, overrides);
    const rewardProgress = features.rewards
      ? await deps.getCustomerRewardProgress(deps.getDbClient(), { businessId: auth.business_id, customerId: auth.id }) : null;
    // Installed clients only understand stock/expiry, so expose eligible choices
    // without changing those fields or excluding choices still requiring points.
    const rewards = (rewardProgress?.choices ?? []).filter(reward => reward.active && reward.available);
    const transactions = await deps.TxnRepo.listByCustomer(auth.id, 50);
    const redemptions = await deps.RedemptionRepo.listByCustomer(auth.id, 50);
    const wallet = await deps.walletService.status(auth);
    const inBusiness = record => String(record.business_id) === auth.business_id;
    const forCustomer = record => inBusiness(record) && String(record.customer_id) === auth.id;
    res.json({
      ok: true,
      business: { ...businessIdentity(business), customer_branding: customerBranding(business.customer_branding_json), features },
      customer: project(customer, customerFields),
      rewards: rewards.map(record => ({
        ...project(record, rewardFields),
        valid_until: record.valid_until == null ? record.valid_until : new Date(record.valid_until).toISOString()
      })),
      reward_progress: rewardProgress,
      transactions: transactions.filter(forCustomer).map(record => project(record, transactionFields)),
      redemptions: redemptions.filter(forCustomer).map(record => project(record, redemptionFields)),
      wallet
    });
  }));

  router.post('/mobile/customer/qr', asyncRoute(async (req, res) => {
    res.json(await deps.issueCustomerQr({ businessId: req.customerAuth.business_id, customerId: req.customerAuth.id }));
  }));

  router.post('/mobile/customer/logout', asyncRoute(async (req, res) => {
    await deps.invalidateBrowserSessionById(req.authSession.id, 'logout');
    res.json({ ok: true });
  }));

  router.delete('/mobile/customer', asyncRoute(async (req, res) => {
    if (!deleteSchema.safeParse(req.body).success) throw badRequest('Confirma la eliminación con confirm: true.');
    await deps.withTransaction(async () => {
      await deps.CustomerRepo.softDelete(req.customerAuth.id);
      await deps.invalidateBrowserSessionsForActor({ actorType: 'CUSTOMER', actorId: req.customerAuth.id, reason: 'customer_deleted' });
    });
    res.json({ ok: true });
  }));

  router.post('/mobile/customer/wallet/:provider', deps.walletIssueLimit, asyncRoute(async (req, res) => {
    const result = await deps.walletService.issue(req.customerAuth, req.params.provider);
    res.json(req.params.provider === 'apple'
      ? { ...result, url: `${req.baseUrl}/mobile/customer/wallet/apple/download` }
      : result);
  }));

  router.get('/mobile/customer/wallet/apple/download', asyncRoute(async (req, res) => {
    const bytes = await deps.walletService.downloadApple(req.customerAuth);
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="PuntosFieles.pkpass"',
      'Content-Length': String(bytes.length)
    }).end(bytes);
  }));

  return router;
}

export const mobileRoutes = createMobileRoutes();
