import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpanishWebRedirect, isSpanishWebRoutePath } from "../../src/utils/spanish-web-routes.js";

test("legacy browser entries permanently canonicalize to Spanish paths with untouched query tokens", () => {
  const routes = {
    "/merchant": "/negocio/", "/merchant/": "/negocio/", "/merchant/index.html": "/negocio/",
    "/admin-dashboard": "/administracion/", "/admin-dashboard.html": "/administracion/",
    "/admin": "/crear-negocio/", "/admin.html": "/crear-negocio/",
    "/staff/login": "/equipo/ingresar/", "/staff-login": "/equipo/ingresar/", "/staff-login.html": "/equipo/ingresar/",
    "/staff": "/equipo/escaner/", "/staff.html": "/equipo/escaner/",
    "/c": "/mi-tarjeta/", "/customer": "/mi-tarjeta/", "/customer.html": "/mi-tarjeta/",
    "/super": "/plataforma/", "/super.html": "/plataforma/",
    "/app-preview": "/vista-previa-app/", "/app-preview/": "/vista-previa-app/",
    "/join": "/registro/", "/join.html": "/registro/", "/registro.html": "/registro/",
    "/ingresar": "/ingresar/", "/ingresar.html": "/ingresar/"
  };
  for (const [before, after] of Object.entries(routes)) {
    assert.equal(resolveSpanishWebRedirect(`${before}?token=a%2Bb%2fc&next=%2Fc&unknown=one+two&unknown=again`), `${after}?token=a%2Bb%2fc&next=%2Fc&unknown=one+two&unknown=again`, before);
  }
});

test("Spanish entry paths normalize their trailing slash without touching business identifiers", () => {
  for (const path of ["/negocio", "/demostracion", "/administracion", "/crear-negocio", "/equipo/ingresar", "/equipo/escaner", "/mi-tarjeta", "/plataforma", "/vista-previa-app", "/registro", "/ingresar"]) {
    assert.equal(resolveSpanishWebRedirect(`${path}?token=abc`), `${path}/?token=abc`);
    assert.equal(resolveSpanishWebRedirect(`${path}/?token=abc`), "");
  }
  for (const path of ["/registro/Cafe-Capital", "/registro/Cafe-Capital/", "/ingresar/Cafe-Capital", "/ingresar/Cafe-Capital/"]) {
    assert.equal(resolveSpanishWebRedirect(`${path}?token=abc`), "", path);
  }
});

test("merchant demo aliases select the demo route without losing other query values", () => {
  assert.equal(resolveSpanishWebRedirect("/merchant/?demo=1&token=a%2Bb&campaign=demo"), "/demostracion/?token=a%2Bb&campaign=demo");
  assert.equal(resolveSpanishWebRedirect("/negocio/?demo=1"), "/demostracion/");
  assert.equal(resolveSpanishWebRedirect("/merchant/?demo=0"), "/negocio/?demo=0");
});

test("admin section and setup aliases translate on both legacy and Spanish entry paths", () => {
  const sections = { rewards: "recompensas", branding: "marca", tiers: "niveles", branches: "sucursales", staff: "equipo", giftcards: "tarjetas-regalo", achievements: "logros", challenges: "retos", referrals: "referidos", operations: "operaciones", analytics: "analisis" };
  for (const [before, after] of Object.entries(sections)) {
    for (const path of ["/admin-dashboard", "/administracion/"]) {
      assert.equal(resolveSpanishWebRedirect(`${path}?tab=${before}&branch_id=sucursal%2F1&token=a%2Bb`), `/administracion/?seccion=${after}&sucursal=sucursal%2F1&token=a%2Bb`);
    }
  }
  assert.equal(resolveSpanishWebRedirect("/administracion/?setup=program&future=one+two"), "/administracion/?configurar=puntos&future=one+two");
  assert.equal(resolveSpanishWebRedirect("/admin-dashboard.html?setup=pos"), "/administracion/?configurar=punto-de-venta");
  assert.equal(resolveSpanishWebRedirect("/administracion/?seccion=recompensas&sucursal=1&configurar=puntos"), "");
  assert.equal(resolveSpanishWebRedirect("/administracion/?tab=staff&seccion=marca&branch_id=old&sucursal=new&setup=pos&configurar=puntos"), "/administracion/?seccion=marca&sucursal=new&configurar=puntos");
  assert.equal(resolveSpanishWebRedirect("/admin-dashboard?tab=future"), "/administracion/?seccion=future");
});

test("API, assets, preview internals, unrelated paths and unknown admin query values are untouched", () => {
  for (const path of ["/api/admin", "/merchant/assets/app.js", "/negocio/recursos/app.js", "/admin-dashboard/core.js", "/staff.js", "/customer/index.js", "/app-preview/account", "/app-preview/_expo/static/js/app.js", "/", "/privacidad", "/not-found", "//admin", "https://example.com/admin"]) {
    assert.equal(resolveSpanishWebRedirect(`${path}?tab=rewards&token=a%2Bb`), "", path);
  }
  assert.equal(resolveSpanishWebRedirect("/administracion/?seccion=future&unknown=a%2fb"), "");
});

test("every served owner/demo index alias canonicalizes before host split", () => {
  assert.equal(resolveSpanishWebRedirect("/demostracion/index.html?utm_source=qr"), "/demostracion/?utm_source=qr");
  assert.equal(resolveSpanishWebRedirect("/negocio/index.html?demo=1"), "/demostracion/");
  assert.equal(resolveSpanishWebRedirect("/negocio/index.html"), "/negocio/");
  assert.equal(isSpanishWebRoutePath("/demostracion/index.html"), true);
});


test("public credential entry canonicalizes while remaining outside application host routes", () => {
  assert.equal(resolveSpanishWebRedirect("/credenciales?utm_source=qr"), "/credenciales/?utm_source=qr");
  assert.equal(resolveSpanishWebRedirect("/credenciales/index.html?ref=a%2Bb"), "/credenciales/?ref=a%2Bb");
  assert.equal(resolveSpanishWebRedirect("/credenciales/?utm_source=qr"), "");
  assert.equal(resolveSpanishWebRedirect("/credenciales/credenciales.js"), "");
  assert.equal(isSpanishWebRoutePath("/credenciales"), false);
  assert.equal(isSpanishWebRoutePath("/credenciales/"), false);
  assert.equal(isSpanishWebRoutePath("/credenciales/index.html"), false);
});
