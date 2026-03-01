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
      if (qrWrap) {
        qrWrap.replaceChildren();
        qrWrap.appendChild(svgElement.cloneNode(true));
      }

      const exp = Number(resp.headers.get("x-qr-exp") || 0);
      const token = resp.headers.get("x-qr-token") || "";
      lastExp = exp ? new Date(exp * 1000) : null;

      const expEl = /** @type {HTMLElement | null} */ (el("#qrExp"));
      if (expEl) expEl.textContent = lastExp ? lastExp.toLocaleTimeString() : "—";
      const hintEl = /** @type {HTMLElement | null} */ (el("#qrHint"));
      if (hintEl) hintEl.textContent = lastExp ? "Muestra este QR al personal para sumar puntos." : "";
      const tokenEl = /** @type {HTMLInputElement | null} */ (el("#qrToken"));
      if (tokenEl) tokenEl.value = token;
      const copyHintEl = /** @type {HTMLElement | null} */ (el("#copyTokenHint"));
      if (copyHintEl) copyHintEl.textContent = token ? "Token listo para pegar en personal." : "";

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
