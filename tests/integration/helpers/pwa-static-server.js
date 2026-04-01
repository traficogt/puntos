import express from "express";
import path from "node:path";
import { once } from "node:events";

function publicFile(publicDir, filename) {
  return path.join(publicDir, filename);
}

export async function startPwaStaticServer() {
  const app = express();
  const publicDir = path.join(process.cwd(), "public");
  const host = process.env.PWA_STATIC_HOST || "127.0.0.1";

  app.get("/sw.js", (req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    next();
  });

  app.use(express.static(publicDir, { extensions: ["html"] }));

  app.get("/", (req, res) => res.sendFile(publicFile(publicDir, "index.html")));
  app.get("/admin", (req, res) => res.sendFile(publicFile(publicDir, "admin.html")));
  app.get("/staff/login", (req, res) => res.sendFile(publicFile(publicDir, "staff-login.html")));
  app.get("/staff", (req, res) => res.sendFile(publicFile(publicDir, "staff.html")));
  app.get("/join/:slug", (req, res) => res.sendFile(publicFile(publicDir, "join.html")));
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
          resolve();
        });
      });
    }
  };
}
