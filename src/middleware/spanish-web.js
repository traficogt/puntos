import express from "express";
import path from "node:path";
import { createMerchantWeb } from "./merchant-web.js";
import { createMobilePreview } from "./mobile-preview.js";
import { resolveSpanishWebRedirect } from "../utils/spanish-web-routes.js";

/** Canonicalize document URLs before host routing, without redirecting writes. */
export function createSpanishWebRedirects() {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const location = resolveSpanishWebRedirect(req.originalUrl);
    return location ? res.redirect(308, location) : next();
  };
}

/** Spanish browser entry paths reuse the existing HTML and CSP-aware handlers. */
export function createSpanishWeb(publicDir) {
  const router = express.Router();
  router.use("/negocio/recursos", express.static(path.join(publicDir, "merchant/recursos"), { redirect: false }));
  router.use(["/negocio", "/demostracion"], createMerchantWeb(publicDir));
  router.use("/vista-previa-app", createMobilePreview(publicDir));
  router.get("/preferencias-de-mensajes/", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Robots-Tag", "noindex, nofollow");
    return res.sendFile(path.join(publicDir, "marketing-preferences.html"));
  });
  const documents = {
    "/administracion/": "admin-dashboard.html",
    "/crear-negocio/": "admin.html",
    "/equipo/ingresar/": "staff-login.html",
    "/equipo/escaner/": "staff.html",
    "/mi-tarjeta/": "customer.html",
    "/plataforma/": "super.html",
    "/registro/": "join.html",
    "/ingresar/": "ingresar.html"
  };
  for (const [route, filename] of Object.entries(documents)) {
    router.get(route, (_req, res) => res.sendFile(path.join(publicDir, filename)));
  }
  router.get("/join/:slug", (req, res) => {
    const slug = encodeURIComponent(String(req.params.slug || "").trim());
    const queryStart = req.originalUrl.indexOf("?");
    const query = queryStart < 0 ? "" : req.originalUrl.slice(queryStart);
    return res.redirect(308, `/registro/${slug}${query}`);
  });
  return router;
}
