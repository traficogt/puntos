import { mountIosInstallHint } from "/lib.js";

mountIosInstallHint();

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

const revealNodes = [...document.querySelectorAll(".reveal")];
if (revealNodes.length > 0 && "IntersectionObserver" in window) {
  revealNodes.forEach((el) => el.classList.add("reveal-ready"));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("visible");
      observer.unobserve(e.target);
    });
  }, { threshold: 0.12 });
  revealNodes.forEach((el) => observer.observe(el));
}

// Contact form
const contactForm = /** @type {HTMLFormElement|null} */ (document.getElementById("contactForm"));
if (contactForm) {
  const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById("contactSubmit"));
  const statusEl = /** @type {HTMLParagraphElement} */ (document.getElementById("contactStatus"));
  const contactSection = /** @type {HTMLElement|null} */ (document.getElementById("contacto"));
  const contactChallenge = /** @type {HTMLElement|null} */ (contactForm.querySelector(".cf-turnstile"));

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

    if (!name || !business || !contact || !message) {
      statusEl.textContent = "Por favor completa todos los campos.";
      statusEl.className = "contact-status contact-status-error";
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
