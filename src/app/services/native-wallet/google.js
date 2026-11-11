import { importPKCS8, SignJWT } from "jose";
import { parsePublicWalletUrl } from "./config.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const ISSUER_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const REQUEST_TIMEOUT_MS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @typedef {{ issuerId: string, serviceAccountEmail: string, privateKey: string, appOrigin: string, logoUrl?: string, organizationName?: string, privateKeyId?: string }} GoogleConfig */
/** @typedef {{ id: string, serial_number: string, barcode: string, customer_name?: string | null, business_name: string, business_id: string, customer_id?: string, points: number, pending_points: number, revoked_at?: string | Date | null, is_voided?: boolean, wallet_engagement?: {progress?:string,earning?:string,conditions?:string,usage?:string,locations?:Array<{latitude:number,longitude:number}>}, revision?: number }} PassSnapshot */

function walletError(code, message, status = undefined) {
  return Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) });
}

function invalidConfig() {
  return walletError("GOOGLE_WALLET_INVALID_CONFIG", "Google Wallet configuration is invalid.");
}

function publicHttpsUrl(value) {
  const url = parsePublicWalletUrl(value);
  if (!url) throw invalidConfig();
  return url;
}

const localized = value => ({ defaultValue: { language: "es-GT", value } });

// Google may return extra image/localization metadata; compare only fields we own.
function matchesManagedFields(actual, expected) {
  if (expected && typeof expected === "object") {
    return Object.entries(expected).every(([key, value]) => matchesManagedFields(actual?.[key], value));
  }
  return actual === expected;
}

/**
 * The caller supplies an authoritative database snapshot, never client-submitted balances.
 * Live activation requires a Wallet issuer account, authorized service account, public
 * branding assets and Google's publishing approval; creating this adapter does not confer it.
 * @param {GoogleConfig} config
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [dependencies]
 */
