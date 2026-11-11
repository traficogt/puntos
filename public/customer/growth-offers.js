import { setHidden } from '/lib.js';
import { isCustomerAuthError } from './session.js';
export function clearGrowthOffers($) {
  const list = $('#growthOffers');
  if (list) list.replaceChildren();
  setHidden($('#growthOffersSection'), true);
}
export async function loadGrowthOffers({ api, $, isCurrent, region = undefined }) {
  clearGrowthOffers($);
  const list = $('#growthOffers');
  if (!list) return;
  try {
    const data = await api('/api/customer/growth-offers', { cache: 'no-store' });
    if (!isCurrent() || !navigator.onLine) return;
    for (const offer of data.offers || []) {
      const row = document.createElement('div');
      row.className = 'cus-activity-pane';
      const title = document.createElement('h3');
      title.textContent = offer.name;
      const terms = document.createElement('p');
      const amount = new Intl.NumberFormat(region?.locale || 'es-GT', { style: 'currency', currency: region?.currency || 'GTQ' }).format(offer.minimum_purchase_q);
      const expiry = new Intl.DateTimeFormat(region?.locale || 'es-GT', { dateStyle: 'medium', timeStyle: 'short', timeZone: region?.timezone || 'America/Guatemala' }).format(new Date(offer.expires_at));
      terms.textContent = `${offer.bonus_points} puntos extra en una compra de ${amount} o más. Una vez, hasta ${expiry} (zona ${region?.timezone || 'America/Guatemala'}). Se aplican al registrar tu compra; si coinciden ofertas, se usa la que vence primero.`;
      if (offer.availability_terms) terms.textContent += ` ${offer.availability_terms}`;
      row.append(title, terms); list.append(row);
    }
    setHidden($('#growthOffersSection'), !data.offers?.length);
  } catch (error) {
    if (!isCurrent()) return;
    if (isCustomerAuthError(error)) throw error;
    if (!navigator.onLine) return;
    const note = document.createElement('p');
    note.textContent = 'No pudimos consultar tus ofertas. Actualiza tu tarjeta cuando tengas conexión.';
    list.append(note); setHidden($('#growthOffersSection'), false);
  }
}
