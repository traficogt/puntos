import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect as http2Connect } from "node:http2";
import { PKPass } from "passkit-generator";

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

const configurationError = () => Object.assign(new Error("Apple Wallet signing is not configured correctly."), { code: "APPLE_WALLET_CONFIGURATION_INVALID" });
const passError = () => Object.assign(new Error("Apple Wallet pass could not be generated."), { code: "APPLE_WALLET_PASS_FAILED" });
const pushError = () => Object.assign(new Error("Apple Wallet update could not be delivered."), { code: "APPLE_WALLET_PUSH_FAILED" });

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw configurationError();
  return url;
}

/** @param {AppleConfig} config */
async function credentialsFor(config) {
  try {
    httpsUrl(config.webServiceUrl);
    const origin = httpsUrl(config.appOrigin);
    if (origin.pathname !== "/" || !/^pass\.[A-Za-z0-9.-]+$/.test(config.passTypeIdentifier) || !/^[A-Z0-9]{10}$/.test(config.teamIdentifier)) throw configurationError();
    if (typeof config.organizationName !== "string" || !config.organizationName.trim()) throw configurationError();
    // These paths come only from operator configuration, never from a pass or HTTP request.
    const [signerCert, signerKey, wwdr] = await Promise.all(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      [config.certificateFile, config.privateKeyFile, config.wwdrCertificateFile].map((path) => readFile(path))
    );
    const certificate = new X509Certificate(signerCert);
    const issuer = new X509Certificate(wwdr);
    const key = createPrivateKey({ key: signerKey, passphrase: config.privateKeyPassphrase || undefined });
    const subject = certificate.subject.split("\n");
    const now = Date.now();
    if (!subject.includes(`UID=${config.passTypeIdentifier}`) || !subject.includes(`OU=${config.teamIdentifier}`) || !certificate.checkPrivateKey(key)) throw configurationError();
    if (!issuer.ca || !certificate.checkIssued(issuer) || !certificate.verify(issuer.publicKey)) throw configurationError();
    if ([certificate, issuer].some((cert) => now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo))) throw configurationError();
    return { signerCert, signerKey, wwdr, signerKeyPassphrase: config.privateKeyPassphrase || undefined };
  } catch {
    // Cryptographic and filesystem exceptions may contain sensitive paths or key details.
    throw configurationError();
  }
}

function passProperties(config, snapshot) {
  if (typeof snapshot.serial_number !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(snapshot.serial_number)) throw passError();
  if (typeof snapshot.authentication_token !== "string" || snapshot.authentication_token.length < 16 || snapshot.authentication_token.length > 256) throw passError();
  if (typeof snapshot.barcode !== "string" || !/^[\x21-\x7e]{1,2048}$/.test(snapshot.barcode)) throw passError();
  const voided = Boolean(snapshot.revoked_at || snapshot.is_voided);
  const engagement = voided ? null : snapshot.wallet_engagement;
  const points = voided ? 0 : Number(snapshot.points);
  const pendingPoints = voided ? 0 : Number(snapshot.pending_points);
  if (!Number.isFinite(points) || !Number.isFinite(pendingPoints)) throw passError();
  const business = String(snapshot.business_name || config.organizationName).slice(0, 160);
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
    locations: (engagement?.locations ?? []).slice(0, 10).map(location => ({ latitude: location.latitude, longitude: location.longitude, relevantText: `Tu tarjeta de puntos en ${location.name}`.slice(0, 160) })),
    backgroundColor: "rgb(20, 48, 43)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(210, 233, 220)",
    barcodes: [{ format: "PKBarcodeFormatQR", message: snapshot.barcode, messageEncoding: "iso-8859-1" }],
    userInfo: { revision: String(snapshot.revision) },
    storeCard: {
      primaryFields: [{ key: "points", label: "PUNTOS DISPONIBLES", value: points }],
      secondaryFields: [
        ...(!voided && snapshot.customer_name ? [{ key: "customer_name", label: "CLIENTE", value: String(snapshot.customer_name).slice(0, 120) }] : []),
        ...(engagement?.reward ? [{ key: "reward_status", label: engagement.reward.name.slice(0, 80), value: engagement.reward.status === "available" ? "Puedes elegirla" : `Faltan ${engagement.reward.remaining_points} puntos` }] : [])
      ],
      auxiliaryFields: [{ key: "pending_points", label: "PUNTOS PENDIENTES", value: pendingPoints }],
      backFields: [
        ...(engagement?.progress ? [{ key: "reward_progress", label: "Tu próxima recompensa", value: engagement.progress }] : []),
        ...(engagement?.conditions ? [{ key: "reward_conditions", label: "Condiciones del canje", value: engagement.conditions }] : []),
        ...(engagement?.earning ? [{ key: "earning_terms", label: "Cómo acumulas", value: engagement.earning }] : []),
        ...(engagement?.usage ? [{ key: "card_usage", label: "Cómo usar tu tarjeta", value: engagement.usage }] : []),
        { key: "customer_link", label: "Tu cuenta de Puntos Fieles", value: new URL("/mi-tarjeta/", config.appOrigin).href },
        { key: "support_link", label: "Soporte", value: "https://puntosfieles.com/soporte" }
      ]
    }
  };
}

