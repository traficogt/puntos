import { decryptSecretMaybe, encryptSecret } from "./secret-crypto.js";

function cloneProgramJson(programJson) {
  if (!programJson || typeof programJson !== "object") return {};
  return { ...programJson };
}

function mapProgramSecrets(programJson, transform) {
  const next = cloneProgramJson(programJson);
  const ext = next.external_awards;
  if (ext && typeof ext === "object" && ext.api_key) {
    next.external_awards = {
      ...ext,
      api_key: transform(ext.api_key)
    };
  }
  const pos = next.pos_integration;
  const loyverse = pos?.loyverse;
  if (loyverse && typeof loyverse === "object" && loyverse.access_token) {
    next.pos_integration = {
      ...pos,
      loyverse: { ...loyverse, access_token: transform(loyverse.access_token) }
    };
  }
  return next;
}

export function encryptProgramSecrets(programJson) {
  return mapProgramSecrets(programJson, encryptSecret);
}

export function decryptProgramSecrets(programJson) {
  return mapProgramSecrets(programJson, value => {
    try {
      return decryptSecretMaybe(value);
    } catch {
      // Keep encrypted value if key material is unavailable/mismatched.
      return value;
    }
  });
}

export function sanitizeProgramForClient(programJson) {
  const next = cloneProgramJson(programJson);
  delete next.pos_integration;
  if (next.external_awards && typeof next.external_awards === "object") {
    next.external_awards = { ...next.external_awards };
    delete next.external_awards.api_key;
  }
  return next;
}

export function rotateProgramSecretsToCurrent(programJson) {
  return encryptProgramSecrets(decryptProgramSecrets(programJson));
}
