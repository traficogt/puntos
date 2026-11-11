// Shared by offer selection, customer display and first-purchase discovery.
// Imported balances, adjustments, refund rows and reversed receipts are excluded.
export const genuinePurchase = alias => `${alias}.source IN ('online','offline','external','order') AND (${alias}.type='PURCHASE' OR ${alias}.type IS NULL)
 AND ${alias}.status IN ('POSTED','PENDING') AND (${alias}.amount_q>0 OR ${alias}.visits>0 OR ${alias}.items>0)
 AND ${alias}.original_transaction_id IS NULL AND ${alias}.reversed_transaction_id IS NULL`;
// to_jsonb preserves compatibility with older minimal fixtures. Production's
// audience_snapshot is the immutable source receipt identity, never user SQL.
export const secondVisitOfferEligible = `(to_jsonb(g)->'audience_snapshot'->>'automation' IS DISTINCT FROM 'second_visit' OR (
 EXISTS(SELECT 1 FROM transactions first_purchase WHERE first_purchase.business_id=g.business_id
   AND first_purchase.customer_id=$2::uuid AND first_purchase.id::text=to_jsonb(g)->'audience_snapshot'->>'first_transaction_id'
   AND first_purchase.status='POSTED' AND ${genuinePurchase('first_purchase')})
 AND NOT EXISTS(SELECT 1 FROM transactions later_purchase WHERE later_purchase.business_id=g.business_id
   AND later_purchase.customer_id=$2::uuid AND later_purchase.id::text<>to_jsonb(g)->'audience_snapshot'->>'first_transaction_id'
   AND ${genuinePurchase('later_purchase')})
))`;

export async function secondVisitMessageAllowed(client,{business,campaign,customerId,now=new Date()}) {
 if(campaign?.audience_snapshot?.automation!=='second_visit')return true;
 if(business?.program_json?.second_visit?.settings?.enabled!==true)return false;
 const {readinessForBusiness}=await import('./merchant-data-readiness.js');
 if(!readinessForBusiness(business,now).inactivity_allowed)return false;
 const rows=(await client.query(`SELECT id,status FROM transactions t WHERE business_id=$1 AND customer_id=$2 AND ${genuinePurchase('t')} ORDER BY created_at,id`,[campaign.business_id??business.id,customerId])).rows;
 return rows.length===1&&rows[0].id===campaign.audience_snapshot.first_transaction_id&&rows[0].status==='POSTED';
}
