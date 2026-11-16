import express from "express";
import path from "node:path";
import { once } from "node:events";
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSpanishWeb, createSpanishWebRedirects } from "../../../src/middleware/spanish-web.js";

function publicFile(publicDir, filename) {
  return path.join(publicDir, filename);
}

export async function startPwaStaticServer() {
  const app = express();
  // Express intentionally rejects hidden path segments. A test-only alias lets
  // the same public assets run from .worktrees without relaxing server policy.
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'pf-pwa-public-'));
  const publicDir = path.join(fixtureDir, 'public');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Link only repository public assets into this fixture's temporary directory.
  await symlink(path.join(process.cwd(), 'public'), publicDir, 'dir');
  const host = process.env.PWA_STATIC_HOST || "127.0.0.1";

  app.get("/sw.js", (req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    next();
  });

  // Match production document redirects: cached redirect-followed responses
  // behave differently from directly served HTML during offline navigation.
  app.use(createSpanishWebRedirects());
  app.use(createSpanishWeb(publicDir));
  app.use(express.static(publicDir, { extensions: ["html"], redirect: false }));

  app.get("/", (req, res) => res.sendFile(publicFile(publicDir, "index.html")));
  app.get("/admin", (req, res) => res.sendFile(publicFile(publicDir, "admin.html")));
  app.get("/staff/login", (req, res) => res.sendFile(publicFile(publicDir, "staff-login.html")));
  app.get("/staff", (req, res) => res.sendFile(publicFile(publicDir, "staff.html")));
  app.get("/join/:slug", (req, res) => res.sendFile(publicFile(publicDir, "join.html")));
  app.get("/registro/:slug", (req, res) => res.sendFile(publicFile(publicDir, "join.html")));
  app.get("/ingresar/:slug", (req, res) => res.sendFile(publicFile(publicDir, "ingresar.html")));
  app.get("/c", (req, res) => res.sendFile(publicFile(publicDir, "customer.html")));
  app.get("/super", (req, res) => res.sendFile(publicFile(publicDir, "super.html")));

  const server = app.listen(0, host);
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine PWA test server address");
  }

  return {
    baseUrl: `http://${host}:${address.port}`,
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
      await rm(fixtureDir, { recursive: true, force: true });
    }
  };
}
