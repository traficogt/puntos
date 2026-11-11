let turnstileLoadPromise = null;

function ensureTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoadPromise) return turnstileLoadPromise;

  turnstileLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pf-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?hl=es";
    script.async = true;
    script.defer = true;
    script.dataset.pfTurnstile = "true";
    script.addEventListener("load", () => resolve(window.turnstile), { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.appendChild(script);
  });

  return turnstileLoadPromise;
}

// This preview uses illustrative values and never sends a transaction.
const demoVisit = /** @type {HTMLButtonElement|null} */ (document.getElementById("demoVisit"));
if (demoVisit) {
  const pointsEl = document.getElementById("demoPoints");
  const progress = /** @type {HTMLProgressElement|null} */ (document.getElementById("demoProgress"));
  const progressLabel = document.getElementById("demoProgressLabel");
  const feedback = document.getElementById("demoFeedback");
  const card = document.querySelector(".loyalty-demo");
  let points = 340;
  demoVisit.hidden = false;
  demoVisit.addEventListener("click", () => {
    points = points >= 400 ? 340 : points + 40;
    const earned = points >= 400;
    if (pointsEl) pointsEl.textContent = String(points);
    if (progress) {
      progress.value = Math.min(points, 400);
      progress.textContent = `${Math.min(points, 400)} de 400 puntos`;
    }
    if (progressLabel) progressLabel.textContent = earned ? "Tu recompensa está lista para disfrutar" : `Te faltan ${400 - points} puntos para tu recompensa`;
    if (feedback) feedback.textContent = earned ? "¡Una recompensa lista! Así se siente volver. Ejemplo ilustrativo." : points === 340 ? "Una tarjeta de ejemplo. Imagina la de tu negocio." : "+40 puntos. Una visita más cerca de tu recompensa. Ejemplo ilustrativo.";
    card?.classList.toggle("is-earned", earned);
    demoVisit.textContent = earned ? "Volver a probar" : "Simular una visita";
  });
}

// Contact form
const contactForm = /** @type {HTMLFormElement|null} */ (document.getElementById("contactForm"));
if (contactForm) {
  const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById("contactSubmit"));
  const statusEl = /** @type {HTMLParagraphElement} */ (document.getElementById("contactStatus"));
  submitBtn.disabled = false;
  const contactSection = /** @type {HTMLElement|null} */ (document.getElementById("contacto"));
  const contactChallenge = /** @type {HTMLElement|null} */ (contactForm.querySelector(".cf-turnstile"));

  contactForm.addEventListener("input", (event) => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.removeAttribute("aria-invalid");
    }
  });

  const loadVerification = () => {
    ensureTurnstileScript().catch(() => {
      statusEl.textContent = "No pudimos cargar la verificación. Recarga la página e inténtalo de nuevo.";
      statusEl.className = "contact-status contact-status-error";
    });
  };

  if (contactSection && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        loadVerification();
        observer.disconnect();
      });
    }, { rootMargin: "180px 0px" });
    observer.observe(contactSection);
  } else {
    loadVerification();
  }

  contactChallenge?.addEventListener("pointerenter", loadVerification, { once: true });
  contactChallenge?.addEventListener("focusin", loadVerification, { once: true });

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = /** @type {HTMLInputElement} */ (document.getElementById("cfName")).value.trim();
    const business = /** @type {HTMLInputElement} */ (document.getElementById("cfBusiness")).value.trim();
    const contact = /** @type {HTMLInputElement} */ (document.getElementById("cfContact")).value.trim();
    const locations = /** @type {HTMLInputElement|null} */ (document.getElementById("cfLocations"))?.value.trim() || "";
    const message = /** @type {HTMLTextAreaElement} */ (document.getElementById("cfMessage")).value.trim();
    const turnstileToken = (/** @type {HTMLInputElement|null} */ (contactForm.querySelector("[name=cf-turnstile-response]")))?.value || "";

    const requiredFields = [
      { id: "cfName", value: name, message: "Escribe tu nombre para que podamos contactarte." },
      { id: "cfBusiness", value: business, message: "Escribe el nombre de tu negocio." },
      { id: "cfContact", value: contact, message: "Escribe un correo o teléfono de contacto." },
      { id: "cfMessage", value: message, message: "Cuéntanos qué quieres resolver en tu negocio." }
    ];
    const missing = requiredFields.find((field) => !field.value);
    if (missing) {
      statusEl.textContent = missing.message;
      statusEl.className = "contact-status contact-status-error";
      const field = document.getElementById(missing.id);
      field?.setAttribute("aria-invalid", "true");
      field?.focus();
      return;
    }

    if (!turnstileToken) {
      loadVerification();
      statusEl.textContent = "Por favor completa la verificación.";
      statusEl.className = "contact-status contact-status-error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando solicitud…";
    statusEl.textContent = "";
    statusEl.className = "contact-status";

    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          business,
          contact,
          message: locations ? `${message}\n\nContexto operativo: ${locations}` : message,
          turnstileToken
        })
      });
      if (res.ok) {
        contactForm.reset();
        submitBtn.textContent = "Solicitud enviada";
        try { window["umami"]?.track("demo_inquiry_submitted"); } catch { /* Measurement is optional. */ }
        statusEl.textContent = "Recibimos tu solicitud. Te escribimos pronto para coordinar la demo.";
        statusEl.className = "contact-status contact-status-success";
      } else {
        statusEl.textContent = "Revisa los campos e inténtalo de nuevo.";
        statusEl.className = "contact-status contact-status-error";
        submitBtn.disabled = false;
        submitBtn.textContent = "Solicitar demo";
        if (window.turnstile) window.turnstile.reset();
      }
    } catch {
      statusEl.textContent = "Error de conexión. Intenta de nuevo.";
      statusEl.className = "contact-status contact-status-error";
      submitBtn.disabled = false;
      submitBtn.textContent = "Solicitar demo";
      if (window.turnstile) window.turnstile.reset();
    }
  });
}
