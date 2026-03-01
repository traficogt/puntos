import crypto from "node:crypto";

export function random6() {
  // CSPRNG for verification/auth flows
  // 100000..999999 inclusive
  return String(crypto.randomInt(100000, 1000000));
}
