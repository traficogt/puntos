import {REGIONAL_CURRENCIES} from '../../../public/regional-catalog.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
import { randomUUID, createHash } from 'node:crypto';
import { dbQuery, withTransaction } from '../database.js';
import { badRequest, conflict, notFound } from '../../utils/http-error.js';
import { businessRegion, REGIONAL_COUNTRIES, validateRegionalInput } from './regional-settings.js';
const version = business => createHash('sha256').update(JSON.stringify(businessRegion(business))).digest('hex');
const dfl = { query: dbQuery, transaction: withTransaction };
export async function getMerchantRegion({ businessId }, injected = {}) {
  const d = { ...dfl, ...injected };
  const business = (await d.query('SELECT program_json FROM businesses WHERE id=$1', [businessId])).rows[0];
  if (!business) throw notFound('Negocio no encontrado.');
  const activity = (await d.query('SELECT (EXISTS(SELECT 1 FROM transactions WHERE business_id=$1) OR EXISTS(SELECT 1 FROM reward_unit_costs WHERE business_id=$1) OR EXISTS(SELECT 1 FROM hospitality_grants WHERE business_id=$1) OR EXISTS(SELECT 1 FROM hospitality_entitlements WHERE business_id=$1) OR EXISTS(SELECT 1 FROM gift_cards WHERE business_id=$1) OR EXISTS(SELECT 1 FROM growth_campaigns WHERE business_id=$1) OR EXISTS(SELECT 1 FROM pos_refund_receipts WHERE business_id=$1) OR EXISTS(SELECT 1 FROM reward_economics_settings WHERE business_id=$1)) AS present', [businessId])).rows[0]?.present;
  return { region: businessRegion(business), version: version(business), currency_locked: Boolean(activity), currency_confirmed: business.program_json?.currency_confirmation?.currency === businessRegion(business).currency, currency_confirmed_at: business.program_json?.currency_confirmation?.currency === businessRegion(business).currency ? business.program_json.currency_confirmation.confirmed_at : null, countries: REGIONAL_COUNTRIES, currencies: REGIONAL_CURRENCIES };
}
export async function updateMerchantRegion({ businessId, staffId, input, impersonated_by=null }, injected = {}) {
  if (!input || Object.keys(input).some(key => !['country','currency','timezone','version','confirmed_currency'].includes(key)) || !/^[a-f0-9]{64}$/.test(input.version)) throw badRequest('Revisa la configuración regional.');
  if (input.confirmed_currency !== undefined && input.confirmed_currency !== input.currency) throw badRequest('La confirmación debe corresponder a la moneda seleccionada.');
  let region;
  try { const {version: _version, confirmed_currency: _confirmed, ...value} = input; region = validateRegionalInput(value); }
  catch (error) { throw badRequest(error.message); }
  const d = { ...dfl, ...injected };
  await d.transaction(async client => {
    const business = (await client.query('SELECT program_json FROM businesses WHERE id=$1 FOR NO KEY UPDATE', [businessId])).rows[0];
    if (!business) throw notFound('Negocio no encontrado.');
    if (version(business) !== input.version) throw conflict('La configuración cambió. Actualiza antes de guardar.');
    if (businessRegion(business).currency !== region.currency) {
      const activity = (await client.query('SELECT (EXISTS(SELECT 1 FROM transactions WHERE business_id=$1) OR EXISTS(SELECT 1 FROM reward_unit_costs WHERE business_id=$1) OR EXISTS(SELECT 1 FROM hospitality_grants WHERE business_id=$1) OR EXISTS(SELECT 1 FROM hospitality_entitlements WHERE business_id=$1) OR EXISTS(SELECT 1 FROM gift_cards WHERE business_id=$1) OR EXISTS(SELECT 1 FROM growth_campaigns WHERE business_id=$1) OR EXISTS(SELECT 1 FROM pos_refund_receipts WHERE business_id=$1) OR EXISTS(SELECT 1 FROM reward_economics_settings WHERE business_id=$1)) AS present', [businessId])).rows[0]?.present;
      // Prices configured before a first sale also carry a currency; refuse to relabel them.
      if (activity) throw conflict('La moneda ya tiene movimientos o costos configurados. No se pueden convertir ni cambiar sus importes históricos.');
    }
    const program = {...business.program_json,region};
    if (businessRegion(business).currency !== region.currency) delete program.currency_confirmation;
    if (input.confirmed_currency === region.currency) program.currency_confirmation = {currency:region.currency,confirmed_at:new Date().toISOString(),staff_id:staffId};
    await client.query("UPDATE businesses SET program_json=$2::jsonb WHERE id=$1", [businessId, JSON.stringify(program)]);
    await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'STAFF',$3,'merchant.region.changed',$4)", [randomUUID(), businessId, staffId, JSON.stringify(withImpersonationMeta({before:businessRegion(business),after:region,currency_confirmed:input.confirmed_currency===region.currency},{impersonated_by}))]);
  });
  return getMerchantRegion({businessId}, d);
}
