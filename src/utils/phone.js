/**
 * Digits-only phone number; an 8-digit Guatemalan local number gains the 502
 * country code.
 * @param {unknown} input the submitted phone; non-strings are stringified
 * @param {string} [country] ISO country code, default GT
 */
export function normalizePhone(input, country = "GT") {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (country === "GT" && digits.length === 8 && !String(input).trim().startsWith("+"))
    return `502${digits}`; // Guatemala local
  if (digits.startsWith("502") && digits.length === 11) return digits;
  return digits; // let admin decide; provider may accept other
}
