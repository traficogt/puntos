import { normalizeHostHeader } from './app-host-routing.js';

// Only server-selected brands can choose a recipient; never accept a destination
// supplied in the public form payload.
export function contactSite(host, defaultRecipient) {
  if (normalizeHostHeader(host) === 'pertenecegt.com') {
    return { name: 'Pertenece', domain: 'pertenecegt.com', to: 'hola@pertenecegt.com' };
  }
  return { name: 'PuntosFieles', domain: 'puntosfieles.com', to: defaultRecipient };
}
