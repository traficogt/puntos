/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */

/**
 * Camera + QR detection. A scan only *selects* the customer; awarding stays an
 * explicit action on the customer surface.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession>, surface: ReturnType<typeof import("./customer-surface.js").createCustomerSurface> }} deps
 */
export function createScanner(ctx, { session, surface }) {
  const { $, toast, state, run, element, input } = ctx;
  /** @type {BarcodeDetector | null} */
  let detector = null;
  let lastScannedToken = "";
  let lastScannedAt = 0;

  function canScan() {
    return "BarcodeDetector" in window && typeof BarcodeDetector === "function";
  }

  async function startCamera() {
    const video = /** @type {HTMLVideoElement} */ ($("#video"));
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador no permite camara. Usa Chrome/Edge o pega el token manual.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    if (canScan()) {
      try {
        const supported =
          typeof BarcodeDetector.getSupportedFormats === "function"
            ? await BarcodeDetector.getSupportedFormats()
            : null;
        if (Array.isArray(supported) && !supported.includes("qr_code")) {
          detector = null;
          toast("Tu navegador no soporta QR por camara. Usa entrada manual.");
          return;
        }
        detector = Array.isArray(supported)
          ? new BarcodeDetector({ formats: ["qr_code"] })
          : new BarcodeDetector();
      } catch {
        detector = null;
        toast("No se pudo activar escaneo QR. Usa entrada manual.");
      }
    } else {
      detector = null;
      toast("Este navegador no soporta BarcodeDetector. Usa entrada manual.");
    }
  }

  function stopCamera() {
    const video = /** @type {HTMLVideoElement} */ ($("#video"));
    const s = /** @type {MediaStream | null} */ (video.srcObject);
    if (s) s.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  async function scanLoop() {
    const activeDetector = detector;
    if (state.sessionEnded || !state.scanning || !activeDetector) return;
    const video = /** @type {HTMLVideoElement} */ ($("#video"));
    await run(async () => {
      const codes = await activeDetector.detect(video);
      if (codes && codes[0] && codes[0].rawValue) {
        const token = String(codes[0].rawValue || "").trim();
        const now = Date.now();
        // Ignora el mismo token por ~1 minuto para evitar reintentos del mismo QR.
        if (token && token === lastScannedToken && now - lastScannedAt < 65_000) {
          requestAnimationFrame(scanLoop);
          return;
        }

        state.scanning = false; // pause to avoid duplicates
        if (token) {
          lastScannedToken = token;
          lastScannedAt = now;
        }
        input("#token").value = token;
        await surface.selectCustomerFromToken(token, { silent: false });
        setTimeout(() => {
          state.scanning = true;
          requestAnimationFrame(scanLoop);
        }, 1200);
        return;
      }
    });
    requestAnimationFrame(scanLoop);
  }

  function bind() {
    element("#btnStart").addEventListener("click", async () => {
      await run(
        async () => {
          if (!(await session.ensureAuth()) || !session.hasPerm("staff.award")) return;
          await startCamera();
          state.scanning = true;
          requestAnimationFrame(scanLoop);
          toast("Selecciona un cliente...");
        },
        (error) => {
          toast(error?.message || "No se pudo iniciar la camara.");
        },
      );
    });

    element("#btnStop").addEventListener("click", () => {
      state.scanning = false;
      stopCamera();
      toast("Pausado.");
    });

    element("#btnSelectCustomer").addEventListener("click", async () => {
      await run(async () => {
        if (!(await session.ensureAuth()) || !session.hasPerm("staff.award")) return;
        const token = input("#token").value.trim();
        await surface.selectCustomerFromToken(token, { silent: false });
      });
    });

    input("#token").addEventListener("input", () => {
      if (input("#token").value.trim() !== state.lastCustomerToken) {
        surface.clearSelectedCustomer();
      }
    });

    window.addEventListener("pagehide", stopCamera);
  }

  return { bind, stopCamera };
}
