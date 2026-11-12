// Demonstration only. This page never looks up members or issues passes.
const exampleStates = {
  active: { title: 'Membresía vigente', description: 'El registro de ejemplo confirma que esta membresía está activa.', path: 'm14 24 7 7 13-14' },
  expired: { title: 'Membresía vencida', description: 'El registro de ejemplo indica que debe renovarse. Tener el carné guardado no cambia su vigencia.', path: 'm17 17 14 14m0-14L17 31' },
  offline: { title: 'No se pudo verificar', description: 'Sin conexión no podemos confirmar el estado actual. Recuperá la conexión y consultá de nuevo.', path: 'M24 14v12m0 7v1' }
};
document.querySelector('.demo-switches').hidden = false;
for (const button of document.querySelectorAll('[data-state]')) {
  button.addEventListener('click', () => {
    const state = button.getAttribute('data-state');
    const example = exampleStates[state];
    if (!example) return;
    document.querySelectorAll('[data-state]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
    document.querySelector('[data-result-state]').setAttribute('data-result-state', state);
    document.getElementById('resultTitle').textContent = example.title;
    document.getElementById('resultDescription').textContent = example.description;
    document.getElementById('resultPath').setAttribute('d', example.path);
  });
}
const form = document.getElementById('membershipContact');
const submit = document.getElementById('leadSubmit');
const status = document.getElementById('leadStatus');
let verificationLoading = false;
let sending = false;
let sent = false;
const submitLabel = submit.innerHTML;
submit.disabled = false;
function setStatus(message, kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
}
function loadVerification() {
  if (window.turnstile || verificationLoading) return;
  verificationLoading = true;
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?hl=es';
  script.async = true;
  script.defer = true;
  script.addEventListener('error', () => {
    verificationLoading = false;
    script.remove();
    setStatus('No se pudo cargar la verificación. Revisá tu conexión y volvé a intentar, o escribinos por correo.', 'error');
  });
  document.head.appendChild(script);
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { loadVerification(); observer.disconnect(); }
  }, { rootMargin: '180px' });
  observer.observe(form);
} else loadVerification();
form.addEventListener('focusin', loadVerification);
form.addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || sent) return;
  for (const input of form.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), textarea')) input.value = input.value.trim();
  const invalid = form.querySelector(':invalid');
  if (invalid) {
    invalid.setAttribute('aria-invalid', 'true'); invalid.focus();
    setStatus(invalid.id === 'leadConsent' ? 'Necesitamos tu autorización para contactarte sobre esta solicitud.' : 'Completá los campos requeridos para que podamos preparar tu demostración.', 'error'); return;
  }
  const contact = document.getElementById('leadContact');
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value);
  const phoneDigits = contact.value.replace(/\D/g, '').length;
  const looksLikePhone = /^\+?[\d\s().-]+$/.test(contact.value) && phoneDigits >= 8 && phoneDigits <= 15;
  if (!looksLikeEmail && !looksLikePhone) {
    contact.setAttribute('aria-invalid', 'true'); contact.focus();
    setStatus('Escribí un correo válido o un teléfono de 8 a 15 dígitos, con código de país si corresponde.', 'error'); return;
  }
  const turnstileToken = form.querySelector('[name="cf-turnstile-response"]')?.value || '';
  if (!turnstileToken) { loadVerification(); setStatus('Completá la verificación de seguridad antes de enviar.', 'error'); return; }
  sending = true; submit.disabled = true; submit.textContent = 'Enviando solicitud…'; form.setAttribute('aria-busy', 'true'); setStatus('Enviando tu solicitud…');
  const values = new FormData(form);
  const message = ['Solicitud de PF Credenciales — membresías y verificación.', `Organización: ${values.get('organizationType')}`, `Miembros: ${values.get('memberCount')}`, `Consulta: ${values.get('message') || 'Desea una demostración y cotización.'}`, 'Autorizó contacto para esta solicitud.'].join('\n');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/public/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ name: values.get('name'), business: values.get('business'), contact: values.get('contact'), message, turnstileToken }) });
    if (!response.ok) {
      const feedback = response.status === 429 ? 'Hay demasiados intentos. Esperá unos minutos antes de volver a enviar.' : response.status >= 500 ? 'No pudimos entregar la solicitud. Conservamos tus datos; intentá más tarde o escribinos por correo.' : 'No pudimos validar el envío. Completá nuevamente la verificación e intentá otra vez.';
      throw new Error(feedback);
    }
    const result = await response.json();
    if (result.ok !== true) throw new Error('No pudimos confirmar la recepción. Contactanos por correo antes de reenviar.');
    sent = true; form.reset(); submit.textContent = 'Solicitud recibida'; setStatus('Recibimos tu solicitud. El equipo de PF te contactará para coordinar la demostración.', 'success'); status.focus();
  } catch (error) {
    setStatus(error.name === 'AbortError' || error instanceof TypeError ? 'No pudimos confirmar el envío por un problema de conexión. Tus datos siguen aquí. Antes de reenviar, podés consultar por correo si recibimos tu solicitud.' : error.message, 'error');
    submit.disabled = false; submit.innerHTML = submitLabel;
    try { window.turnstile?.reset(); } catch { /* A blocked challenge must not prevent retry. */ }
  } finally { window.clearTimeout(timeout); sending = false; form.removeAttribute('aria-busy'); }
});
