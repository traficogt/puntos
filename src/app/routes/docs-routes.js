import { Router } from "express";
import path from "node:path";
import fs from "node:fs";

const router = Router();
const docsDir = path.join(process.cwd(), "docs");
const preferred = ["openapi.json", "openapi.yaml"];

function sendSpec(res) {
  for (const filename of preferred) {
    const candidate = path.join(docsDir, filename);
    // Filenames are fixed from a short allowlist above.
    if (fs.existsSync(candidate)) return res.sendFile(candidate); // eslint-disable-line security/detect-non-literal-fs-filename
  }
  return res.status(404).json({ error: "OpenAPI spec not found" });
}

router.get("/api/openapi.json", (_req, res) => sendSpec(res));
router.get("/api/openapi.yaml", (_req, res) => sendSpec(res));
router.get("/api/v1/openapi.json", (_req, res) => sendSpec(res));
router.get("/api/v1/openapi.yaml", (_req, res) => sendSpec(res));

export default router;
