import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSpanishWebRedirect,
  isSpanishWebRoutePath,
  merchantViewForLegacyOwnerQuery,
} from "../../src/utils/spanish-web-routes.js";

test("legacy browser entries permanently canonicalize to Spanish paths with untouched query tokens", () => {
  const routes = {
    "/merchant": "/negocio/",
    "/merchant/": "/negocio/",
    "/merchant/index.html": "/negocio/",
    "/admin-dashboard": "/negocio/",
    "/admin-dashboard.html": "/negocio/",
    "/administracion": "/negocio/",
    "/administracion/": "/negocio/",
    "/admin": "/crear-negocio/",
    "/admin.html": "/crear-negocio/",
    "/staff/login": "/equipo/ingresar/",
    "/staff-login": "/equipo/ingresar/",
    "/staff-login.html": "/equipo/ingresar/",
    "/staff": "/equipo/escaner/",
    "/staff.html": "/equipo/escaner/",
    "/c": "/mi-tarjeta/",
    "/customer": "/mi-tarjeta/",
    "/customer.html": "/mi-tarjeta/",
    "/super": "/plataforma/",
    "/super.html": "/plataforma/",
    "/app-preview": "/vista-previa-app/",
    "/app-preview/": "/vista-previa-app/",
    "/join": "/registro/",
    "/join.html": "/registro/",
    "/registro.html": "/registro/",
    "/ingresar": "/ingresar/",
    "/ingresar.html": "/ingresar/",
  };
  for (const [before, after] of Object.entries(routes)) {
    assert.equal(
      resolveSpanishWebRedirect(
        `${before}?token=a%2Bb%2fc&next=%2Fc&unknown=one+two&unknown=again`,
      ),
      `${after}?token=a%2Bb%2fc&next=%2Fc&unknown=one+two&unknown=again`,
      before,
    );
  }
});

test("Spanish entry paths normalize their trailing slash without touching business identifiers", () => {
  for (const path of [
    "/negocio",
    "/demostracion",
    "/crear-negocio",
    "/equipo/ingresar",
    "/equipo/escaner",
    "/mi-tarjeta",
    "/plataforma",
    "/vista-previa-app",
    "/registro",
    "/ingresar",
  ]) {
    assert.equal(resolveSpanishWebRedirect(`${path}?token=abc`), `${path}/?token=abc`);
    assert.equal(resolveSpanishWebRedirect(`${path}/?token=abc`), "");
  }
  for (const path of [
    "/registro/Cafe-Capital",
    "/registro/Cafe-Capital/",
    "/ingresar/Cafe-Capital",
    "/ingresar/Cafe-Capital/",
  ]) {
    assert.equal(resolveSpanishWebRedirect(`${path}?token=abc`), "", path);
  }
});

test("merchant demo aliases select the demo route without losing other query values", () => {
  assert.equal(
    resolveSpanishWebRedirect("/merchant/?demo=1&token=a%2Bb&campaign=demo"),
    "/demostracion/?token=a%2Bb&campaign=demo",
  );
  assert.equal(resolveSpanishWebRedirect("/negocio/?demo=1"), "/demostracion/");
  assert.equal(resolveSpanishWebRedirect("/merchant/?demo=0"), "/negocio/?demo=0");
  // A retired owner link with the demo flag opens the demo page the same way.
  assert.equal(
    resolveSpanishWebRedirect("/administracion/?demo=1&seccion=recompensas"),
    "/demostracion/#recompensas",
  );
});

