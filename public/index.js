import { mountIosInstallHint, registerServiceWorker } from "/lib.js";

registerServiceWorker().catch(() => {});
mountIosInstallHint();

const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("visible"); observer.unobserve(e.target); } });
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// Contact form
const contactForm = /** @type {HTMLFormElement|null} */ (document.getElementById("contactForm"));
if (contactForm) {
  const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById("contactSubmit"));
  const statusEl = /** @type {HTMLParagraphElement} */ (document.getElementById("contactStatus"));

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = /** @type {HTMLInputElement} */ (document.getElementById("cfName")).value.trim();
    const contact = /** @type {HTMLInputElement} */ (document.getElementById("cfContact")).value.trim();
    const message = /** @type {HTMLTextAreaElement} */ (document.getElementById("cfMessage")).value.trim();
    const turnstileToken = (/** @type {HTMLInputElement|null} */ (contactForm.querySelector("[name=cf-turnstile-response]")))?.value || "";

    if (!name || !contact || !message) {
      statusEl.textContent = "Por favor completa todos los campos.";
      statusEl.className = "contact-status contact-status-error";
      return;
    }

    if (!turnstileToken) {
      statusEl.textContent = "Por favor completa la verificación.";
      statusEl.className = "contact-status contact-status-error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando…";
    statusEl.textContent = "";
    statusEl.className = "contact-status";

    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contact, message, turnstileToken })
      });
      if (res.ok) {
        contactForm.reset();
        statusEl.textContent = "¡Mensaje enviado! Te contactaremos pronto.";
        statusEl.className = "contact-status contact-status-success";
      } else {
        statusEl.textContent = "Por favor revisa los campos e intenta de nuevo.";
        statusEl.className = "contact-status contact-status-error";
        submitBtn.disabled = false;
        submitBtn.textContent = "Enviar mensaje";
        if (window.turnstile) window.turnstile.reset();
      }
    } catch {
      statusEl.textContent = "Error de conexión. Intenta de nuevo.";
      statusEl.className = "contact-status contact-status-error";
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar mensaje";
      if (window.turnstile) window.turnstile.reset();
    }
  });
}
