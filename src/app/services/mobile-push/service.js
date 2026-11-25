import { z } from "zod";
import { HttpError, badRequest, conflict } from "../../../utils/http-error.js";
import { planFeaturesWithOverrides } from "../../../utils/plan.js";

/**
 * mobile_push_devices row joined with the business plan, as MobilePushRepo.getSnapshot returns it.
 * @typedef {{
 *   installation_id: string,
 *   customer_id: string,
 *   business_id: string,
 *   token: string,
 *   topic: string,
 *   points: unknown,
 *   pending_points: unknown,
 *   baseline_points: unknown,
 *   baseline_pending: unknown,
 *   revision: unknown,
 *   plan: string,
 *   [key: string]: unknown,
 * }} PushSnapshot
 */
/** A leased device (installation, generation and lock token); opaque to this service. */
/** @typedef {{ installation_id: string, [key: string]: unknown }} PushClaim */
/** @typedef {{ accepted: boolean, invalidToken?: boolean, retryable?: boolean, reason?: string }} PushSendResult */
/**
 * Storage the service drives (MobilePushRepo, or a unit-test fake). The reward-refresh
 * integration test injects only the processDue members, so the device-facing methods are
 * optional here and asserted present where they are used.
 * @typedef {{
 *   register?(input: {
 *     installationId: string,
 *     installationSecret: string,
 *     token: string,
 *     platform: string,
 *     businessId: string,
 *     customerId: string,
 *     sessionId: string,
 *     topic: string,
 *   }): Promise<{ enabled: boolean, [key: string]: unknown }>,
 *   revoke?(installationId: string, installationSecret: string): Promise<unknown>,
 *   claimDue(limit: number): Promise<PushClaim[]>,
 *   getSnapshot(claim: PushClaim): Promise<PushSnapshot | null>,
 *   acknowledge(claim: PushClaim, snapshot: PushSnapshot): Promise<unknown>,
 *   fail(claim: PushClaim, result: { invalidToken?: boolean, retryable?: boolean }): Promise<unknown>,
 *   claimTest?(input: {
 *     installationId: string,
 *     installationSecret: string,
 *     businessId: string,
 *     customerId: string,
 *   }): Promise<PushClaim | null>,
 *   releaseTest?(claim: PushClaim): Promise<unknown>,
 * }} MobilePushRepoLike
 */
/**
 * Collaborators; unit tests inject fakes, so only the members used here are typed.
 * `provider` and `settings.config` are present whenever `settings.ready` is true.
 * @typedef {{
 *   repo: MobilePushRepoLike,
 *   provider: {
 *     send(input: { token: string, payload: unknown, collapseId: string }): Promise<PushSendResult>,
 *   } | null | undefined,
 *   settings: { ready: boolean, config: { topic: string } | null },
 *   getRewardProgress: (identity: { businessId: string, customerId: string }) => Promise<{
 *     choices?: Array<{ active?: boolean, available?: boolean, points_cost?: unknown }>,
 *   } | null | undefined>,
 *   planConfigService: {
 *     getPlanFeatureOverrides(): Promise<Parameters<typeof planFeaturesWithOverrides>[1]>,
 *   },
 *   globalContext: <T>(fn: () => Promise<T>) => Promise<T>,
 * }} MobilePushServiceDeps
 */

const credentials = {
  installationId: z.guid(),
  installationSecret: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .refine((value) => Buffer.from(value, "base64url").toString("base64url") === value),
};
const credentialSchema = z.object(credentials).strict();
const registrationSchema = z
  .object({
    ...credentials,
    token: z.string().regex(/^(?:[a-fA-F0-9]{2}){16,256}$/),
    platform: z.literal("ios"),
  })
  .strict();
/**
 * @template {import("zod").ZodType} T
 * @param {T} schema
 * @param {unknown} input
 * @returns {import("zod").output<T>}
 */
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw badRequest("Datos de notificaciones inválidos.");
  return result.data;
}
const unavailable = () =>
  new HttpError(503, "Notificaciones no disponibles. Intenta de nuevo más tarde.");
/**
 * @param {PushSnapshot} snapshot
 * @param {string} kind
 * @param {boolean} [test]
 */
function payload(snapshot, kind, test = false) {
  return {
    aps: {
      alert: {
        title: "PuntosFieles",
        body: test
          ? "Las notificaciones están activas."
          : kind === "rewards"
            ? "Tienes una recompensa disponible. Abre PuntosFieles para verla."
            : "Tu tarjeta tiene novedades. Abre PuntosFieles para verlas.",
      },
      sound: "default",
    },
    kind,
    customerId: snapshot.customer_id,
    businessId: snapshot.business_id,
  };
}