export function createGoogleProvider(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!config || typeof config.issuerId !== "string" || !/^\d+$/.test(config.issuerId)
    || typeof config.serviceAccountEmail !== "string" || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(config.serviceAccountEmail)
    || typeof config.privateKey !== "string" || !config.privateKey.includes("-----BEGIN PRIVATE KEY-----")) throw invalidConfig();
  const appUrl = publicHttpsUrl(config.appOrigin);
  if (appUrl.pathname !== "/" || appUrl.search) throw invalidConfig();
  const appOrigin = appUrl.origin;
  const logoUrl = publicHttpsUrl(config.logoUrl || `${appOrigin}/images/wallet/google-logo.png`).href;
  const issuerName = config.organizationName?.trim() || "PF";
  const header = { alg: "RS256", typ: "JWT", ...(config.privateKeyId ? { kid: config.privateKeyId } : {}) };
  let keyPromise;
  let accessToken;
  let tokenExpiresAt = 0;
  let refreshPromise;

  async function sign(claims) {
    try {
      keyPromise ??= importPKCS8(config.privateKey, "RS256");
      return await new SignJWT(claims).setProtectedHeader(header).sign(await keyPromise);
    } catch {
      throw walletError("GOOGLE_WALLET_SIGNING_FAILED", "Google Wallet signing failed.");
    }
  }

  /** HTTP errors deliberately retain neither response bodies nor raw error causes. */
  async function request(url, init, allowedStatuses = []) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(walletError("GOOGLE_WALLET_TIMEOUT", "Google Wallet request timed out."));
      }, REQUEST_TIMEOUT_MS);
    });
    const operation = async () => {
      let response;
      try {
        response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: "error" });
      } catch {
        if (controller.signal.aborted) throw walletError("GOOGLE_WALLET_TIMEOUT", "Google Wallet request timed out.");
        throw walletError("GOOGLE_WALLET_REQUEST_FAILED", "Google Wallet request failed.");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (allowedStatuses.includes(response.status)) return { status: response.status, data: null };
        throw walletError("GOOGLE_WALLET_HTTP_ERROR", `Google Wallet request failed (HTTP ${response.status}).`, response.status);
      }
      try {
        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
        return { status: response.status, data };
      } catch {
        throw walletError("GOOGLE_WALLET_INVALID_RESPONSE", "Google Wallet returned an invalid response.");
      }
    };
    try { return await Promise.race([operation(), timeout]); }
    finally { clearTimeout(timer); }
  }

  async function getAccessToken() {
    if (accessToken && now() < tokenExpiresAt) return accessToken;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const requestedAt = now();
      const issuedAt = Math.floor(requestedAt / 1000);
      const assertion = await sign({ iss: config.serviceAccountEmail, scope: ISSUER_SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600 });
      const { data } = await request(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()
      });
      if (typeof data.access_token !== "string" || !data.access_token || /\s/.test(data.access_token)
        || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0
        || (data.token_type !== undefined && (typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer"))) {
        throw walletError("GOOGLE_WALLET_INVALID_RESPONSE", "Google Wallet returned an invalid response.");
      }
      accessToken = data.access_token;
      tokenExpiresAt = requestedAt + Math.max(0, Math.min(data.expires_in, 3600) - 60) * 1000;
      return accessToken;
    })();
    try { return await refreshPromise; }
    finally { refreshPromise = undefined; }
  }

  async function api(method, resource, body = undefined, allowedStatuses = []) {
    const token = await getAccessToken();
    try {
      return await request(`${API_BASE}/${resource}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }, allowedStatuses);
    } catch (error) {
      if (error.status === 401 && accessToken === token) {
        accessToken = undefined;
        tokenExpiresAt = 0;
      }
      throw error;
    }
  }

  /** @param {PassSnapshot} snapshot */
  function passData(snapshot) {
    if (!snapshot || !UUID.test(snapshot.id) || !UUID.test(snapshot.business_id)
      || typeof snapshot.business_name !== "string" || !snapshot.business_name.trim()
      || typeof snapshot.serial_number !== "string" || !snapshot.serial_number
      || typeof snapshot.barcode !== "string" || !snapshot.barcode
      || !Number.isInteger(snapshot.points) || snapshot.points < -2147483648 || snapshot.points > 2147483647
      || !Number.isInteger(snapshot.pending_points) || snapshot.pending_points < 0 || snapshot.pending_points > 2147483647
      || (snapshot.customer_name != null && typeof snapshot.customer_name !== "string")) {
      throw walletError("GOOGLE_WALLET_INVALID_SNAPSHOT", "Google Wallet pass data is invalid.");
    }
    const id = `${config.issuerId}.pf_${snapshot.id.replaceAll("-", "").toLowerCase()}`;
    const classId = `${config.issuerId}.pf_${snapshot.business_id.replaceAll("-", "").toLowerCase()}`;
    const voided = Boolean(snapshot.revoked_at || snapshot.is_voided);
    const engagement = voided ? null : snapshot.wallet_engagement;
    const object = {
      id, classId,
      state: voided ? "INACTIVE" : "ACTIVE",
      accountId: snapshot.serial_number,
      accountName: voided ? "Tarjeta desactivada" : snapshot.customer_name?.trim() || "Cliente",
      barcode: { type: "QR_CODE", value: snapshot.barcode },
      loyaltyPoints: { label: "Puntos", balance: { int: voided ? 0 : snapshot.points } },
      secondaryLoyaltyPoints: { label: "Pendientes", balance: { int: voided ? 0 : snapshot.pending_points } },
      // These object fields are replaced, including empty arrays on revocation.
      // Refreshes do not request visible alerts or append promotional messages.
      textModulesData: [
        ...(engagement?.progress ? [{ id: "reward_progress", header: "Tu próxima recompensa", body: engagement.progress }] : []),
        ...(engagement?.conditions ? [{ id: "reward_conditions", header: "Condiciones del canje", body: engagement.conditions }] : []),
        ...(engagement?.earning ? [{ id: "earning_terms", header: "Cómo acumulas", body: engagement.earning }] : []),
        ...(engagement?.usage ? [{ id: "card_usage", header: "Cómo usar tu tarjeta", body: engagement.usage }] : [])
      ],
      merchantLocations: (engagement?.locations ?? []).slice(0, 10).map(({ latitude, longitude }) => ({ latitude, longitude })),
      linksModuleData: { uris: [{ id: "customer_account", uri: `${appOrigin}/mi-tarjeta/`, description: "Ver mi cuenta y recompensas" }] }
    };
    const passClass = {
      id: classId,
      issuerName,
      programName: snapshot.business_name.trim(),
      localizedProgramName: localized(snapshot.business_name.trim()),
      // Google, not PF, assigns APPROVED after this required submission state.
      reviewStatus: "UNDER_REVIEW",
      programLogo: { sourceUri: { uri: logoUrl }, contentDescription: localized(`Logo de ${issuerName}`) },
      accountNameLabel: "Nombre",
      accountIdLabel: "Membresía"
    };
    return { object, passClass };
  }

  function validateResource(actual, expected) {
    if (actual?.id !== expected.id || (expected.classId && actual?.classId !== expected.classId)) {
      throw walletError("GOOGLE_WALLET_RESOURCE_MISMATCH", "Google Wallet resource does not match this pass.");
    }
  }

  async function ensureClass(passClass, reconcileBranding = true) {
    const resource = `loyaltyClass/${passClass.id}`;
    let result = await api("GET", resource, undefined, [404]);
    if (result.status === 404) {
      result = await api("POST", "loyaltyClass", passClass, [409]);
      if (result.status === 409) result = await api("GET", resource);
    }
    validateResource(result.data, passClass);
    if (!reconcileBranding) return;
    const patch = Object.fromEntries(["programName", "localizedProgramName", "programLogo", "issuerName"]
      .filter(field => !matchesManagedFields(result.data[field], passClass[field]))
      .map(field => [field, passClass[field]]));
    if (Object.keys(patch).length) {
      // Google's loyalty PATCH API requires changed classes to be submitted for review.
      // An unchanged approved class must not be resubmitted on every balance update.
      const updated = await api("PATCH", resource, { ...patch, reviewStatus: "UNDER_REVIEW" });
      validateResource(updated.data, passClass);
    }
  }

  async function syncObject(pass, classReady = false) {
    const { object, passClass } = pass;
    const resource = `loyaltyObject/${object.id}`;
    let result = await api("GET", resource, undefined, [404]);
    if (result.status === 404) {
      if (!classReady) await ensureClass(passClass, object.state === "ACTIVE");
      result = await api("POST", "loyaltyObject", object, [409]);
      if (result.status !== 409) {
        validateResource(result.data, object);
        return;
      }
      // An insertion race is success only after checking the persisted identity.
      result = await api("GET", resource);
    }
    validateResource(result.data, object);
    const updated = await api("PATCH", resource, object);
    validateResource(updated.data, object);
  }

  return {
    /** @param {PassSnapshot} snapshot */
    async savePass(snapshot) {
      const pass = passData(snapshot);
      await ensureClass(pass.passClass, pass.object.state === "ACTIVE");
      await syncObject(pass, true);
      // Existing-object JWTs keep private customer fields and balances out of URLs.
      const token = await sign({
        iss: config.serviceAccountEmail, aud: "google", typ: "savetowallet",
        iat: Math.floor(now() / 1000), origins: [appOrigin],
        payload: { loyaltyObjects: [{ id: pass.object.id }] }
      });
      return `https://pay.google.com/gp/v/save/${token}`;
    },
    /** @param {PassSnapshot} snapshot */
    async updatePass(snapshot) {
      const pass = passData(snapshot);
      const active = pass.object.state === "ACTIVE";
      if (active) await ensureClass(pass.passClass);
      await syncObject(pass, active);
    }
  };
}
