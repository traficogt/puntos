import { readFileSync } from 'node:fs';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';

// Shared by local readiness checks and provider construction. This validates URL
// shape only; operators still verify public DNS, TLS and asset reachability.
export function parsePublicWalletUrl(value) {
  try {
    const u = new URL(value);
    const host=u.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !isIP(host)
      && host.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ? u : null;
  } catch { return null; }
}

// Read only explicitly enabled provider credentials. Never report their contents or paths.
/** @param {Record<string,string>} env
 * @param {{readFile?: (path:string, encoding?:string)=>string|Buffer}} options */
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Operator-configured credential paths, never request input.
export function loadNativeWalletConfig(env = process.env, { readFile = file => readFileSync(file, 'utf8') } = {}) {
  const appUrl = parsePublicWalletUrl(env.APP_ORIGIN);
  const appOrigin = appUrl?.origin || '';
  const organizationName = String(env.WALLET_ORGANIZATION_NAME || 'PuntosFieles').slice(0, 80);
  const apple = { enabled: env.APPLE_WALLET_ENABLED === 'true', ready: false, errors: [], config: null };
  const google = { enabled: env.GOOGLE_WALLET_ENABLED === 'true', ready: false, errors: [], config: null };
  for (const provider of [apple, google]) {
    if (provider.enabled && (!appUrl || appUrl.pathname !== '/' || appUrl.search)) provider.errors.push('APP_ORIGIN_HTTPS_REQUIRED');
  }
  if (apple.enabled) {
    const cfg = {
      appOrigin, organizationName,
      webServiceUrl: `${appOrigin}/api/wallet/apple`,
      passTypeIdentifier: env.APPLE_WALLET_PASS_TYPE_ID || '',
      teamIdentifier: env.APPLE_WALLET_TEAM_ID || '',
      certificateFile: env.APPLE_WALLET_CERTIFICATE_FILE || '',
      privateKeyFile: env.APPLE_WALLET_PRIVATE_KEY_FILE || '',
      wwdrCertificateFile: env.APPLE_WALLET_WWDR_FILE || '',
      privateKeyPassphrase: ''
    };
    if (!/^pass\.[A-Za-z0-9.-]+$/.test(cfg.passTypeIdentifier)) apple.errors.push('APPLE_WALLET_PASS_TYPE_ID_INVALID');
    if (!/^[A-Z0-9]{10}$/.test(cfg.teamIdentifier)) apple.errors.push('APPLE_WALLET_TEAM_ID_INVALID');
    try {
      if (env.APPLE_WALLET_KEY_PASSPHRASE_FILE) cfg.privateKeyPassphrase = String(readFile(env.APPLE_WALLET_KEY_PASSPHRASE_FILE, 'utf8')).trim();
      const cert = new X509Certificate(readFile(cfg.certificateFile));
      const key = createPrivateKey({ key: readFile(cfg.privateKeyFile), passphrase: cfg.privateKeyPassphrase || undefined });
      const wwdr = new X509Certificate(readFile(cfg.wwdrCertificateFile));
      if (!cert.checkPrivateKey(key) || !cert.verify(wwdr.publicKey)) throw Error('invalid');
      const now = Date.now();
      if ([cert, wwdr].some(c => now < Date.parse(c.validFrom) || now >= Date.parse(c.validTo))) throw Error('expired');
      if (!cert.subject.split('\n').includes(`OU=${cfg.teamIdentifier}`) || !cert.subject.split('\n').includes(`UID=${cfg.passTypeIdentifier}`)) throw Error('identity');
    } catch { apple.errors.push('APPLE_WALLET_CERTIFICATES_INVALID_OR_UNAVAILABLE'); }
    apple.ready = apple.errors.length === 0;
    if (apple.ready) apple.config = cfg;
  }
  if (google.enabled) {
    let account;
    try {
      account = JSON.parse(String(readFile(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE || '', 'utf8')));
      if (typeof account.private_key !== 'string' || !account.private_key.includes('-----BEGIN PRIVATE KEY-----')) throw Error('invalid');
      const key = createPrivateKey(account.private_key);
      if (account.type !== 'service_account' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email)
          || key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw Error('invalid');
    } catch { google.errors.push('GOOGLE_WALLET_SERVICE_ACCOUNT_INVALID_OR_UNAVAILABLE'); }
    const issuerId = String(env.GOOGLE_WALLET_ISSUER_ID || '');
    const logoUrl = env.GOOGLE_WALLET_LOGO_URL || `${appOrigin}/images/wallet/google-logo.png`;
    if (!/^\d+$/.test(issuerId)) google.errors.push('GOOGLE_WALLET_ISSUER_ID_INVALID');
    if (!parsePublicWalletUrl(logoUrl)) google.errors.push('GOOGLE_WALLET_LOGO_URL_HTTPS_REQUIRED');
    google.ready = google.errors.length === 0;
    if (google.ready) google.config = { issuerId, appOrigin, logoUrl, organizationName, serviceAccountEmail: account.client_email, privateKey: account.private_key, privateKeyId: account.private_key_id };
  }
  return { apple, google };
}
