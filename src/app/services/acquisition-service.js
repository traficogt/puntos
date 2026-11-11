import crypto from 'node:crypto';
import { z } from 'zod';
import { dbQuery, withDbClientContext, withTransaction } from '../database.js';
import { badRequest } from '../../utils/http-error.js';
import { reportingPurchase } from './reporting-purchase.js';

import { sourceCodePattern, acquisitionSourceUrl } from "./acquisition-link.js";
export { sourceCodePattern, acquisitionSourceUrl };
const visitTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const sourceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  branch_id: z.guid().nullable().optional(),
  request_id: z.guid(),
}).strict();

export const acquisitionDefinitions = {
  period: 'Acumulado desde la creación de cada origen.',
  visits: 'Aperturas del enlace registradas; no son escaneos ni personas únicas. Recargas y visitas automatizadas pueden contar.',
  registrations: 'Clientes nuevos con teléfono verificado y un enlace visitado en los 30 minutos anteriores. Se conserva el primer origen; los accesos de clientes existentes no cuentan.',
  purchases: 'Clientes atribuidos con al menos una compra registrada; recurrentes con dos o más. Incluye compras con puntos contabilizados, pendientes o vencidos; excluye compras anuladas y movimientos de bono.',
  sales: 'Importes registrados de clientes atribuidos desde su inscripción, en la moneda del negocio. Son ventas observadas, no ingresos causados por el QR ni ganancia. Devoluciones parciales o pendientes de conciliación pueden seguir incluidas.',
  deletion: 'Las altas históricas se conservan sin datos personales. Compradores y ventas excluyen clientes eliminados; estos totales pueden bajar.',
};

