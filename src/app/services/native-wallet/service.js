import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { HttpError, notFound, unauthorized } from "../../../utils/http-error.js";
import { errorCode } from "../../../utils/error-shape.js";

/**
 * Database client handed to the pass lock (pg PoolClient surface used here; the
 * project ships no pg type declarations).
 * @typedef {{ query: (text: string, values?: unknown[]) => Promise<{ rows: any[], rowCount?: number | null }> }} NativeWalletQueryClient
 */

/**
 * Customer session the mobile/customer routes resolve (req.customerAuth).
 * @typedef {{ id: string, business_id: string }} NativeWalletCustomerAuth
 */

/**
 * A native_wallet_passes row with decrypted credentials (NativeWalletRepo,
 * repositories owner). Only the columns this service reads are named.
 * @typedef {{
 *   id: string,
 *   provider: string,
 *   serial_number?: string,
 *   authentication_token?: string,
 *   business_id?: string,
 *   customer_id?: string,
 *   revoked_at?: string | Date | null,
 *   created_at?: string | Date | null,
 *   lock_token?: string | null,
 *   [column: string]: unknown
 * }} NativeWalletPassRow
 */

/**
 * Authoritative snapshot from NativeWalletRepo.getSnapshot (repositories owner): the
 * pass row joined with customer and business state plus the engagement block from
 * ./engagement.js. Providers validate what they render; this names what the service reads.
 * @typedef {{
 *   id: string,
 *   revision?: string | number | null,
 *   revoked_at?: string | Date | null,
 *   is_voided?: boolean | null,
 *   created_at?: string | Date | null,
 *   updated_at?: string | Date | null,
 *   next_refresh_at?: string | Date | null,
 *   [field: string]: unknown
 * }} NativeWalletSnapshot
 */

/**
 * One due refresh claimed by NativeWalletRepo.claimDue (repositories owner).
 * @typedef {{ id: string, provider: string, lock_token?: string | null, [column: string]: unknown }} NativeWalletDueJob
 */

/**
 * Pass storage as this service uses it. The customer-facing methods are optional
 * because a worker-only wiring (processDue) legitimately omits them; the customer
 * entry points assert their presence. Members are method signatures (bivariant
 * parameters) because NativeWalletRepo's `= null` defaults infer `null` parameter
 * types until the repository gains its own JSDoc.
 * @typedef {{
 *   getSnapshot(id: string): Promise<NativeWalletSnapshot | null | undefined>,
 *   claimDue(limit: number, providers: string[]): Promise<NativeWalletDueJob[]>,
 *   listRegistrations(passId: string): Promise<Array<{ push_token: string }>>,
 *   deletePushToken(token: string): Promise<unknown>,
 *   markSynced(id: string, revision: unknown, lockToken: string | null | undefined, nextRefreshAt: unknown): Promise<unknown>,
 *   markFailed(id: string, lockToken: string | null | undefined): Promise<unknown>,
 *   ensurePass?(pass: { id: string, businessId: string, customerId: string, provider: string, membershipToken: string, authenticationToken: string }): Promise<NativeWalletPassRow | null | undefined>,
 *   getCustomerPasses?(businessId: string, customerId: string): Promise<NativeWalletPassRow[]>,
 *   revokeCustomerPasses?(businessId: string, customerId: string): Promise<unknown>,
 *   getBySerial?(serial: string, provider: string | null | undefined): Promise<NativeWalletPassRow | null | undefined>
 * }} NativeWalletServiceRepo
 */

/**
 * Customer lookup (CustomerRepo.getById, repositories owner). An empty object is
 * accepted for worker-only wiring, which never resolves customers.
 * @typedef {{ getById: (id: string) => Promise<{ id: string, business_id: string } | null | undefined> }} NativeWalletCustomerRepo
 */

/**
 * Provider readiness as loadNativeWalletConfig reports it (./config.js); the Apple
 * web service also reads the configured pass type identifier.
 * @typedef {{ ready?: boolean, config?: { passTypeIdentifier?: string, [key: string]: unknown } | null }} NativeWalletProviderSettings
 */

