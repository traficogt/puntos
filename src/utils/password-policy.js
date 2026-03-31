import { badRequest } from "./http-error.js";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const APP_CONTEXT_TOKENS = [
  "puntos",
  "puntosfieles",
  "puntos fieles"
];

const COMMON_PASSWORDS = new Set([
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "12345678910",
  "password",
  "password1",
  "password123",
  "qwerty",
  "qwerty123",
  "admin",
  "admin123",
  "welcome",
  "welcome123",
  "iloveyou",
  "letmein",
  "monkey",
  "dragon",
  "abc123",
  "login",
  "passw0rd",
  "superman",
  "baseball",
  "football",
  "princess",
  "sunshine",
  "master",
  "freedom",
  "whatever",
  "trustno1",
  "zaq12wsx",
  "1q2w3e4r",
  "111111",
  "000000",
  "asdfgh",
  "asdfghjkl",
  "changeme",
  "secret",
  "secret123",
  "welcome1",
  "administrator"
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function tokenizeContext(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

export function passwordPolicyErrors(password, context = {}) {
  const raw = String(password ?? "");
  const normalized = normalizeText(raw);
  const errors = [];

  if (raw.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (!raw.trim()) {
    errors.push("Password must contain non-space characters");
  }

  if (COMMON_PASSWORDS.has(normalized)) {
    errors.push("Password is too common; choose a less predictable password");
  }

  const contextTokens = new Set(APP_CONTEXT_TOKENS.flatMap((value) => tokenizeContext(value)));
  for (const source of [context.email, context.name, context.businessName, context.phone]) {
    for (const token of tokenizeContext(source)) {
      contextTokens.add(token);
    }
  }

  const email = String(context.email || "").trim().toLowerCase();
  if (email.includes("@")) {
    const [localPart, domainPart] = email.split("@");
    for (const token of tokenizeContext(localPart)) contextTokens.add(token);
    for (const token of tokenizeContext(domainPart)) contextTokens.add(token);
  }

  for (const token of contextTokens) {
    const normalizedToken = normalizeText(token);
    if (normalizedToken.length >= 4 && normalized.includes(normalizedToken)) {
      errors.push("Password must not include easily guessed account or app context");
      break;
    }
  }

  return errors;
}

export function assertPasswordAllowed(password, context = {}) {
  const errors = passwordPolicyErrors(password, context);
  if (!errors.length) return;
  throw badRequest(errors[0]);
}