/**
 * Signs genuine pass packages with configured credentials. No credentials or demo
 * fallback are bundled. A test CA cannot make passes accepted by Apple Wallet.
 * @param {AppleConfig} config
 * @param {{connect?: typeof http2Connect, timeoutMs?: number}} [dependencies]
 */
export function createAppleProvider(config, { connect = http2Connect, timeoutMs = 10000 } = {}) {
  let connection;

  function closeConnection(active = connection) {
    if (!active || active.closed) return;
    active.closed = true;
    if (connection === active) connection = undefined;
    for (const fail of [...active.pending]) fail(true);
    active.session.destroy();
  }

  function connectionFor(certificates) {
    if (connection && !connection.closed && !connection.session.closed && !connection.session.destroyed
        && connection.certificates.signerCert.equals(certificates.signerCert)
        && connection.certificates.signerKey.equals(certificates.signerKey)
        && connection.certificates.signerKeyPassphrase === certificates.signerKeyPassphrase) return connection;
    closeConnection();
    const session = connect("https://api.push.apple.com", {
      cert: certificates.signerCert,
      key: certificates.signerKey,
      passphrase: certificates.signerKeyPassphrase,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true
    });
    const active = { session, certificates, pending: new Set(), closed: false };
    connection = active;
    session.on("error", () => closeConnection(active));
    session.on("close", () => closeConnection(active));
    session.on("goaway", () => closeConnection(active));
    return active;
  }

  return {
    close() { closeConnection(); },

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
          readFile(new URL("../../../../public/images/wallet/apple-icon@3x.png", import.meta.url))
        ]);
        const pass = new PKPass({
          "pass.json": Buffer.from(JSON.stringify(passJson)),
          "icon.png": icon,
          "icon@2x.png": icon2x,
          "icon@3x.png": icon3x
        }, certificates);
        return pass.getAsBuffer();
      } catch {
        throw passError();
      }
    },

    async pushUpdate(pushToken) {
      if (typeof pushToken !== "string" || !/^[a-fA-F0-9]{32,1024}$/.test(pushToken) || pushToken.length % 2 !== 0) throw pushError();
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw pushError();
      const certificates = await credentialsFor(config);
      return new Promise((resolve, reject) => {
        let finished = false;
        let active;
        let request;
        let status;
        let response = "";
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
            if (!active.pending.size) active.session.unref?.();
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
            "content-type": "application/json"
          });
          request.setEncoding("utf8");
          request.on("error", () => finish(true));
          request.on("close", () => finish(true));
          request.on("response", (headers) => { status = headers[":status"]; });
          request.on("data", (chunk) => {
            response += chunk;
            if (Buffer.byteLength(response) > 8192) finish(true);
          });
          request.on("end", () => {
            if (status === 200) return finish(false);
            let reason;
            try { reason = JSON.parse(response).reason; } catch { return finish(true); }
            if ((status === 410 && reason === "Unregistered") || (status === 400 && reason === "BadDeviceToken")) return finish(false, true);
            finish(true);
          });
          // Wallet updates carry no account data; they only prompt a pass refresh.
          request.end("{}");
        } catch {
          finish(true);
        }
      });
    }
  };
}