/**
 * Snapshots are forwarded as the repository returns them; the providers validate their
 * own required fields, so these members are method signatures (bivariant parameters).
 * @typedef {{
 *   generatePass(snapshot: NativeWalletSnapshot): Promise<Buffer>,
 *   pushUpdate(pushToken: string): Promise<{ invalidToken?: boolean }>
 * }} NativeWalletAppleProvider
 * @typedef {{
 *   savePass(snapshot: NativeWalletSnapshot): Promise<string>,
 *   updatePass(snapshot: NativeWalletSnapshot): Promise<void>
 * }} NativeWalletGoogleProvider
 * @typedef {NativeWalletAppleProvider | NativeWalletGoogleProvider} NativeWalletProvider
 */

/**
 * @typedef {{
 *   repo: NativeWalletServiceRepo,
 *   customerRepo: NativeWalletCustomerRepo | Record<string, never>,
 *   settings: Record<string, NativeWalletProviderSettings>,
 *   providers: Record<string, NativeWalletProvider>,
 *   globalContext: <T>(fn: () => Promise<T>) => Promise<T>,
 *   withPassLock?: <T>(id: string, fn: () => Promise<T>) => Promise<T>
 * }} NativeWalletServiceDeps
 */

const unavailable = () =>
  new HttpError(503, "La tarjeta no está disponible en este momento. Intenta de nuevo más tarde.");
/**
 * @param {unknown} a
 * @param {unknown} b
 */
const secretEquals = (a, b) =>
  timingSafeEqual(
    createHash("sha256").update(String(a)).digest(),
    createHash("sha256").update(String(b)).digest(),
  );

