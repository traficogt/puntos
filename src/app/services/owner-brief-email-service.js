import {createSmtpProvider} from './messaging/providers/smtp-provider.js';
import {config} from '../../config/index.js';
export const ownerBriefEmailReady=()=>Boolean(config.SMTP_HOST&&config.SMTP_FROM);
// Dedicated SMTP delivery avoids simulated acceptance and phone-provider fallbacks.
export async function sendOwnerBriefEmail({to,body,subject='PuntosFieles · Tu resumen semanal'},injected={}){
 const provider=injected.provider??createSmtpProvider({config});
 if(!provider.canSend({destinations:{email:to,phone:null}}))return{ok:false,definiteFailure:true,error:'NO_DELIVERY_PROVIDER'};
 try{const result=await provider.send({destinations:{email:to,phone:null},body,subject,strictAcceptance:true});return{...result,accepted:true,provider:'smtp_email'};}
 catch(error){return{ok:false,definiteFailure:error?.deliveryUncertain===false,error:'DELIVERY_UNCERTAIN'};}
}
