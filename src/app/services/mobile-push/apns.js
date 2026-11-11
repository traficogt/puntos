import http2 from 'node:http2';
import { sign } from 'node:crypto';

const HOST = 'https://api.push.apple.com';
const invalidReasons = new Set(['BadDeviceToken', 'Unregistered', 'ExpiredToken']);
const knownReasons = new Set([...invalidReasons, 'DeviceTokenNotForTopic', 'BadTopic', 'MissingTopic', 'TopicDisallowed',
  'InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken', 'Forbidden', 'BadEnvironmentKeyIdInToken',
  'UnrelatedKeyIdInToken', 'TooManyRequests', 'TooManyProviderTokenUpdates', 'InternalServerError', 'ServiceUnavailable',
  'Shutdown', 'PayloadTooLarge', 'BadCollapseId', 'BadExpirationDate', 'BadPriority', 'BadPath', 'MethodNotAllowed']);
const failure = (reason = 'TransportFailure', retryable = true) => ({ accepted: false, invalidToken: false, retryable, reason });

// Dependencies expose only the HTTP/2 transport and clock for deterministic tests.
export function createApnsProvider(config, { connect = http2.connect, now = Date.now, timeoutMs = 8000 } = {}) {
  let session, jwt, issuedAt = 0;
  function authorization() {
    const seconds = Math.floor(now() / 1000);
    if (!jwt || seconds - issuedAt >= 50 * 60 || seconds < issuedAt) {
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: seconds })).toString('base64url');
      const input = `${header}.${claims}`;
      jwt = `${input}.${sign('sha256', Buffer.from(input), { key: config.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      issuedAt = seconds;
    }
    return `bearer ${jwt}`;
  }
  function connection() {
    if (!session || session.closed || session.destroyed) {
      const current = connect(HOST, { minVersion: 'TLSv1.2' });
      session = current;
      const discard = () => { if (session === current) session = null; current.close(); };
      current.on('error', discard);
      current.on('goaway', discard);
      current.on('close', () => { if (session === current) session = null; });
    }
    return session;
  }
  return {
    async send({ token, payload, collapseId = 'pf-card' }) {
      if (typeof token !== 'string' || !/^(?:[a-f0-9]{2}){16,256}$/i.test(token)) return failure('InvalidInput', false);
      const body = JSON.stringify(payload);
      if (Buffer.byteLength(body) > 4096 || Buffer.byteLength(collapseId) > 64) return failure('InvalidInput', false);
      return new Promise(resolve => {
        let stream, timer, finished = false, status = 0, bytes = 0, response = '';
        const finish = result => {
          if (finished) return;
          finished = true; clearTimeout(timer); resolve(result);
          stream?.close();
        };
        timer = setTimeout(() => finish(failure('Timeout')), Math.max(1, Math.min(15000, timeoutMs)));
        try {
          stream = connection().request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: authorization(),
            'content-type': 'application/json', 'apns-topic': config.topic, 'apns-push-type': 'alert',
            'apns-priority': '10', 'apns-expiration': '0', 'apns-collapse-id': collapseId });
          stream.on('response', headers => { status = Number(headers[':status']); });
          stream.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 8192) return finish(failure('ResponseTooLarge'));
            response += chunk.toString();
          });
          stream.on('error', () => finish(failure()));
          stream.on('close', () => finish(failure()));
          stream.on('end', () => {
            if (status === 200) return finish({ accepted: true, invalidToken: false, retryable: false, reason: 'Accepted' });
            let reason = 'ProviderRejected';
            try { const raw = JSON.parse(response).reason; if (knownReasons.has(raw)) reason = raw; } catch {}
            if (reason === 'ExpiredProviderToken') jwt = null;
            finish({ accepted: false, invalidToken: invalidReasons.has(reason),
              retryable: status === 429 || status >= 500 || reason === 'ExpiredProviderToken', reason });
          });
          stream.end(body);
        } catch { finish(failure()); }
      });
    },
    close() { session?.close(); session = null; }
  };
}
