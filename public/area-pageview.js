// Count visits to application screens using fixed labels. Entry URLs can contain a
// business slug, a return destination or a checkout identifier.
(() => {
  const pages = new Map([
    ["wallet", "/mi-tarjeta/"],
    ["team", "/equipo/"],
    ["team-login", "/equipo/ingresar/"],
    ["owner", "/negocio/"],
    ["platform", "/super/"],
    ["onboarding", "/crear-negocio/"],
    ["login", "/ingresar/"],
    ["enrollment", "/registro/"],
  ]);
  const url = pages.get(document.currentScript?.getAttribute("data-area"));
  if (!url || location.origin !== "https://app.puntosfieles.com") return;
  if (
    url === "/negocio/" &&
    (location.pathname.startsWith("/demostracion") ||
      new URLSearchParams(location.search).get("demo") === "1")
  )
    return;
  if (
    navigator.doNotTrack === "1" ||
    /** @type {Navigator & { globalPrivacyControl?: boolean }} */ (navigator).globalPrivacyControl
  )
    return;
  try {
    if (localStorage.getItem("umami.disabled")) return;
    void fetch("https://privatrack.com/api/send", {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event",
        payload: {
          website: "e2ed248a-786d-472f-a3b6-333c949602e6",
          hostname: "app.puntosfieles.com",
          url,
        },
      }),
    }).catch(() => {});
  } catch {
    // Visits from browsers that disable storage or reporting remain uncounted.
  }
})();
