import crypto from 'node:crypto';
import { dbQuery, withTransaction, withDbClientContext } from '../database.js';
import { notFound } from '../../utils/http-error.js';
import { config } from '../../config/index.js';

export const validUnsubscribeToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
export const unsubscribeTokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

export async function getMarketingPreference({businessId, customerId}) {
  const {rows} = await dbQuery(`SELECT b.name AS business_name, COALESCE(p.marketing_opt_in,false) AS marketing_opt_in
    FROM customers c JOIN businesses b ON b.id=c.business_id
    LEFT JOIN customer_marketing_preferences p ON p.business_id=c.business_id AND p.customer_id=c.id
    WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`, [businessId,customerId]);
  if (!rows[0]) throw notFound('Cliente no encontrado.');
  return {ok:true,...rows[0]};
}

export async function setMarketingPreference({businessId, customerId, marketing_opt_in}) {
  return withTransaction(async client => {
    const {rows} = await client.query(`SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,[businessId,customerId]);
    if (!rows[0]) throw notFound('Cliente no encontrado.');
    await client.query(`INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in)
      VALUES($1,$2,$3) ON CONFLICT(business_id,customer_id) DO UPDATE SET marketing_opt_in=$3,updated_at=now()`,[businessId,customerId,marketing_opt_in]);
    if (!marketing_opt_in) await client.query(`UPDATE growth_message_outbox SET status='suppressed',reason='consent_revoked',updated_at=now()
      WHERE business_id=$1 AND customer_id=$2 AND status IN ('queued','failed')`,[businessId,customerId]);
    if (!marketing_opt_in) await client.query(`UPDATE lifecycle_message_outbox SET status='suppressed',reason='consent_revoked',updated_at=now() WHERE business_id=$1 AND customer_id=$2 AND status IN ('queued','failed')`,[businessId,customerId]);
    return getMarketingPreference({businessId,customerId});
  });
}

export async function issueMarketingUnsubscribeUrl({businessId,customerId}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await dbQuery(`INSERT INTO marketing_unsubscribe_tokens(token_hash,business_id,customer_id) VALUES($1,$2,$3)`,[unsubscribeTokenHash(token),businessId,customerId]);
  const url = new URL('/preferencias-de-mensajes/',config.APP_ORIGIN);
  url.searchParams.set('token',token);
  return url.toString();
}

export async function tokenMarketingPreference({token,confirm=false}) {
  if (!validUnsubscribeToken(token)) throw notFound('Este enlace no está disponible.');
  // Only the hashed capability can select an anonymous record. No identifiers or contact fields leave this service.
  return withDbClientContext({platformAdmin:true,tenantId:null},async () => {
    const {rows} = await dbQuery(`SELECT t.business_id,t.customer_id FROM marketing_unsubscribe_tokens t
      JOIN customers c ON c.business_id=t.business_id AND c.id=t.customer_id AND c.deleted_at IS NULL
      WHERE t.token_hash=$1`,[unsubscribeTokenHash(token)]);
    if (!rows[0]) throw notFound('Este enlace no está disponible.');
    const {business_id:businessId,customer_id:customerId}=rows[0];
    return withDbClientContext({platformAdmin:false,tenantId:businessId},()=> confirm
      ? setMarketingPreference({businessId,customerId,marketing_opt_in:false})
      : getMarketingPreference({businessId,customerId}));
  });
}
