import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const outDir = path.resolve(process.argv[2] || ".secrets");
/* eslint-disable security/detect-non-literal-fs-filename */
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "qr-private.pem"), privPem, { mode: 0o600 });
fs.writeFileSync(path.join(outDir, "qr-public.pem"), pubPem, { mode: 0o600 });
/* eslint-enable security/detect-non-literal-fs-filename */

console.log(`# Wrote Ed25519 QR keys to ${outDir}`);
console.log("QR_PRIVATE_KEY_PEM_FILE=/app/.secrets/qr-private.pem");
console.log("QR_PUBLIC_KEY_PEM_FILE=/app/.secrets/qr-public.pem");
