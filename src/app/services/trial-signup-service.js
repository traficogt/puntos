// Self-serve trial signup (design sections 4.1 and 8): Turnstile on the code request and
// on the final step, the platform phone proof (mobile_access_codes) for the owner's phone,
// a single-use signup grant, one trial per verified phone, and the same business creation
// path the internal page and the super console use (createBusinessWithOwner).
import crypto from "node:crypto";
import { config } from "../../config/index.js";
import { runWithDbContext, withDbClientContext, withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { MobileAccessRepo } from "../repositories/mobile-access-repository.js";
import { TrialRepo } from "../repositories/trial-repository.js";
import { hashSessionToken } from "./auth-session-service.js";
import { emitBillingEvent } from "./billing-service.js";
import { createBusinessWithOwner } from "./business-service.js";
import { verifyTurnstile } from "./contact-service.js";
import { sendMessage } from "./messaging-service.js";
import { createPhoneProof, normalizeProofPhone } from "./mobile-access-service.js";
import { PLAN_DISPLAY_NAMES, TRIAL_PLAN } from "./public-plan-service.js";
import { countTrialSignupStep } from "./trial-metrics.js";
import { sendTrialEmail, trialEmailReady } from "./trial-email-service.js";
import { DEFAULT_TRIAL_TIMEZONE, trialState } from "./trial-state.js";
import { isPlanName, normalizePlan, PLAN_PRICING_USD } from "../../utils/plan.js";
import { badRequest, conflict, HttpError, unauthorized } from "../../utils/http-error.js";
import { errorMessage, isErrorLike } from "../../utils/error-shape.js";
import { logger } from "../../utils/logger.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/** @typedef {import("../repositories/business-repository.js").BusinessRow} BusinessRow */
/**
 * Collaborators; unit tests inject fakes, so only the members used here are typed.
 * @typedef {{
 *   accessRepo: import("./mobile-access-service.js").PhoneProofRepoLike,
 *   repo: Pick<typeof TrialRepo,
 *     "createGrant" | "lockGrant" | "consumeGrant" | "restoreGrant" | "phoneHasTrial" | "countPhoneCodesToday" | "markNotified">,
 *   runWithDbContext: typeof runWithDbContext,
 *   withTransaction: <T>(fn: (client: TxClient) => Promise<T>) => Promise<T>,
 *   withDbClientContext: <T>(ctx: { tenantId: string | null, platformAdmin: boolean }, fn: () => Promise<T>) => Promise<T>,
 *   sendMessage: (message: Parameters<typeof sendMessage>[0]) => Promise<{ ok?: boolean }>,
 *   verifyTurnstile: (token: string, remoteip: string | null) => Promise<boolean>,
 *   createBusinessWithOwner: typeof createBusinessWithOwner,
 *   getBusinessByEmail: (email: string) => Promise<unknown>,
 *   sendTrialEmail: typeof sendTrialEmail,
 *   emailReady: () => boolean,
 *   emitBillingEvent: typeof emitBillingEvent,
 *   countStep: typeof countTrialSignupStep,
 *   config: Pick<import("../../types/config.js").AppConfig,
 *     "NODE_ENV" | "CONTACT_TURNSTILE_SECRET" | "MESSAGE_PROVIDER" | "TRIAL_DAYS" | "TRIAL_OTP_DAILY_CAP" | "TRIAL_ALLOWED_DIAL_CODES" | "APP_ORIGIN">,
 *   now: () => Date,
 *   log: { warn: (ctx: object, msg: string) => void, info: (ctx: object, msg: string) => void }
 * }} TrialSignupDeps
 */

const GRANT_TTL_MS = 5 * 60 * 1000;
const GRANT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const grantInvalid = () =>
  unauthorized("Tu verificación venció. Verifica tu teléfono de nuevo.", "TRIAL_GRANT_INVALID");
const codeInvalid = () =>
  unauthorized("Código inválido o vencido. Solicita un código nuevo.", "TRIAL_CODE_INVALID");
const phoneUsed = () =>
  conflict(
    "Ya existe una prueba con este teléfono. Inicia sesión o escríbenos.",
    "TRIAL_PHONE_USED",
  );
const turnstileFailed = () =>
  badRequest("Verificación fallida. Intenta de nuevo.", "TURNSTILE_FAILED");
const unavailable = () =>
  new HttpError(
    503,
    "El registro en línea no está disponible por ahora. Escríbenos y lo activamos contigo.",
    "TRIAL_SIGNUP_UNAVAILABLE",
  );
const capReached = () =>
  new HttpError(
    503,
    "Por ahora no podemos enviar más códigos. Intenta más tarde o escríbenos.",
    "TRIAL_OTP_CAP",
  );

/**
 * Self-serve signup is offered only when Turnstile protects it in production (design
 * section 8) and the SMS circuit breaker is not set to zero.
 * @param {Pick<TrialSignupDeps["config"], "NODE_ENV" | "CONTACT_TURNSTILE_SECRET" | "TRIAL_OTP_DAILY_CAP">} cfg
 */
export function trialSignupAvailable(cfg = config) {
  const protectedInProd = cfg.NODE_ENV !== "production" || Boolean(cfg.CONTACT_TURNSTILE_SECRET);
  return protectedInProd && Number(cfg.TRIAL_OTP_DAILY_CAP) > 0;
}

/**
 * @param {string} phone digits only
 * @param {readonly string[]} allowed dial codes; an empty list allows every phone
 */
export function assertAllowedDialCode(phone, allowed) {
  if (!allowed.length) return;
  if (!allowed.some((code) => phone.startsWith(String(code))))
    throw badRequest(
      "Por ahora la prueba está disponible para teléfonos de Guatemala (+502).",
      "TRIAL_PHONE_NOT_ALLOWED",
    );
}

/** @type {TrialSignupDeps} */
const defaults = {
  accessRepo: MobileAccessRepo,
  repo: TrialRepo,
  runWithDbContext,
  withTransaction,
  withDbClientContext,
  sendMessage,
  verifyTurnstile,
  createBusinessWithOwner,
  getBusinessByEmail: (email) => BusinessRepo.getByEmail(email),
  sendTrialEmail,
  emailReady: trialEmailReady,
  emitBillingEvent,
  countStep: countTrialSignupStep,
  config,
  now: () => new Date(),
  log: logger,
};

/** @param {Partial<TrialSignupDeps>} [overrides] */
export function createTrialSignupService(overrides = {}) {
  /** @type {TrialSignupDeps} */
  const deps = { ...defaults, ...overrides };
  const proof = createPhoneProof({
    repo: deps.accessRepo,
    runWithDbContext: deps.runWithDbContext,
    withTransaction: deps.withTransaction,
    sendMessage: deps.sendMessage,
  });
  /**
   * @template T
   * @param {() => Promise<T>} fn
   */
  const platform = (fn) => deps.withDbClientContext({ tenantId: null, platformAdmin: true }, fn);
  /**
   * @template T
   * @param {string} businessId
   * @param {() => Promise<T>} fn
   */
  const tenant = (businessId, fn) =>
    deps.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
  const devCodes = () =>
    deps.config.MESSAGE_PROVIDER === "dev" && deps.config.NODE_ENV !== "production";

  function assertAvailable() {
    if (!trialSignupAvailable(deps.config)) throw unavailable();
  }
  /**
   * @param {unknown} token
   * @param {string | null} ip
   */
  async function assertTurnstile(token, ip) {
    const ok = await deps.verifyTurnstile(String(token ?? ""), ip).catch(() => false);
    if (!ok) throw turnstileFailed();
  }

  /**
   * Best-effort facts and welcome mail after the business exists; failures are logged and
   * never undo the signup.
   * @param {BusinessRow} business
   * @param {{ intended: string | null, state: import("./trial-state.js").TrialState, timezone: string }} input
   */
  async function afterCreate(business, { intended, state, timezone }) {
    await tenant(business.id, async () => {
      await deps.emitBillingEvent({
        businessId: business.id,
        eventType: "trial.started",
        metadata: {
          source: "self_serve",
          trial_ends_at: state.ends_at,
          phone_verified: true,
          intended_plan: intended,
        },
      });
      if (!deps.emailReady()) return;
      const origin = String(deps.config.APP_ORIGIN).replace(/\/+$/, "");
      const outcome = await deps.sendTrialEmail({
        to: business.email,
        kind: "welcome",
        context: {
          businessName: business.name,
          panelUrl: `${origin}/negocio/`,
          joinUrl: `${origin}/registro/${business.slug}`,
          planUrl: `${origin}/negocio/#plan`,
          exportUrl: `${origin}/negocio/#clientes`,
          endsAt: state.ends_at,
          timezone,
          planName: PLAN_DISPLAY_NAMES[TRIAL_PLAN],
          priceUsd: PLAN_PRICING_USD[TRIAL_PLAN],
          progress: null,
        },
      });
      if (outcome.ok)
        await deps.repo.markNotified({
          businessId: business.id,
          kind: "welcome",
          destination: business.email,
          providerId: outcome.providerId ?? null,
        });
    });
  }

  return {
    available: () => trialSignupAvailable(deps.config),

    /**
     * Step 2a: Turnstile, phone normalisation, dial-code allowlist, the platform SMS
     * circuit breaker, then the shared phone proof (its own per-phone limits).
     * @param {{ phone: unknown, turnstileToken: unknown, ip?: string | null }} input
     */
    async requestCode({ phone: input, turnstileToken, ip = null }) {
      assertAvailable();
      await assertTurnstile(turnstileToken, ip);
      const phone = normalizeProofPhone(input);
      assertAllowedDialCode(phone, deps.config.TRIAL_ALLOWED_DIAL_CODES);
      const issued = await proof.transaction(() => deps.repo.countPhoneCodesToday());
      if (issued >= deps.config.TRIAL_OTP_DAILY_CAP) {
        deps.log.warn(
          { issued, cap: deps.config.TRIAL_OTP_DAILY_CAP },
          "Trial OTP daily cap reached",
        );
        throw capReached();
      }
      const { code } = await proof.requestCode(phone);
      deps.countStep("code_requested");
      // Development only: the dev provider delivers nothing, so the code is returned the
      // way the customer join flow does (customer-service.js requestJoinCode).
      return { ok: true, phone, ...(devCodes() ? { dev_code: code } : {}) };
    },

    /**
     * Step 2b: consume the code and hand out a 5-minute single-use signup grant. A phone
     * that already owns a trial is refused here, after it proved possession.
     * @param {{ phone: unknown, code: unknown }} input
     */
    async verify({ phone: input, code }) {
      assertAvailable();
      const phone = normalizeProofPhone(input);
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(deps.now().getTime() + GRANT_TTL_MS);
      /** @type {{ error?: HttpError }} */
      const result = await proof.transaction(async () => {
        // Return instead of throwing so a failed-attempt increment commits.
        if (!(await proof.verifyCode(phone, code))) return { error: codeInvalid() };
        if (await deps.repo.phoneHasTrial(phone)) return { error: phoneUsed() };
        await deps.repo.createGrant({
          id: crypto.randomUUID(),
          token_hash: hashSessionToken(token),
          phone,
          expires_at: expiresAt,
        });
        return {};
      });
      if (result.error) throw result.error;
      deps.countStep("code_verified");
      return { ok: true, grant: token, expires_at: expiresAt.toISOString() };
    },

    /**
     * Step 3: Turnstile again, consume the grant, then create the business on Conecta as
     * a trial. The grant is restored when creation fails so the owner can retry.
     * @param {{
     *   grant: unknown,
     *   businessName: string,
     *   email: string,
     *   password: string,
     *   category?: string | null,
     *   turnstileToken: unknown,
     *   ip?: string | null,
     *   plan?: string | null
     * }} input
     */
    async signup({
      grant,
      businessName,
      email,
      password,
      category = null,
      turnstileToken,
      ip = null,
      plan = null,
    }) {
      assertAvailable();
      await assertTurnstile(turnstileToken, ip);
      if (typeof grant !== "string" || !GRANT_PATTERN.test(grant)) throw grantInvalid();
      const normalizedEmail = String(email).trim().toLowerCase();
      if (await platform(() => deps.getBusinessByEmail(normalizedEmail)))
        throw conflict("Este correo ya está registrado");
      /** @type {{ error?: HttpError, id?: string, phone?: string }} */
      const consumed = await proof.transaction(async () => {
        const row = await deps.repo.lockGrant(hashSessionToken(grant));
        if (!row) return { error: grantInvalid() };
        if (await deps.repo.phoneHasTrial(row.phone)) return { error: phoneUsed() };
        if (!(await deps.repo.consumeGrant(row.id))) return { error: grantInvalid() };
        return { id: row.id, phone: row.phone };
      });
      if (consumed.error || !consumed.id || !consumed.phone) throw consumed.error ?? grantInvalid();
      const grantId = consumed.id,
        phone = consumed.phone;
      const now = deps.now();
      const timezone = DEFAULT_TRIAL_TIMEZONE;
      /** @type {Awaited<ReturnType<typeof createBusinessWithOwner>>} */
      let created;
      try {
        created = await deps.createBusinessWithOwner({
          businessName,
          email: normalizedEmail,
          phone,
          password,
          category,
          program_type: "SPEND",
          // No silent default rule: the owner chooses a model in the app ("Elige").
          program_json: {},
          slug: null,
          plan: TRIAL_PLAN,
          signup: {
            source: "self_serve",
            trial_phone: phone,
            trial_days: deps.config.TRIAL_DAYS,
            now,
            timezone,
          },
        });
      } catch (error) {
        await proof.transaction(() => deps.repo.restoreGrant(grantId)).catch(() => {});
        if (
          isErrorLike(error) &&
          error.code === "23505" &&
          String(error.constraint || "").includes("trial_phone")
        )
          throw phoneUsed();
        throw error;
      }
      deps.countStep("created");
      const normalizedPlan = plan ? normalizePlan(plan) : "";
      const intended = isPlanName(normalizedPlan) ? normalizedPlan : null;
      const state = trialState(created.business, { now, timezone });
      await afterCreate(created.business, { intended, state, timezone }).catch((error) =>
        deps.log.warn(
          { businessId: created.business.id, err: errorMessage(error) },
          "Trial post-signup step did not complete",
        ),
      );
      return { ...created, trial: state, intended_plan: intended };
    },
  };
}

export const trialSignupService = createTrialSignupService();