export function createAcquisitionService({ query = dbQuery, transaction = withTransaction, context = withDbClientContext } = {}) {
  const scoped = (businessId, fn) => context({tenantId:businessId,platformAdmin:false},fn);
  async function getSource(businessId, sourceId) {
    return scoped(businessId, async () => (await query('SELECT id,business_id,code,name,branch_id,created_at FROM acquisition_sources WHERE business_id=$1 AND id=$2',[businessId,sourceId])).rows[0] ?? null);
  }
  async function listSources(business, appOrigin) {
    return scoped(business.id,async()=>{
      const sources=(await query(`SELECT s.id,s.business_id,s.name,s.code,s.branch_id,s.created_at,b.name AS branch_name
        FROM acquisition_sources s LEFT JOIN branches b ON b.business_id=s.business_id AND b.id=s.branch_id
        WHERE s.business_id=$1 ORDER BY s.created_at DESC,s.id LIMIT 100`,[business.id])).rows;
      const branches=(await query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name,id LIMIT 100',[business.id])).rows;
      return {ok:true,sources:sources.map(s=>({...s,registration_url:acquisitionSourceUrl(business,appOrigin,s)})),branches,limit:100};
    });
  }
  async function createSource(business, input) {
    const parsed=sourceInputSchema.safeParse(input);
    if(!parsed.success) throw badRequest('Revisa el nombre, la sucursal y el identificador de la solicitud.');
    const data=parsed.data;
    return scoped(business.id,()=>transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('acquisition-sources'))",[business.id]);
      const previous=(await client.query('SELECT id,business_id,name,code,branch_id,created_at FROM acquisition_sources WHERE business_id=$1 AND request_id=$2',[business.id,data.request_id])).rows[0];
      if(previous){
        if(previous.name!==data.name || previous.branch_id!==(data.branch_id??null)) throw badRequest('Esta solicitud ya creó un origen distinto.');
        return previous;
      }
      if(data.branch_id && !(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[business.id,data.branch_id])).rowCount) throw badRequest('La sucursal no pertenece a este negocio.');
      if(Number((await client.query('SELECT count(*) AS n FROM acquisition_sources WHERE business_id=$1',[business.id])).rows[0].n)>=100) throw badRequest('Puedes tener hasta 100 orígenes por negocio.');
      return (await client.query(`INSERT INTO acquisition_sources(id,business_id,request_id,code,name,branch_id) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id,business_id,name,code,branch_id,created_at`,[crypto.randomUUID(),business.id,data.request_id,crypto.randomBytes(12).toString('base64url'),data.name,data.branch_id??null])).rows[0];
    }));
  }
  async function visit(business, code) {
    if(!sourceCodePattern.test(code??'')) return {ok:true,visit_token:null};
    return scoped(business.id,()=>transaction(async client=>{
      const source=(await client.query('SELECT id FROM acquisition_sources WHERE business_id=$1 AND code=$2',[business.id,code])).rows[0];
      if(!source) return {ok:true,visit_token:null};
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('acquisition-visits'))",[business.id]);
      await client.query('DELETE FROM acquisition_visits WHERE business_id=$1 AND expires_at<=now()',[business.id]);
      // Bound unconsumed capabilities per tenant. Lifetime visit counts remain independent.
      await client.query('UPDATE acquisition_sources SET visits=visits+1 WHERE business_id=$1 AND id=$2',[business.id,source.id]);
      if(Number((await client.query('SELECT count(*) AS n FROM acquisition_visits WHERE business_id=$1',[business.id])).rows[0].n)>=10000) return {ok:true,visit_token:null};
      const token=crypto.randomBytes(32).toString('base64url');
      await client.query('INSERT INTO acquisition_visits(token_hash,business_id,source_id) VALUES ($1,$2,$3)',[crypto.createHash('sha256').update(token).digest('hex'),business.id,source.id]);
      return {ok:true,visit_token:token,expires_in:1800};
    }));
  }
  // Call only inside the same transaction that verified the phone and created the customer.
  async function attributeVerified(client,{businessId,customerId,visitToken,isNewCustomer}) {
    if(typeof visitToken!=='string' || !visitTokenPattern.test(visitToken)) return false;
    const visit=(await client.query('DELETE FROM acquisition_visits WHERE business_id=$1 AND token_hash=$2 AND expires_at>now() RETURNING source_id',[businessId,crypto.createHash('sha256').update(visitToken).digest('hex')])).rows[0];
    if(!visit || !isNewCustomer) return false;
    const out=await client.query(`INSERT INTO acquisition_attributions(id,business_id,source_id,customer_id)
      SELECT $1,$2,$3,c.id FROM customers c WHERE c.business_id=$2 AND c.id=$4 AND c.deleted_at IS NULL
      ON CONFLICT(business_id,customer_id) DO NOTHING RETURNING id`,[crypto.randomUUID(),businessId,visit.source_id,customerId]);
    return out.rowCount===1;
  }
  async function report(business, appOrigin) {
    return scoped(business.id,async()=>{
      const result=await listSources(business,appOrigin);
      const metrics=(await query(`SELECT s.id,s.visits,
        count(a.id)::int AS registrations,count(c.id)::int AS active_customers,
        count(c.id) FILTER(WHERE p.n>=1)::int AS first_purchasers,
        count(c.id) FILTER(WHERE p.n>=2)::int AS repeat_purchasers,
        coalesce(sum(p.amount),0)::numeric AS recorded_sales_q
        FROM acquisition_sources s
        LEFT JOIN acquisition_attributions a ON a.business_id=s.business_id AND a.source_id=s.id
        LEFT JOIN customers c ON c.business_id=a.business_id AND c.id=a.customer_id AND c.deleted_at IS NULL
        LEFT JOIN LATERAL (SELECT count(*) AS n,sum(t.amount_q) AS amount FROM transactions t
          WHERE t.business_id=s.business_id AND t.customer_id=c.id AND t.created_at>=a.created_at
          AND ${reportingPurchase('t')}) p ON c.id IS NOT NULL
        WHERE s.business_id=$1 GROUP BY s.id ORDER BY s.created_at DESC,s.id LIMIT 100`,[business.id])).rows;
      const byId=new Map(metrics.map(m=>[m.id,{...m,visits:Number(m.visits),recorded_sales_q:Number(m.recorded_sales_q)}]));
      return {...result,definitions:acquisitionDefinitions,sources:result.sources.map(s=>({...s,...byId.get(s.id)}))};
    });
  }
  return {createSource,getSource,listSources,visit,attributeVerified,report};
}
export const AcquisitionService=createAcquisitionService();
