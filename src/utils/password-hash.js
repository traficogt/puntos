import argon2 from "argon2";
import bcrypt from "bcryptjs";

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
});

/** @param {string | null | undefined} hash */
export function isArgon2Hash(hash) {
  return String(hash || "").startsWith("$argon2");
}

/** @param {string | null | undefined} hash */
export function isBcryptHash(hash) {
  return String(hash || "").startsWith("$2");
}

/** @param {string} password */
export async function hashPassword(password) {
  return argon2.hash(String(password), ARGON2_OPTIONS);
}

/**
 * Verifies against an argon2id or legacy bcrypt hash; false for empty or unknown formats.
 * @param {string} password
 * @param {string | null | undefined} passwordHash
 */
export async function verifyPassword(password, passwordHash) {
  const hash = String(passwordHash || "");
  if (!hash) return false;
  if (isArgon2Hash(hash)) {
    try {
      return await argon2.verify(hash, String(password));
    } catch {
      return false;
    }
  }
  if (isBcryptHash(hash)) {
    return bcrypt.compare(String(password), hash);
  }
  return false;
}

/** @param {string | null | undefined} passwordHash */
export function needsPasswordRehash(passwordHash) {
  return !isArgon2Hash(passwordHash);
}
