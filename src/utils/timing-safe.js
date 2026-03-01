import crypto from "node:crypto";

/**
 * Timing-safe string equality.
 * Returns false if lengths differ (Node's timingSafeEqual requires equal length).
 *
 * Note: length mismatch is not compared in constant-time; for our use (auth/signature checks)
 * this is acceptable because attackers already control/know their own input length.
 */
export function timingSafeEqualString(a, b) {
  const av = String(a ?? "");
  const bv = String(b ?? "");
  const ab = Buffer.from(av);
  const bb = Buffer.from(bv);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