/** @param {MobilePushServiceDeps} deps */
export function createMobilePushService({
  repo,
  provider,
  settings,
  getRewardProgress,
  planConfigService,
  globalContext,
}) {
  const available = () => Boolean(settings.ready && provider);
  /**
   * @template T
   * @param {() => Promise<T>} fn
   */
  const run = (fn) => globalContext(fn);
  const assertAvailable = () => {
    if (!available()) throw unavailable();
  };
  // Callers check available() first; see the deps typedef.
  const pushProvider = () =>
    /** @type {NonNullable<MobilePushServiceDeps["provider"]>} */ (provider);
  const topic = () => /** @type {{ topic: string }} */ (settings.config).topic;
  // Device-facing storage; see MobilePushRepoLike.
  const devices = () => /** @type {Required<MobilePushRepoLike>} */ (repo);
  /** @param {PushSnapshot} snapshot */
  async function kindFor(snapshot) {
    if (Number(snapshot.points) <= Number(snapshot.baseline_points)) return "card";
    const overrides = await planConfigService.getPlanFeatureOverrides();
    if (!planFeaturesWithOverrides(snapshot.plan, overrides).rewards) return "card";
    const progress = await getRewardProgress({
      businessId: snapshot.business_id,
      customerId: snapshot.customer_id,
    });
    return (progress?.choices ?? []).some(
      (reward) =>
        reward.active &&
        reward.available &&
        Number(reward.points_cost) > Number(snapshot.baseline_points) &&
        Number(reward.points_cost) <= Number(snapshot.points),
    )
      ? "rewards"
      : "card";
  }
  return {
    status() {
      return { available: available() };
    },
    /**
     * @param {{ id: string, business_id: string }} auth
     * @param {{ id: string }} session
     * @param {unknown} input
     */
    async register(auth, session, input) {
      assertAvailable();
      const data = parse(registrationSchema, input);
      return run(() =>
        devices().register({
          ...data,
          token: data.token.toLowerCase(),
          businessId: auth.business_id,
          customerId: auth.id,
          sessionId: session.id,
          topic: topic(),
        }),
      );
    },
    /** @param {unknown} input */
    async revoke(input) {
      const data = parse(credentialSchema, input);
      return run(() => devices().revoke(data.installationId, data.installationSecret));
    },
    /**
     * @param {{ id: string, business_id: string }} auth
     * @param {unknown} input
     */
    async test(auth, input) {
      assertAvailable();
      const data = parse(credentialSchema, input);
      const claim = await run(() =>
        devices().claimTest({ ...data, businessId: auth.business_id, customerId: auth.id }),
      );
      if (!claim)
        throw conflict("No se pudo enviar la prueba. Revisa la activación e intenta en un minuto.");
      try {
        const snapshot = await run(() => repo.getSnapshot(claim));
        if (
          !snapshot ||
          snapshot.topic !== topic() ||
          snapshot.customer_id !== auth.id ||
          snapshot.business_id !== auth.business_id
        )
          throw unavailable();
        const result = await pushProvider().send({
          token: snapshot.token,
          payload: payload(snapshot, "card", true),
          collapseId: `pf-test-${snapshot.installation_id}`,
        });
        if (!result.accepted) {
          await run(() => repo.fail(claim, result));
          throw unavailable();
        }
        return { sent: true };
      } finally {
        await run(() => devices().releaseTest(claim));
      }
    },
    async processDue() {
      const totals = { sent: 0, failed: 0, skipped: 0 };
      if (!available()) return totals;
      const claims = await run(() => repo.claimDue(20));
      for (const claim of claims) {
        try {
          let snapshot = await run(() => repo.getSnapshot(claim));
          if (!snapshot) {
            totals.skipped++;
            continue;
          }
          if (snapshot.topic !== topic()) {
            await run(() => repo.fail(claim, { retryable: false }));
            totals.failed++;
            continue;
          }
          if (
            Number(snapshot.points) === Number(snapshot.baseline_points) &&
            Number(snapshot.pending_points) === Number(snapshot.baseline_pending)
          ) {
            // Narrowed above; this closure runs before snapshot is reassigned.
            await run(() => repo.acknowledge(claim, /** @type {PushSnapshot} */ (snapshot)));
            totals.skipped++;
            continue;
          }
          const kind = await kindFor(snapshot);
          // No network transaction: check generation, revocation and lease again
          // immediately before submitting to APNs. Never acknowledge a new revision.
          const latest = await run(() => repo.getSnapshot(claim));
          if (!latest) {
            totals.skipped++;
            continue;
          }
          if (latest.revision !== snapshot.revision) {
            await run(() => repo.fail(claim, { retryable: true }));
            totals.skipped++;
            continue;
          }
          snapshot = latest;
          const result = await pushProvider().send({
            token: snapshot.token,
            payload: payload(snapshot, kind),
            collapseId: `pf-${kind}-${snapshot.installation_id}`,
          });
          if (result.accepted) {
            await run(() => repo.acknowledge(claim, snapshot));
            totals.sent++;
          } else {
            await run(() => repo.fail(claim, result));
            totals.failed++;
          }
        } catch {
          await run(() => repo.fail(claim, { retryable: true }));
          totals.failed++;
        }
      }
      return totals;
    },
  };
}
