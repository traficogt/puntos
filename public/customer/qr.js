export function shouldEmbedQrLogo({ plan, logoUrl, enabled }) {
  return String(plan || "").toUpperCase() === "EMPRESA"
    && Boolean(enabled)
    && /^https:\/\//i.test(String(logoUrl || "").trim());
}

function decorateQrSvgWithLogo(svgElement, logoUrl) {
  const NS = "http://www.w3.org/2000/svg";
  const size = 82;
  const x = 256 - (size / 2);
  const y = 256 - (size / 2);

  const badge = document.createElementNS(NS, "rect");
  badge.setAttribute("x", String(x - 10));
  badge.setAttribute("y", String(y - 10));
  badge.setAttribute("width", String(size + 20));
  badge.setAttribute("height", String(size + 20));
  badge.setAttribute("rx", "24");
  badge.setAttribute("fill", "#ffffff");

  const image = document.createElementNS(NS, "image");
  image.setAttribute("href", logoUrl);
  image.setAttribute("x", String(x));
  image.setAttribute("y", String(y));
  image.setAttribute("width", String(size));
  image.setAttribute("height", String(size));
  image.setAttribute("preserveAspectRatio", "xMidYMid slice");

  svgElement.appendChild(badge);
  svgElement.appendChild(image);
}

export function waitForQrLogoAsset(logoUrl, { ImageCtor = Image, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const img = new ImageCtor();
    img.onload = () => done(true);
    img.onerror = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    img.src = logoUrl;
  });
}

/**
 * The status and code of a failed QR response. Its body is never shown.
 * @param {Response} resp
 */
export async function qrResponseError(resp) {
  let body = null;
  try { body = await resp.json(); } catch { /* Non-JSON bodies carry no code. */ }
  const error = /** @type {Error & { status?: number; code?: string }} */ (new Error(`HTTP ${resp.status}`));
  error.status = resp.status;
  if (typeof body?.code === "string") error.code = body.code;
  return error;
}

/**
 * Customer-facing Spanish copy for a QR failure other than an ended session.
 * @param {unknown} error
 */
export function qrErrorMessage(error) {
  const status = Number(/** @type {{ status?: number }} */ (error)?.status || 0);
  if (status === 429) return "Generaste varios QR seguidos. Espera un momento e inténtalo de nuevo.";
  if (!status && (error instanceof TypeError || !navigator.onLine)) return "No se pudo generar tu QR. Revisa tu conexión e inténtalo de nuevo.";
  return "No se pudo generar tu QR. Inténtalo de nuevo en un momento.";
}

/**
 * @param {{ $: (selector: string) => Element | null; toast: (message: string) => void; onSessionExpired?: () => void }} deps
 */
export function createQrController({ $, toast, onSessionExpired = () => toast("Tu sesión venció. Vuelve a entrar desde el acceso del negocio.") }) {
  let qrTimer = null;
  let lastExp = null;
  let generation = 0;
  let inFlight = false;

  function clearTimer() {
    if (qrTimer) clearInterval(qrTimer);
    qrTimer = null;
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement | HTMLInputElement | null}
   */
  function el(selector) {
    return /** @type {HTMLElement | HTMLInputElement | null} */ ($(selector));
  }

  async function generateQR() {
    if (inFlight) return;
    inFlight = true;
    const version = generation;
    const epoch = getCustomerEpoch();
    const isCurrent = () => version === generation && epoch === getCustomerEpoch();
    try {
      const resp = await fetch("/api/public/customer/qr.svg", { credentials: "include" });
      if (!isCurrent()) return;
      if (!resp.ok) throw await qrResponseError(resp);
      const svg = await resp.text();
      if (!isCurrent()) return;

      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, "image/svg+xml");

      const parserError = doc.querySelector("parsererror");
      if (parserError) throw new Error("Invalid SVG format");

      const svgElement = doc.querySelector("svg");
      if (!svgElement) throw new Error("No SVG element found");

      const dangerousTags = ["script", "iframe", "object", "embed", "foreignObject"];
      dangerousTags.forEach((tag) => {
        const elements = svgElement.querySelectorAll(tag);
        elements.forEach((el) => el.remove());
      });

      const allElements = svgElement.querySelectorAll("*");
      allElements.forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name.startsWith("on")) {
            el.removeAttribute(attr.name);
          }
        });
      });

      const qrWrap = /** @type {HTMLElement | null} */ (el("#qrWrap"));
      const plan = qrWrap?.dataset.plan || "";
      const logoUrl = qrWrap?.dataset.logoUrl || "";
      const enabled = qrWrap?.dataset.qrLogoEnabled === "true";

      if (shouldEmbedQrLogo({ plan, logoUrl, enabled })) {
        try {
          if (await waitForQrLogoAsset(logoUrl)) {
            decorateQrSvgWithLogo(svgElement, logoUrl);
          }
        } catch {
          // Fall back silently to the plain QR.
        }
      }

      if (!isCurrent()) return;

      if (qrWrap) {
        qrWrap.replaceChildren();
        qrWrap.appendChild(svgElement.cloneNode(true));
      }

      const exp = Number(resp.headers.get("x-qr-exp") || 0);
      lastExp = exp ? new Date(exp * 1000) : null;

      const expEl = /** @type {HTMLElement | null} */ (el("#qrExp"));
      if (expEl) expEl.textContent = lastExp ? formatDate(lastExp, walletRegion($), { timeStyle: "medium" }) : "—";
      const hintEl = /** @type {HTMLElement | null} */ (el("#qrHint"));
      if (hintEl) hintEl.textContent = lastExp ? "Muestra este QR al personal para sumar puntos." : "";

      clearTimer();
      qrTimer = setInterval(() => {
        if (!isCurrent()) { dispose(); return; }
        if (!lastExp) return;
        const ms = lastExp.getTime() - Date.now();
        if (ms <= 0) {
          el("#qrWrap")?.replaceChildren();
          const hint = el("#qrHint");
          if (hint) hint.textContent = "Tu QR venció. Conéctate para generar uno nuevo.";
        }
        if (!navigator.onLine) return;
        if (ms < 12_000) generateQR().catch(() => {});
      }, 3_000);
    } catch (e) {
      if (!isCurrent()) return;
      if (isCustomerAuthError(e)) {
        // The wallet's session-expired flow clears the card and asks for a new login.
        dispose();
        onSessionExpired();
        return;
      }
      toast(qrErrorMessage(e));
    } finally {
      inFlight = false;
    }
  }

  function dispose() {
    generation += 1;
    clearTimer();
    lastExp = null;
  }

  return { generateQR, dispose };
}
import { formatDate, walletRegion } from "./format.js";
import { getCustomerEpoch, isCustomerAuthError } from "./session.js";
