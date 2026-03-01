import { decryptSecretMaybe, encryptSecret } from "./secret-crypto.js";

function cloneProgramJson(programJson) {
  if (!programJson || typeof programJson !== "object") return {};
  return { ...programJson };
}

export function encryptProgramSecrets(programJson) {
  const next = cloneProgramJson(programJson);
  const ext = next.external_awards;
  if (ext && typeof ext === "object" && ext.api_key) {
    next.external_awards = {
      ...ext,
      api_key: encryptSecret(ext.api_key)
    };
  }
  return next;
}

export function decryptProgramSecrets(programJson) {
  const next = cloneProgramJson(programJson);
  const ext = next.external_awards;
  if (ext && typeof ext === "object" && ext.api_key) {
    try {
      next.external_awards = {
        ...ext,
        api_key: decryptSecretMaybe(ext.api_key)
      };
    } catch {
      // Keep encrypted value if key material is unavailable/mismatched.
      next.external_awards = { ...ext };
    }
  }
  return next;
}

export function rotateProgramSecretsToCurrent(programJson) {
  return encryptProgramSecrets(decryptProgramSecrets(programJson));
}
