export function normalizePhone(input, country = 'GT') {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (country === 'GT' && digits.length === 8 && !String(input).trim().startsWith('+')) return `502${digits}`; // Guatemala local
  if (digits.startsWith("502") && digits.length === 11) return digits;
  return digits; // let admin decide; provider may accept other
}
