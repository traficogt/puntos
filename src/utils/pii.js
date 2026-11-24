// Lightweight PII masking for log fields. Internal logs only — not a security
// control; keeps a debugging hint without persisting full emails/phones.

/** @param {unknown} value a phone number; non-strings are stringified */
export function maskPhone(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

/** @param {unknown} value an email address or phone number */
export function maskContact(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const [user, domain] = s.split("@");
    return `${user ? user[0] : ""}***@${domain ?? ""}`;
  }
  return maskPhone(s);
}
