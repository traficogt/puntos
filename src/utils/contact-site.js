import { normalizeHostHeader } from "./app-host-routing.js";

// Only server-selected brands can choose a recipient; never accept a destination
// supplied in the public form payload.
/**
 * The brand a public contact form belongs to, chosen by the request's Host.
 * @param {string | undefined} host the Host header
 * @param {string} defaultRecipient recipient for the PuntosFieles site (CONTACT_TO)
 */
export function contactSite(host, defaultRecipient) {
  if (normalizeHostHeader(host) === "pertenecegt.com") {
    return { name: "Pertenece", domain: "pertenecegt.com", to: "hola@pertenecegt.com" };
  }
  return { name: "PuntosFieles", domain: "puntosfieles.com", to: defaultRecipient };
}
