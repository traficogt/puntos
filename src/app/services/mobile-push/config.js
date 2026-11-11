import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';

/** @param {Record<string,string>} env */
export function loadMobilePushConfig(env = process.env, { readFile = path => readFileSync(path, 'utf8') } = {}) { // eslint-disable-line security/detect-non-literal-fs-filename -- Server operator credential path only.
  const result = { enabled: env.MOBILE_PUSH_ENABLED === 'true', ready: false, errors: [], config: null };
  if (!result.enabled) return result;
  const teamId = env.MOBILE_PUSH_APNS_TEAM_ID || '';
  const keyId = env.MOBILE_PUSH_APNS_KEY_ID || '';
  const topic = env.MOBILE_PUSH_APNS_TOPIC || 'com.puntosfieles.customer';
  if (!/^[A-Z0-9]{10}$/.test(teamId)) result.errors.push('APNS_TEAM_ID_INVALID');
  if (!/^[A-Z0-9]{10}$/.test(keyId)) result.errors.push('APNS_KEY_ID_INVALID');
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(topic) || topic.length > 255) result.errors.push('APNS_TOPIC_INVALID');
  let privateKey;
  try {
    privateKey = createPrivateKey(readFile(env.MOBILE_PUSH_APNS_KEY_FILE || ''));
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error('invalid');
  } catch { result.errors.push('APNS_KEY_INVALID_OR_UNAVAILABLE'); }
  result.ready = result.errors.length === 0;
  if (result.ready) result.config = { teamId, keyId, topic, privateKey };
  return result;
}
