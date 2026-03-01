import crypto from "node:crypto";
import { config } from "../config/index.js";

const ENC_V1_PREFIX = "enc:v1";
const ENC_V2_PREFIX = "enc:v2";

function deriveKey(rawValue) {
  const raw = String(rawValue || "");
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function getCurrentKeyMaterial() {
  // Never silently store secrets in plaintext at rest.
  // Prefer a dedicated key, but fall back to JWT_SECRET when unset.
  return deriveKey(config.WEBHOOK_SECRET_ENC_KEY || config.JWT_SECRET);
}

function getLegacyV1KeyMaterial() {
  // Backward compatibility for old v1 payloads that fell back to JWT_SECRET.
  return deriveKey(config.WEBHOOK_SECRET_ENC_KEY || config.JWT_SECRET);
}

function getCandidateV2Keys() {
  const keys = [];
  const current = getCurrentKeyMaterial();
  if (current) keys.push(current);
  for (const prev of config.WEBHOOK_SECRET_ENC_KEY_PREVIOUS || []) {
    const k = deriveKey(prev);
    if (k) keys.push(k);
  }
  return keys;
}

export function isEncryptedSecret(value) {
  const v = String(value || "");
  return v.startsWith(`${ENC_V1_PREFIX}:`) || v.startsWith(`${ENC_V2_PREFIX}:`);
}

export function encryptSecret(plainText) {
  const plain = String(plainText ?? "");
  if (!plain) return plain;
  if (plain.startsWith(`${ENC_V2_PREFIX}:`)) return plain;

  const key = getCurrentKeyMaterial();
  if (!key) return plain;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const cipherText = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENC_V2_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    cipherText.toString("base64url")
  ].join(":");
}

function decryptWithKey(parts, key) {
  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const cipherText = Buffer.from(parts[4], "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return plain.toString("utf8");
}

export function decryptSecretMaybe(encryptedOrPlain) {
  const value = String(encryptedOrPlain ?? "");
  if (!value) return value;
  if (!isEncryptedSecret(value)) return value;

  const parts = value.split(":");
  if (parts.length !== 5) {
    throw new Error("Malformed encrypted secret");
  }

  if (value.startsWith(`${ENC_V1_PREFIX}:`)) {
    const legacyKey = getLegacyV1KeyMaterial();
    if (!legacyKey) throw new Error("Missing legacy encryption key material");
    return decryptWithKey(parts, legacyKey);
  }

  const candidates = getCandidateV2Keys();
  if (!candidates.length) throw new Error("Missing webhook encryption key material");
  for (const key of candidates) {
    try {
      return decryptWithKey(parts, key);
    } catch {
      // try next candidate
    }
  }
  throw new Error("Unable to decrypt secret with configured key set");
}

export function rotateSecretToCurrent(encryptedOrPlain) {
  const plain = decryptSecretMaybe(encryptedOrPlain);
  return encryptSecret(plain);
}