/** @param {NativeWalletServiceDeps} deps */
export function createNativeWalletService({
  repo,
  customerRepo,
  settings,
  providers,
  globalContext,
  withPassLock = async (_id, fn) => fn(),
}) {
  const readyProviders = () =>
    ["apple", "google"].filter((name) => settings[name]?.ready && providers[name]);
  /**
   * The ready provider registered under `name`. Callers dispatch on that same name,
   * which the type system cannot correlate with the map lookup, so the result is
   * widened to the full capability set.
   * @param {string} name
   * @returns {NativeWalletAppleProvider & NativeWalletGoogleProvider}
   */
  const requireProvider = (name) => {
    if (!readyProviders().includes(name)) throw unavailable();
    return /** @type {NativeWalletAppleProvider & NativeWalletGoogleProvider} */ (providers[name]);
  };
  /** @param {NativeWalletCustomerAuth} auth */
  async function requireCustomer(auth) {
    const c = await customerRepo.getById(auth.id);
    if (!c || c.business_id !== auth.business_id) throw notFound("Cliente no encontrado");
  }
  /** @param {NativeWalletCustomerAuth} auth */
  async function status(auth) {
    const names = readyProviders();
    await requireCustomer(auth);
    /** @type {NativeWalletPassRow[]} */
    let passes;
    try {
      passes = await /** @type {Required<NativeWalletServiceRepo>} */ (repo).getCustomerPasses(
        auth.business_id,
        auth.id,
      );
    } catch (e) {
      // Disabled deployments may precede the additive migration; existing passes
      // stay visible for revocation whenever storage is available.
      if (!names.length && errorCode(e) === "42P01") passes = [];
      else throw e;
    }
    return {
      providers: { apple: names.includes("apple"), google: names.includes("google") },
      passes: passes
        .filter((p) => !p.revoked_at)
        .map((p) => ({ provider: p.provider, created_at: p.created_at })),
    };
  }
  /**
   * @param {NativeWalletCustomerAuth} auth
   * @param {string} providerName
   */
  async function issue(auth, providerName) {
    const provider = requireProvider(providerName);
    await requireCustomer(auth);
    const pass = await /** @type {Required<NativeWalletServiceRepo>} */ (repo).ensurePass({
      id: randomUUID(),
      businessId: auth.business_id,
      customerId: auth.id,
      provider: providerName,
      membershipToken: randomBytes(32).toString("base64url"),
      authenticationToken: randomBytes(32).toString("base64url"),
    });
    if (!pass) throw notFound("Cliente no encontrado");
    return withPassLock(pass.id, async () => {
      const snapshot = await repo.getSnapshot(pass.id);
      if (!snapshot || snapshot.revoked_at || snapshot.is_voided)
        throw notFound("La tarjeta fue desactivada. Intenta de nuevo.");
      try {
        if (providerName === "apple") {
          await provider.generatePass(snapshot);
          return { url: "/api/customer/wallet/apple/download" };
        }
        return { url: await provider.savePass(snapshot) };
      } catch {
        throw unavailable();
      }
    });
  }
  /** @param {NativeWalletCustomerAuth} auth */
  async function downloadApple(auth) {
    const provider = requireProvider("apple");
    await requireCustomer(auth);
    const passes = await /** @type {Required<NativeWalletServiceRepo>} */ (repo).getCustomerPasses(
      auth.business_id,
      auth.id,
    );
    const pass = passes.find((p) => p.provider === "apple" && !p.revoked_at);
    if (!pass) throw notFound("Primero solicita tu tarjeta Apple Wallet.");
    const snapshot = await repo.getSnapshot(pass.id);
    if (!snapshot || snapshot.revoked_at || snapshot.is_voided)
      throw notFound("La tarjeta fue desactivada.");
    try {
      return await provider.generatePass(snapshot);
    } catch {
      throw unavailable();
    }
  }
  /** @param {NativeWalletCustomerAuth} auth */
  async function revoke(auth) {
    await requireCustomer(auth);
    await /** @type {Required<NativeWalletServiceRepo>} */ (repo).revokeCustomerPasses(
      auth.business_id,
      auth.id,
    );
    return { ok: true };
  }
  /**
   * Apple Wallet web service authentication (pass type, serial and the
   * `ApplePass <token>` Authorization header as the device sends them).
   * @param {string} passType
   * @param {string} serial
   * @param {string | undefined} authorization
   */
  async function authenticateApple(passType, serial, authorization) {
    requireProvider("apple");
    if (
      // A ready Apple provider implies loadNativeWalletConfig stored its config.
      passType !==
        /** @type {{ passTypeIdentifier?: string }} */ (settings.apple.config).passTypeIdentifier ||
      !/^ApplePass [A-Za-z0-9_-]{43}$/.test(authorization || "")
    )
      throw unauthorized();
    const pass = await globalContext(() =>
      /** @type {Required<NativeWalletServiceRepo>} */ (repo).getBySerial(serial, "apple"),
    );
    if (
      !pass ||
      pass.provider !== "apple" ||
      pass.serial_number !== serial ||
      // The pattern above only matches a string, so the header is present here.
      !secretEquals(/** @type {string} */ (authorization).slice(10), pass.authentication_token)
    )
      throw unauthorized();
    return pass;
  }
  /** @param {{ id: string }} pass */
  async function updatedApplePass(pass) {
    const snapshot = await globalContext(() => repo.getSnapshot(pass.id));
    if (!snapshot) throw notFound();
    try {
      return {
        bytes: await requireProvider("apple").generatePass(snapshot),
        revision: snapshot.revision,
        updatedAt: snapshot.updated_at || snapshot.created_at,
      };
    } catch {
      throw unavailable();
    }
  }
  async function processDue() {
    const names = readyProviders();
    const result = { delivered: 0, failed: 0 };
    if (!names.length) return result;
    const jobs = await globalContext(() => repo.claimDue(20, names));
    for (const job of jobs) {
      try {
        const delivered = await globalContext(() =>
          withPassLock(job.id, async () => {
            const snapshot = await repo.getSnapshot(job.id);
            if (!snapshot) throw Error("Missing pass");
            const provider = requireProvider(job.provider);
            if (job.provider === "google") await provider.updatePass(snapshot);
            else {
              const registrations = await repo.listRegistrations(job.id);
              let deliveryFailed = false;
              for (const registration of registrations) {
                let response;
                try {
                  response = await provider.pushUpdate(registration.push_token);
                } catch {
                  deliveryFailed = true;
                  continue;
                }
                if (response.invalidToken) await repo.deletePushToken(registration.push_token);
              }
              if (deliveryFailed) {
                // Commit invalid-token cleanup while retaining retry work. Throwing
                // here would roll back those deletions with the provider lock.
                await repo.markFailed(job.id, job.lock_token);
                return false;
              }
            }
            await repo.markSynced(
              job.id,
              snapshot.revision,
              job.lock_token,
              snapshot.next_refresh_at ?? null,
            );
            return true;
          }),
        );
        if (delivered) result.delivered++;
        else result.failed++;
      } catch {
        await globalContext(() => repo.markFailed(job.id, job.lock_token));
        result.failed++;
      }
    }
    return result;
  }
  return {
    status,
    issue,
    downloadApple,
    revoke,
    authenticateApple,
    updatedApplePass,
    processDue,
    requireProvider,
  };
}
