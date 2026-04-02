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
 * @param {{ $: (selector: string) => Element | null; toast: (message: string) => void }} deps
 */
export function createQrController({ $, toast }) {
  let qrTimer = null;
  let lastExp = null;

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
    try {
      const resp = await fetch("/api/public/customer/qr.svg", { credentials: "include" });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(t || `HTTP ${resp.status}`);
      }
      const svg = await resp.text();

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

      if (qrWrap) {
        qrWrap.replaceChildren();
        qrWrap.appendChild(svgElement.cloneNode(true));
      }

      const exp = Number(resp.headers.get("x-qr-exp") || 0);
      lastExp = exp ? new Date(exp * 1000) : null;

      const expEl = /** @type {HTMLElement | null} */ (el("#qrExp"));
      if (expEl) expEl.textContent = lastExp ? lastExp.toLocaleTimeString() : "—";
      const hintEl = /** @type {HTMLElement | null} */ (el("#qrHint"));
      if (hintEl) hintEl.textContent = lastExp ? "Muestra este QR al personal para sumar puntos." : "";

      clearTimer();
      qrTimer = setInterval(() => {
        if (!lastExp) return;
        const ms = lastExp.getTime() - Date.now();
        if (ms < 12_000) generateQR().catch(() => {});
      }, 3_000);
    } catch (e) {
      toast(e.message || "No se pudo generar QR");
    }
  }

  function dispose() {
    clearTimer();
    lastExp = null;
  }

  return { generateQR, dispose };
}
