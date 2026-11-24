import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect as http2Connect } from "node:http2";
import { PKPass } from "passkit-generator";
import { isApplePushToken } from "./apple-push-token.js";

/**
 * @typedef {object} AppleConfig
 * @property {string} passTypeIdentifier
 * @property {string} teamIdentifier
 * @property {string} organizationName
 * @property {string} certificateFile
 * @property {string} privateKeyFile
 * @property {string} [privateKeyPassphrase]
 * @property {string} wwdrCertificateFile
 * @property {string} webServiceUrl
 * @property {string} appOrigin
 */

/**
 * Engagement block built by ./engagement.js (reward progress, terms and relevant
 * locations); the pass renders only the fields present.
 * @typedef {{
 *   reward?: { name: string, status: string, remaining_points: number } | null,
 *   progress?: string | null,
 *   earning?: string | null,
 *   conditions?: string | null,
 *   usage?: string | null,
 *   locations?: Array<{ latitude: number | null | undefined, longitude: number | null | undefined, name?: string | null }> | null
 * }} AppleEngagement
 */

/**
 * Pass snapshot as produced by NativeWalletRepo.getSnapshot (repositories owner).
 * Fields that end up on the pass are validated here, so untrusted ones are `unknown`.
 * @typedef {{
 *   id?: string,
 *   serial_number?: unknown,
 *   authentication_token?: unknown,
 *   barcode?: unknown,
 *   revoked_at?: string | Date | null,
 *   is_voided?: boolean | null,
 *   wallet_engagement?: AppleEngagement | null,
 *   wallet_message?: { text?: string | null } | null,
 *   points?: number | string | null,
 *   pending_points?: number | string | null,
 *   business_name?: string | null,
 *   business_slug?: string | null,
 *   customer_name?: string | null,
 *   revision?: string | number | null,
 *   [column: string]: unknown
 * }} AppleSnapshot
 */

/** @typedef {Awaited<ReturnType<typeof credentialsFor>>} AppleCredentials */

/**
 * One APNs HTTP/2 session reused across pushes while its credentials match.
 * @typedef {{
 *   session: import("node:http2").ClientHttp2Session,
 *   certificates: AppleCredentials,
 *   pending: Set<(error: boolean) => void>,
 *   closed: boolean
 * }} AppleConnection
 */

const configurationError = () =>
  Object.assign(new Error("Apple Wallet signing is not configured correctly."), {
    code: "APPLE_WALLET_CONFIGURATION_INVALID",
  });
const passError = () =>
  Object.assign(new Error("Apple Wallet pass could not be generated."), {
    code: "APPLE_WALLET_PASS_FAILED",
  });
const pushError = () =>
  Object.assign(new Error("Apple Wallet update could not be delivered."), {
    code: "APPLE_WALLET_PUSH_FAILED",
  });

/** @param {string} value */
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw configurationError();
  return url;
}

/** @param {AppleConfig} config */
async function credentialsFor(config) {
  try {
    httpsUrl(config.webServiceUrl);
    const origin = httpsUrl(config.appOrigin);
    if (
      origin.pathname !== "/" ||
      !/^pass\.[A-Za-z0-9.-]+$/.test(config.passTypeIdentifier) ||
      !/^[A-Z0-9]{10}$/.test(config.teamIdentifier)
    )
      throw configurationError();
    if (typeof config.organizationName !== "string" || !config.organizationName.trim())
      throw configurationError();
    // These paths come only from operator configuration, never from a pass or HTTP request.
    const [signerCert, signerKey, wwdr] = await Promise.all(
      [config.certificateFile, config.privateKeyFile, config.wwdrCertificateFile].map((path) =>
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        readFile(path),
      ),
    );
    const certificate = new X509Certificate(signerCert);
    const issuer = new X509Certificate(wwdr);
    const key = createPrivateKey({
      key: signerKey,
      passphrase: config.privateKeyPassphrase || undefined,
    });
    const subject = certificate.subject.split("\n");
    const now = Date.now();
    if (
      !subject.includes(`UID=${config.passTypeIdentifier}`) ||
      !subject.includes(`OU=${config.teamIdentifier}`) ||
      !certificate.checkPrivateKey(key)
    )
      throw configurationError();
    if (!issuer.ca || !certificate.checkIssued(issuer) || !certificate.verify(issuer.publicKey))
      throw configurationError();
    if (
      [certificate, issuer].some(
        (cert) => now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo),
      )
    )
      throw configurationError();
    return {
      signerCert,
      signerKey,
      wwdr,
      signerKeyPassphrase: config.privateKeyPassphrase || undefined,
    };
  } catch {
    // Cryptographic and filesystem exceptions may contain sensitive paths or key details.
    throw configurationError();
  }
}

/**
 * @param {string} appOrigin
 * @param {unknown} publicSlug
 * @param {string} destination
 */
