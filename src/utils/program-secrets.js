import { decryptSecretMaybe, encryptSecret } from "./secret-crypto.js";

/**
 * A `businesses.program_json` document. Its values are schema-less JSON (the
 * zod schemas type it as `Record<string, any>` too); sections are validated
 * where they are read.
 * @typedef {Record<string, any>} ProgramJson
 */

/**
 * @param {unknown} value
 * @returns {value is ProgramJson}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

/**
 * Shallow copy of a program_json document; anything that is not an object yields {}.
 * @param {unknown} programJson
 * @returns {ProgramJson}
 */
function cloneProgramJson(programJson) {
  if (!isRecord(programJson)) return {};
  return { ...programJson };
}

/**
 * Applies `transform` to every secret stored in program_json
 * (external_awards.api_key, pos_integration.loyverse.access_token).
 * @param {unknown} programJson
 * @param {(value: unknown) => unknown} transform
 */
function mapProgramSecrets(programJson, transform) {
  const next = cloneProgramJson(programJson);
  const ext = next.external_awards;
  if (isRecord(ext) && ext.api_key) {
    next.external_awards = {
      ...ext,
      api_key: transform(ext.api_key),
    };
  }
  const pos = next.pos_integration;
  if (isRecord(pos)) {
    const loyverse = pos.loyverse;
    if (isRecord(loyverse) && loyverse.access_token) {
      next.pos_integration = {
        ...pos,
        loyverse: { ...loyverse, access_token: transform(loyverse.access_token) },
      };
    }
  }
  return next;
}

/** @param {unknown} programJson */
export function encryptProgramSecrets(programJson) {
  return mapProgramSecrets(programJson, encryptSecret);
}

/** @param {unknown} programJson */
export function decryptProgramSecrets(programJson) {
  return mapProgramSecrets(programJson, (value) => {
    try {
      return decryptSecretMaybe(value);
    } catch {
      // Keep encrypted value if key material is unavailable/mismatched.
      return value;
    }
  });
}

/**
 * The program document without integration secrets and owner-private settings.
 * @param {unknown} programJson
 */
export function sanitizeProgramForClient(programJson) {
  const next = cloneProgramJson(programJson);
  delete next.pos_integration;
  // The weekly summary contains the owner's verified email or private phone.
  // Its dedicated owner controls read it directly; public/client programs do not.
  delete next.weekly_owner_brief;
  if (isRecord(next.external_awards)) {
    next.external_awards = { ...next.external_awards };
    delete next.external_awards.api_key;
  }
  return next;
}

/** @param {unknown} programJson */
export function rotateProgramSecretsToCurrent(programJson) {
  return encryptProgramSecrets(decryptProgramSecrets(programJson));
}
