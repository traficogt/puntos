import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import swaggerUi from "swagger-ui-express";

const router = Router();
const docsDir = path.join(process.cwd(), "docs");
const specPath = path.join(docsDir, "openapi.json");

function loadSpec() {
  if (!fs.existsSync(specPath)) return null;
  try {
    const raw = fs.readFileSync(specPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const spec = loadSpec();

if (spec) {
  const options = {
    swaggerOptions: {
      displayRequestDuration: true,
      docExpansion: "list",
      persistAuthorization: true
    }
  };
  router.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec, options));
  router.use("/api/v1/docs", swaggerUi.serve, swaggerUi.setup(spec, options));
} else {
  router.get(["/api/docs", "/api/v1/docs"], (_req, res) => {
    res.status(404).json({ error: "OpenAPI spec not found. Run npm run openapi:generate." });
  });
}

export default router;