function actionDestination(appOrigin, publicSlug, destination) {
  // This is public business context, never a customer/pass authentication token.
  const hasSlug =
    typeof publicSlug === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(publicSlug);
  const url = new URL(
    hasSlug ? `/ingresar/${encodeURIComponent(publicSlug)}` : "/mi-tarjeta/",
    appOrigin,
  );
  if (hasSlug) url.searchParams.set("destino", destination);
  else url.hash = destination;
  return url.href;
}

/**
 * @param {AppleConfig} config
 * @param {AppleSnapshot} snapshot
 */
function passProperties(config, snapshot) {
  if (
    typeof snapshot.serial_number !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(snapshot.serial_number)
  )
    throw passError();
  if (
    typeof snapshot.authentication_token !== "string" ||
    snapshot.authentication_token.length < 16 ||
    snapshot.authentication_token.length > 256
  )
    throw passError();
  if (typeof snapshot.barcode !== "string" || !/^[\x21-\x7e]{1,2048}$/.test(snapshot.barcode))
    throw passError();
  const voided = Boolean(snapshot.revoked_at || snapshot.is_voided);
  const engagement = voided ? null : snapshot.wallet_engagement;
  // Lifecycle-automation push: a changeMessage field makes Wallet show the lock-screen alert.
  const walletMessageText = voided ? null : snapshot.wallet_message?.text || null;
  const points = voided ? 0 : Number(snapshot.points);
  const pendingPoints = voided ? 0 : Number(snapshot.pending_points);
  if (!Number.isFinite(points) || !Number.isFinite(pendingPoints)) throw passError();
  const business = String(snapshot.business_name || config.organizationName).slice(0, 160);
  const actions = voided
    ? []
    : [
        {
          identifier: "pf-offers",
          type: "viewOffersRewards",
          url: actionDestination(config.appOrigin, snapshot.business_slug, "ofertas"),
        },
        {
          identifier: "pf-benefits",
          type: "membershipBenefits",
          url: actionDestination(config.appOrigin, snapshot.business_slug, "beneficios"),
        },
      ];
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeIdentifier,
    teamIdentifier: config.teamIdentifier,
    organizationName: config.organizationName,
    description: `Tarjeta de puntos de ${business}`,
    logoText: business,
    serialNumber: snapshot.serial_number,
    authenticationToken: snapshot.authentication_token,
    webServiceURL: config.webServiceUrl,
    voided,
    locations: (engagement?.locations ?? []).slice(0, 10).map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      relevantText: `Tu tarjeta de puntos en ${location.name}`.slice(0, 160),
    })),
    backgroundColor: "rgb(20, 48, 43)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(210, 233, 220)",
    barcodes: [
      { format: "PKBarcodeFormatQR", message: snapshot.barcode, messageEncoding: "iso-8859-1" },
    ],
    userInfo: { revision: String(snapshot.revision) },
    featuredActions: actions,
    storeCard: {
      primaryFields: [{ key: "points", label: "PUNTOS DISPONIBLES", value: points }],
      secondaryFields: [
        ...(!voided && snapshot.customer_name
          ? [
              {
                key: "customer_name",
                label: "CLIENTE",
                value: String(snapshot.customer_name).slice(0, 120),
              },
            ]
          : []),
        ...(engagement?.reward
          ? [
              {
                key: "reward_status",
                label: engagement.reward.name.slice(0, 80),
                value:
                  engagement.reward.status === "available"
                    ? "Puedes elegirla"
                    : `Faltan ${engagement.reward.remaining_points} puntos`,
              },
            ]
          : []),
      ],
      auxiliaryFields: [
        { key: "pending_points", label: "PUNTOS PENDIENTES", value: pendingPoints },
      ],
      backFields: [
        ...(walletMessageText
          ? [
              {
                key: "pf_message",
                label: "NOVEDADES",
                value: walletMessageText,
                changeMessage: "%@",
              },
            ]
          : []),
        ...(engagement?.progress
          ? [{ key: "reward_progress", label: "Tu próxima recompensa", value: engagement.progress }]
          : []),
        ...(engagement?.conditions
          ? [
              {
                key: "reward_conditions",
                label: "Condiciones del canje",
                value: engagement.conditions,
              },
            ]
          : []),
        ...(engagement?.earning
          ? [{ key: "earning_terms", label: "Cómo acumulas", value: engagement.earning }]
          : []),
        ...(engagement?.usage
          ? [{ key: "card_usage", label: "Cómo usar tu tarjeta", value: engagement.usage }]
          : []),
        ...(!voided
          ? [
              { key: "offers_link", label: "Ofertas y recompensas", value: actions[0].url },
              { key: "benefits_link", label: "Beneficios de tu membresía", value: actions[1].url },
            ]
          : []),
        {
          key: "customer_link",
          label: "Tu cuenta de Puntos Fieles",
          value: new URL("/mi-tarjeta/", config.appOrigin).href,
        },
        { key: "support_link", label: "Soporte", value: "https://puntosfieles.com/soporte" },
      ],
    },
  };
}

/**
 * Signs genuine pass packages with configured credentials. No credentials or demo
 * fallback are bundled. A test CA cannot make passes accepted by Apple Wallet.
 * @param {AppleConfig} config
 * @param {{connect?: typeof http2Connect, timeoutMs?: number}} [dependencies]
 */