test("retired owner dashboard views open the merchant page that now holds each capability", () => {
  const sections = {
    rewards: "recompensas",
    recompensas: "recompensas",
    branding: "identidad",
    marca: "identidad",
    tiers: "niveles",
    branches: "sucursales",
    staff: "personal",
    equipo: "personal",
    giftcards: "tarjetas-de-regalo",
    "tarjetas-regalo": "tarjetas-de-regalo",
    achievements: "logros-y-retos",
    challenges: "logros-y-retos",
    logros: "logros-y-retos",
    retos: "logros-y-retos",
    referrals: "referidos",
    operations: "puesta-en-marcha",
    operaciones: "puesta-en-marcha",
    reportes: "reportes",
    plan: "reportes",
    analytics: "analitica",
    analisis: "analitica",
    program: "preparar",
    programa: "preparar",
  };
  for (const [before, after] of Object.entries(sections)) {
    for (const path of ["/admin-dashboard", "/admin-dashboard.html", "/administracion/"]) {
      // The branch filter has no merchant counterpart and is dropped; other values survive.
      assert.equal(
        resolveSpanishWebRedirect(`${path}?tab=${before}&branch_id=sucursal%2F1&token=a%2Bb`),
        `/negocio/?token=a%2Bb#${after}`,
        `${path} tab=${before}`,
      );
      assert.equal(
        resolveSpanishWebRedirect(`${path}?seccion=${before}&sucursal=1`),
        `/negocio/#${after}`,
        `${path} seccion=${before}`,
      );
    }
  }
  assert.equal(
    resolveSpanishWebRedirect("/administracion/?setup=program&future=one+two"),
    "/negocio/?future=one+two#limites",
  );
  assert.equal(
    resolveSpanishWebRedirect("/administracion/?configurar=puntos"),
    "/negocio/#limites",
  );
  assert.equal(
    resolveSpanishWebRedirect("/admin-dashboard.html?setup=pos"),
    "/negocio/#conectar-caja",
  );
  assert.equal(
    resolveSpanishWebRedirect("/administracion/?configurar=punto-de-venta"),
    "/negocio/#conectar-caja",
  );
  // A section wins over a setup flow; the first section value is kept.
  assert.equal(
    resolveSpanishWebRedirect(
      "/administracion/?tab=staff&seccion=marca&branch_id=old&sucursal=new&setup=pos&configurar=puntos",
    ),
    "/negocio/#personal",
  );
  // Unknown views land on the merchant overview without a hash.
  assert.equal(resolveSpanishWebRedirect("/admin-dashboard?tab=future"), "/negocio/");
  assert.equal(
    resolveSpanishWebRedirect("/administracion/?seccion=future&unknown=a%2fb"),
    "/negocio/?unknown=a%2fb",
  );
  assert.equal(resolveSpanishWebRedirect("/administracion/"), "/negocio/");
  assert.equal(
    resolveSpanishWebRedirect("/ADMINISTRACION/?seccion=Reportes"),
    "/negocio/#reportes",
  );
  // Only the retired owner entries translate their query; the merchant app's own URL is untouched.
  assert.equal(resolveSpanishWebRedirect("/negocio/?seccion=recompensas"), "");
  assert.equal(resolveSpanishWebRedirect("/merchant/?tab=rewards"), "/negocio/?tab=rewards");
  assert.equal(isSpanishWebRoutePath("/administracion/"), true);
  assert.equal(isSpanishWebRoutePath("/admin-dashboard"), true);
});

test("merchantViewForLegacyOwnerQuery keeps opaque components and drops the view state", () => {
  assert.deepEqual(
    merchantViewForLegacyOwnerQuery("token=a%2Bb&seccion=niveles&sucursal=2&x=1&x=2"),
    { query: "token=a%2Bb&x=1&x=2", hash: "#niveles" },
  );
  assert.deepEqual(merchantViewForLegacyOwnerQuery(""), { query: "", hash: "" });
  assert.deepEqual(merchantViewForLegacyOwnerQuery("branch_id=1"), { query: "", hash: "" });
});

test("API, assets, preview internals and unrelated paths are untouched", () => {
  for (const path of [
    "/api/admin",
    "/merchant/assets/app.js",
    "/negocio/recursos/app.js",
    "/admin-dashboard/core.js",
    "/staff.js",
    "/customer/index.js",
    "/app-preview/account",
    "/app-preview/_expo/static/js/app.js",
    "/",
    "/privacidad",
    "/not-found",
    "//admin",
    "https://example.com/admin",
  ]) {
    assert.equal(resolveSpanishWebRedirect(`${path}?tab=rewards&token=a%2Bb`), "", path);
  }
});

test("every served owner/demo index alias canonicalizes before host split", () => {
  assert.equal(
    resolveSpanishWebRedirect("/demostracion/index.html?utm_source=qr"),
    "/demostracion/?utm_source=qr",
  );
  assert.equal(resolveSpanishWebRedirect("/negocio/index.html?demo=1"), "/demostracion/");
  assert.equal(resolveSpanishWebRedirect("/negocio/index.html"), "/negocio/");
  assert.equal(isSpanishWebRoutePath("/demostracion/index.html"), true);
});

test("public credential entry canonicalizes while remaining outside application host routes", () => {
  assert.equal(
    resolveSpanishWebRedirect("/credenciales?utm_source=qr"),
    "/credenciales/?utm_source=qr",
  );
  assert.equal(
    resolveSpanishWebRedirect("/credenciales/index.html?ref=a%2Bb"),
    "/credenciales/?ref=a%2Bb",
  );
  assert.equal(resolveSpanishWebRedirect("/credenciales/?utm_source=qr"), "");
  assert.equal(resolveSpanishWebRedirect("/credenciales/credenciales.js"), "");
  assert.equal(isSpanishWebRoutePath("/credenciales"), false);
  assert.equal(isSpanishWebRoutePath("/credenciales/"), false);
  assert.equal(isSpanishWebRoutePath("/credenciales/index.html"), false);
});
