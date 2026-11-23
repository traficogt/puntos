const $ = (id) => document.getElementById(id);
const form = $("support-form");
const stateNames = {
  new: "Recibido",
  open: "En revisión",
  waiting: "Esperando tu respuesta",
  resolved: "Resuelto",
  closed: "Cerrado",
};
let pending = null,
  trackingToken = "",
  attachment = null,
  previewUrl = "",
  caseImageUrl = "",
  replyAttempt = null,
  readingFile = false,
  formReady = false;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const secret = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const diagnostics = () => ({
  screen: "support",
  online: navigator.onLine,
  browser: /Firefox\//.test(navigator.userAgent)
    ? "Firefox"
    : /Edg\//.test(navigator.userAgent)
      ? "Edge"
      : /Chrome\//.test(navigator.userAgent)
        ? "Chrome"
        : /Safari\//.test(navigator.userAgent)
          ? "Safari"
          : "Other",
  device: matchMedia("(pointer:coarse)").matches ? "mobile" : "desktop",
  language: /^[A-Za-z-]{2,20}$/.test(navigator.language) ? navigator.language : "es",
  viewport: `${innerWidth}x${innerHeight}`,
});
const diagnosticLabels = {
  screen: "Pantalla",
  online: "Conexión",
  browser: "Navegador",
  device: "Dispositivo",
  language: "Idioma",
  viewport: "Tamaño de ventana",
};
function previewDiagnostics() {
  const d = diagnostics();
  $("diagnostics-preview").replaceChildren(
    ...Object.entries(d).flatMap(([k, v]) => {
      const dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = diagnosticLabels[k];
      dd.textContent =
        k === "online"
          ? v
            ? "Con conexión"
            : "Sin conexión"
          : k === "screen"
            ? "Soporte"
            : k === "device"
              ? v === "mobile"
                ? "Móvil"
                : "Computadora"
              : String(v);
      return [dt, dd];
    }),
  );
  return d;
}
// This public page deliberately keeps its own transport instead of the shared
// client in /lib.js: the form shows the support service's Spanish copy verbatim
// (the shared client replaces coded errors such as NOT_FOUND and appends a request
// reference), uses distinct copy for connectivity failures and throttling, and
// downloads the attachment as a blob. The CSRF token comes from the same
// pf_csrf_readable cookie the shared client reads (base64url, so decoding is a no-op).
function csrf() {
  return decodeURIComponent(
    document.cookie
      .split("; ")
      .find((v) => v.startsWith("pf_csrf_readable="))
      ?.split("=")
      .slice(1)
      .join("=") || "",
  );
}
async function api(path, body, { binary = false } = {}) {
  let response;
  try {
    response = await fetch(`/api/public/support/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "No pudimos conectar. Conservamos lo que escribiste: revisa tu conexión y vuelve a intentar.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      response.status === 429
        ? "Ya recibimos varios intentos. Espera antes de volver a enviar."
        : data.error || "No pudimos completar la solicitud. Vuelve a intentar.",
    );
    error.status = response.status;
    throw error;
  }
  return binary ? response.blob() : response.json();
}
function caseLink() {
  return `${location.origin}/soporte#caso=${trackingToken}`;
}
function renderCase(data) {
  $("case-attachment").hidden = true;
  if (caseImageUrl) {
    URL.revokeObjectURL(caseImageUrl);
    caseImageUrl = "";
  }
  $("case-receipt").hidden = false;
  $("case-heading").textContent = `Caso ${data.reference}`;
  $("case-state").textContent = stateNames[data.status] || data.status;
  $("case-description").textContent = data.description;
  $("case-link").href = caseLink();
  $("case-link").textContent = caseLink();
  $("show-attachment").hidden = !data.attachment;
  $("reply-form").hidden = data.status === "closed";
  $("case-events").replaceChildren(
    ...data.events.map((event) => {
      const li = document.createElement("li"),
        title = document.createElement("strong"),
        time = document.createElement("time"),
        p = document.createElement("p");
      title.textContent =
        event.kind === "customer"
          ? "Tu mensaje"
          : event.kind === "created"
            ? "Reporte recibido"
            : "Soporte";
      time.dateTime = event.createdAt;
      time.textContent = ` · ${new Date(event.createdAt).toLocaleString("es-GT")}`;
      p.textContent = event.message || "Se actualizó el estado del caso.";
      li.append(title, time, p);
      return li;
    }),
  );
}
async function loadCase() {
  const data = await api("track", { trackingToken });
  renderCase(data);
  return data;
}
function readToken(value) {
  try {
    const url = new URL(value);
    return new URLSearchParams(url.hash.slice(1)).get("caso") || "";
  } catch {
    return value.trim();
  }
}
form.addEventListener("input", () => {
  if (!pending) previewDiagnostics();
});
$("support-file").addEventListener("change", async () => {
  const file = $("support-file").files[0];
  attachment = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  $("attachment-preview").hidden = true;
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 614400) {
    $("support-feedback").textContent = "Elige una captura PNG, JPEG o WebP de hasta 600 KB.";
    $("support-file").value = "";
    return;
  }
  readingFile = true;
  $("send-report").disabled = true;
  try {
    attachment = {
      data: await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }),
    };
    previewUrl = URL.createObjectURL(file);
    $("support-preview").src = previewUrl;
    $("attachment-preview").hidden = false;
    $("support-feedback").textContent = "";
  } catch {
    attachment = null;
    $("support-file").value = "";
    $("support-feedback").textContent = "No pudimos leer ese archivo. Selecciona otra captura.";
  } finally {
    readingFile = false;
    $("send-report").disabled = !formReady;
  }
});
$("remove-attachment").addEventListener("click", () => {
  attachment = null;
  $("support-file").value = "";
  $("attachment-preview").hidden = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (readingFile) return;
  const button = $("send-report");
  button.disabled = true;
  button.textContent = "Guardando reporte…";
  $("support-feedback").textContent = "";
  try {
    const f = new FormData(form);
    if (!pending)
      pending = {
        requestId: crypto.randomUUID(),
        trackingToken: secret(),
        name: f.get("name"),
        email: f.get("email"),
        business: f.get("business"),
        category: f.get("category"),
        description: f.get("description"),
        includeAccount: f.get("includeAccount") === "on",
        website: f.get("website") || "",
        ...(f.get("includeDiagnostics") === "on" ? { diagnostics: previewDiagnostics() } : {}),
        ...(attachment ? { attachment } : {}),
      };
    const data = await api("cases", {
      ...pending,
      turnstileToken: document.querySelector('[name="cf-turnstile-response"]')?.value || "",
    });
    trackingToken = pending.trackingToken;
    pending = null;
    renderCase(data);
    document.querySelector(".support-intro").hidden = true;
    $("track-form").hidden = true;
    $("track-feedback").textContent = "Tu reporte quedó guardado. Conserva tu enlace privado.";
    $("case-receipt").focus();
    $("seguimiento").scrollIntoView({ behavior: "auto" });
  } catch (error) {
    if (error.status === 400 || error.status === 413) {
      pending = null;
      $("support-feedback").textContent = error.message;
    } else {
      for (const field of form.querySelectorAll(
        "input:not([name=cf-turnstile-response]),select,textarea",
      ))
        field.disabled = true;
      $("remove-attachment").disabled = true;
      $("support-feedback").textContent =
        `${error.message}\nVuelve a enviar este mismo reporte para recuperar el resultado sin duplicarlo. Los campos quedan protegidos hasta confirmar el envío.`;
    }
    window.turnstile?.reset();
  } finally {
    button.disabled = false;
    button.textContent = "Enviar reporte";
  }
});
$("track-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = readToken(new FormData(e.currentTarget).get("tracking"));
  if (!tokenPattern.test(value)) {
    $("track-feedback").textContent =
      "Pega el enlace privado completo que guardaste al enviar el reporte.";
    return;
  }
  trackingToken = value;
  try {
    await loadCase();
    $("track-feedback").textContent = "";
    $("case-receipt").focus();
  } catch (error) {
    $("track-feedback").textContent = error.message;
  }
});
$("refresh-case").addEventListener("click", async () => {
  try {
    await loadCase();
    $("track-feedback").textContent = "Caso actualizado.";
  } catch (e) {
    $("track-feedback").textContent = e.message;
  }
});
$("reply-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const message = new FormData(e.currentTarget).get("message");
    if (!replyAttempt || replyAttempt.message !== message)
      replyAttempt = { requestId: crypto.randomUUID(), message };
    renderCase(await api("reply", { trackingToken, ...replyAttempt }));
    replyAttempt = null;
    e.target.reset();
    $("track-feedback").textContent = "Tu mensaje quedó guardado.";
  } catch (error) {
    $("track-feedback").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("copy-case-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(caseLink());
    $("track-feedback").textContent = "Enlace privado copiado.";
  } catch {
    $("track-feedback").textContent =
      "Mantén pulsado el enlace para copiarlo o guárdalo como marcador.";
  }
});
$("show-attachment").addEventListener("click", async () => {
  try {
    const blob = await api("attachment", { trackingToken }, { binary: true });
    if (caseImageUrl) URL.revokeObjectURL(caseImageUrl);
    caseImageUrl = URL.createObjectURL(blob);
    $("case-attachment").src = caseImageUrl;
    $("case-attachment").hidden = false;
  } catch (e) {
    $("track-feedback").textContent = e.message;
  }
});
async function openFragment() {
  const fragment = new URLSearchParams(location.hash.slice(1)).get("caso");
  if (!fragment) return;
  history.replaceState(null, "", location.pathname);
  if (!tokenPattern.test(fragment)) {
    $("track-feedback").textContent = "El enlace privado no es válido.";
    return;
  }
  trackingToken = fragment;
  try {
    await loadCase();
    document.querySelector(".support-intro").hidden = true;
    $("track-form").hidden = true;
    $("case-receipt").focus();
  } catch (error) {
    trackingToken = "";
    $("track-feedback").textContent = error.message;
  }
}
window.addEventListener("hashchange", () => openFragment());
async function init() {
  previewDiagnostics();
  await openFragment();
  try {
    const config = await fetch("/api/public/support/config", {
      cache: "no-store",
      credentials: "same-origin",
    }).then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    });
    if (config.challengeRequired && !trackingToken) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      window.turnstile.render("#support-challenge", {
        sitekey: config.siteKey,
        language: "es",
        theme: "light",
        size: "flexible",
      });
    }
    formReady = true;
    $("send-report").disabled = readingFile;
  } catch {
    $("support-feedback").textContent =
      "No pudimos preparar el formulario. Recarga la página o escribe a soporte@puntosfieles.com.";
  }
}
init();