export function createAppleProvider(config, { connect = http2Connect, timeoutMs = 10000 } = {}) {
  /** @type {AppleConnection | undefined} */
  let connection;

  /** @param {AppleConnection | undefined} [active] */
  function closeConnection(active = connection) {
    if (!active || active.closed) return;
    active.closed = true;
    if (connection === active) connection = undefined;
    for (const fail of [...active.pending]) fail(true);
    active.session.destroy();
  }

  /** @param {AppleCredentials} certificates */
  function connectionFor(certificates) {
    if (
      connection &&
      !connection.closed &&
      !connection.session.closed &&
      !connection.session.destroyed &&
      connection.certificates.signerCert.equals(certificates.signerCert) &&
      connection.certificates.signerKey.equals(certificates.signerKey) &&
      connection.certificates.signerKeyPassphrase === certificates.signerKeyPassphrase
    )
      return connection;
    closeConnection();
    const session = connect("https://api.push.apple.com", {
      cert: certificates.signerCert,
      key: certificates.signerKey,
      passphrase: certificates.signerKeyPassphrase,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    });
    /** @type {AppleConnection} */
    const active = { session, certificates, pending: new Set(), closed: false };
    connection = active;
    session.on("error", () => closeConnection(active));
    session.on("close", () => closeConnection(active));
    session.on("goaway", () => closeConnection(active));
    return active;
  }

  return {
    close() {
      closeConnection();
    },

    /** @param {AppleSnapshot} snapshot */
    async generatePass(snapshot) {
      const certificates = await credentialsFor(config);
      try {
        const passJson = passProperties(config, snapshot);
        const [icon, icon2x, icon3x] = await Promise.all([
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository asset URL.
          readFile(new URL("../../../../public/images/wallet/apple-icon.png", import.meta.url)),
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository asset URL.
          readFile(new URL("../../../../public/images/wallet/apple-icon@2x.png", import.meta.url)),
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository asset URL.
          readFile(new URL("../../../../public/images/wallet/apple-icon@3x.png", import.meta.url)),
        ]);
        const pass = new PKPass(
          {
            "pass.json": Buffer.from(JSON.stringify(passJson)),
            "icon.png": icon,
            "icon@2x.png": icon2x,
            "icon@3x.png": icon3x,
          },
          certificates,
        );
        return pass.getAsBuffer();
      } catch {
        throw passError();
      }
    },

    /**
     * @param {unknown} pushToken stored device token; malformed values are reported invalid
     * @returns {Promise<{ invalidToken: boolean }>}
     */
    async pushUpdate(pushToken) {
      // Old registrations may predate ingress validation. Remove those through
      // the same path as an APNs-invalid token instead of retrying them forever.
      if (!isApplePushToken(pushToken)) return { invalidToken: true };
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw pushError();
      const certificates = await credentialsFor(config);
      return new Promise((resolve, reject) => {
        let finished = false;
        /** @type {AppleConnection | undefined} */
        let active;
        /** @type {import("node:http2").ClientHttp2Stream | undefined} */
        let request;
        /** @type {number | undefined} */
        let status;
        let response = "";
        /**
         * @param {boolean} error
         * @param {boolean} [invalidToken]
         */
        const finish = (error, invalidToken = false) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          active?.pending.delete(finish);
          if (error) {
            request?.destroy();
            closeConnection(active);
            reject(pushError());
          } else {
            // Keep APNs connections reusable without keeping an idle worker alive.
            // A successful response implies connectionFor() assigned `active`.
            if (!(/** @type {AppleConnection} */ (active).pending.size))
              /** @type {AppleConnection} */ (active).session.unref?.();
            resolve({ invalidToken });
          }
        };
        const timer = setTimeout(() => finish(true), timeoutMs);
        try {
          active = connectionFor(certificates);
          active.pending.add(finish);
          active.session.ref?.();
          request = active.session.request({
            ":method": "POST",
            ":path": `/3/device/${pushToken}`,
            "apns-topic": config.passTypeIdentifier,
            "apns-priority": "5",
            "apns-expiration": String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60),
            "apns-collapse-id": "pf-wallet-update",
            "content-type": "application/json",
          });
          request.setEncoding("utf8");
          request.on("error", () => finish(true));
          request.on("close", () => finish(true));
          request.on("response", (headers) => {
            status = headers[":status"];
          });
          request.on("data", (chunk) => {
            response += chunk;
            if (Buffer.byteLength(response) > 8192) finish(true);
          });
          request.on("end", () => {
            if (status === 200) return finish(false);
            let reason;
            try {
              reason = JSON.parse(response).reason;
            } catch {
              return finish(true);
            }
            if (
              (status === 410 && reason === "Unregistered") ||
              (status === 400 && reason === "BadDeviceToken")
            )
              return finish(false, true);
            finish(true);
          });
          // Wallet updates carry no account data; they only prompt a pass refresh.
          request.end("{}");
        } catch {
          finish(true);
        }
      });
    },
  };
}
