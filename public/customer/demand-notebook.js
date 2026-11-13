import { clearWalletView, invalidateCustomerIdentity, isCustomerAuthError, onCustomerViewClear } from './session.js';
let mounted = null;
let version = 0;
export function clearCustomerDemand() {
  version++;
  mounted?.destroy();
  mounted = null;
}
onCustomerViewClear(clearCustomerDemand);
export async function loadCustomerDemand({ api, $, isCurrent }) {
  clearCustomerDemand();
  const current = version;
  const container = $('#customerDemand');
  if (!container || !isCurrent()) return;
  try {
    const { mountDemandNotebook } = await import('../demand-notebook.js');
    if (current !== version || !isCurrent()) return;
    mounted = mountDemandNotebook({ container, source: 'customer', request: async (path, options) => {
      if (current !== version || !isCurrent()) throw new DOMException('La sesión cambió.', 'AbortError');
      try {
        const result = await api(path, options);
        if (current !== version || !isCurrent()) throw new DOMException('La sesión cambió.', 'AbortError');
        return result;
      } catch (error) {
        if (current === version && isCurrent() && isCustomerAuthError(error)) {
          invalidateCustomerIdentity();
          clearWalletView($);
          const login = $('#needLogin');
          if (login) { login.hidden = false; login.classList.toggle('is-hidden', false); }
          const subtitle = $('#customerEntrySubtitle');
          if (subtitle) subtitle.textContent = 'Tu sesión venció. Ingresa de nuevo para consultar tus pedidos.';
        }
        throw error;
      }
    } });
  } catch {
    if (current === version && isCurrent()) container.textContent = 'No pudimos cargar tus pedidos. Actualiza la tarjeta para volver a intentar.';
  }
}
