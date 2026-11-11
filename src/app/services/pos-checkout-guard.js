import {conflict} from '../../utils/http-error.js';
export async function assertNoPendingCheckout(client,{business,customerId}){
 if(business?.program_json?.pos_checkout_enabled!==true)return;
 const pending=await client.query("SELECT id FROM pos_checkout_intents WHERE business_id=$1 AND customer_id=$2 AND status='authorized' LIMIT 1",[business.id,customerId]);
 if(pending.rowCount)throw conflict('Hay un canje pendiente en una caja. Confirma o cancela ese carrito antes de otro canje.');
}

// Call only after locking the original debit. Receipt/cancel writers share that
// lock, so a concurrent confirmation cannot be missed or credited twice here.
export async function assertCheckoutCorrectionAllowed(client,{businessId,redemptionId}){
 const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1 FOR SHARE',[businessId])).rows[0];
 if(business?.program_json?.pos_checkout_enabled!==true)return;
 const pending=await client.query("SELECT id FROM pos_checkout_intents WHERE business_id=$1 AND redemption_id=$2 AND status='authorized'",[businessId,redemptionId]);
 if(pending.rowCount)throw conflict('Este canje sigue pendiente en caja. Cancela el carrito o confirma su recibo antes de restituir puntos.');
}
