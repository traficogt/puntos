import crypto from "node:crypto";
import { isEncryptedSecret } from "../../../utils/secret-crypto.js";

export function makeId() {
  return crypto.randomUUID();
}

export function maskSecret(secret) {
  const s = String(secret ?? "");
  if (!s) return "";
  if (isEncryptedSecret(s)) return "********";
  if (s.length <= 4) return "*".repeat(s.length);
  return `${"*".repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

