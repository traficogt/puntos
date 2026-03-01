export function normalizePhone(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 8) return `502${digits}`; // Guatemala local
  if (digits.startsWith("502") && digits.length === 11) return digits;
  return digits; // let admin decide; provider may accept other
}
