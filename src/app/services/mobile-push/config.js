import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";

/**
 * @typedef {{ teamId: string, keyId: string, topic: string, privateKey: import("node:crypto").KeyObject }} MobilePushConfig
 * @param {Record<string, string | undefined>} [env]
 * @param {{readFile?: (path: string, encoding?: string) => string | Buffer}} [options]
 */
export function loadMobilePushConfig(
  env = process.env,
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  { readFile = (path) => readFileSync(path, "utf8") } = {},
) {
  /** @type {{ enabled: boolean, ready: boolean, errors: string[], config: MobilePushConfig | null }} */
  const result = {
    enabled: env.MOBILE_PUSH_ENABLED === "true",
    ready: false,
    errors: [],
    config: null,
  };
  if (!result.enabled) return result;
  const teamId = env.MOBILE_PUSH_APNS_TEAM_ID || "";
  const keyId = env.MOBILE_PUSH_APNS_KEY_ID || "";
  const topic = env.MOBILE_PUSH_APNS_TOPIC || "com.puntosfieles.customer";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) result.errors.push("APNS_TEAM_ID_INVALID");
  if (!/^[A-Z0-9]{10}$/.test(keyId)) result.errors.push("APNS_KEY_ID_INVALID");
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(topic) || topic.length > 255)
    result.errors.push("APNS_TOPIC_INVALID");
  /** @type {import("node:crypto").KeyObject | undefined} */
  let privateKey;
  try {
    privateKey = createPrivateKey(readFile(env.MOBILE_PUSH_APNS_KEY_FILE || ""));
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw Error("invalid");
  } catch {
    result.errors.push("APNS_KEY_INVALID_OR_UNAVAILABLE");
  }
  result.ready = result.errors.length === 0;
  // ready implies the key parsed above.
  if (result.ready)
    result.config = {
      teamId,
      keyId,
      topic,
      privateKey: /** @type {import("node:crypto").KeyObject} */ (privateKey),
    };
  return result;
}
