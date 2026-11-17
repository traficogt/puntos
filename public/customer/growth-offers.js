import { setHidden } from '/lib.js';
import { formatPoints } from './format.js';
import { isCustomerAuthError } from './session.js';
export function clearGrowthOffers($) {
  const list = $('#growthOffers');
  if (list) list.replaceChildren();
  setHidden($('#growthOffersSection'), true);
}
/** Replaces the displayed offers only when this load's answer arrives. */
export async function loadGrowthOffers({ api, $, isCurrent, region = undefined }) {
  const list = $('#growthOffers');
  if (!list) return;
  try {
    const data = await api('/api/customer/growth-offers', { cache: 'no-store' });
    if (!isCurrent()) return;
    if (!navigator.onLine) return clearGrowthOffers($);
    const rows = (data.offers || []).map(offer => {
      const row = document.createElement('div');
      row.className = 'cus-activity-pane';
      const title = document.createElement('h3');
      title.textContent = offer.name;
      const terms = document.createElement('p');
      const amount = new Intl.NumberFormat(region?.locale || 'es-GT', { style: 'currency', currency: region?.currency || 'GTQ' }).format(offer.minimum_purchase_q);
      const expiry = new Intl.DateTimeFormat(region?.locale || 'es-GT', { dateStyle: 'medium', timeStyle: 'short', timeZone: region?.timezone || 'America/Guatemala' }).format(new Date(offer.expires_at));
      terms.textContent = `${formatPoints(offer.bonus_points, region)} extra en una compra de ${amount} o más. Una vez, hasta ${expiry} (zona ${region?.timezone || 'America/Guatemala'}). ${Math.abs(Number(offer.bonus_points)) === 1 ? 'Se aplica' : 'Se aplican'} al registrar tu compra; si coinciden ofertas, se usa la que vence primero.`;
      if (offer.availability_terms) terms.textContent += ` ${offer.availability_terms}`;
      row.append(title, terms);
      return row;
    });
    list.replaceChildren(...rows);
    setHidden($('#growthOffersSection'), !rows.length);
  } catch (error) {
    if (!isCurrent()) return;
    if (isCustomerAuthError(error)) throw error;
    if (!navigator.onLine) return clearGrowthOffers($);
    const note = document.createElement('p');
    note.textContent = 'No pudimos consultar tus ofertas. Actualiza tu tarjeta cuando tengas conexión.';
    list.replaceChildren(note); setHidden($('#growthOffersSection'), false);
  }
}
