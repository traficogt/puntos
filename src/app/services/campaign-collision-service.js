import {occupiedOperatingCapacity} from './operating-capacity-service.js';
import {z} from 'zod';
import {withTransaction} from '../database.js';
import {badRequest,notFound} from '../../utils/http-error.js';
import {computePointsWithEvidence} from './points-service.js';
import {businessRegion,assertRegionAmount} from './regional-settings.js';
import {operatingMode} from './merchant-decisions-model.js';
import {evaluateCampaignPreflight} from './campaign-preflight-service.js';
export const CollisionSampleInput=z.object({amount_q:z.number().finite().min(0).max(999999.99),visits:z.number().int().min(1).max(1000).default(1),items:z.number().int().min(1).max(10000).default(1),branch_id:z.guid().nullable().default(null),reward_id:z.guid().nullable().default(null),tier_id:z.guid().nullable().default(null)}).strict();
export function collisionSample({business,input,campaigns,now=new Date()}){
 const evaluated=computePointsWithEvidence(business,input,{now}),guard=Number(business.program_json?.award_guard?.max_points_per_tx??0);
 const candidates=campaigns.filter(c=>Number(c.minimum_purchase_q)<=input.amount_q).map(c=>({campaign_id:c.id,name:c.name,bonus_points:c.bonus_points,total_points:evaluated.points+c.bonus_points}));
 const supported=candidates.filter(c=>!guard||c.total_points<=guard);
 return {inputs:input,program_points:evaluated.points,rule_evidence:evaluated.evidence,combinations:candidates,rejected_combinations:candidates.filter(c=>guard&&c.total_points>guard),
  most_generous_supported_total:Math.max(...supported.map(c=>c.total_points),guard&&evaluated.points>guard?0:evaluated.points),maximum_candidate_total:Math.max(evaluated.points,...candidates.map(c=>c.total_points)),hard_guard:guard||null,
  external_discounts:'unknown',tier_awards:'not_applied_by_purchase_writer',targeted_offers_per_purchase:1,priority:'earliest_expiry_then_id'};
}
export async function previewCampaignCollisions({businessId,campaignId,input},injected={}){
 const parsed=CollisionSampleInput.safeParse(input);if(!parsed.success)throw badRequest('Revisa la compra y las opciones del ejemplo.');
 return (injected.transaction??withTransaction)(async client=>{
  const business=(await client.query('SELECT * FROM businesses WHERE id=$1',[businessId])).rows[0];if(!business)throw notFound('Negocio no encontrado.');
  const campaign=(await client.query('SELECT * FROM growth_campaigns WHERE business_id=$1 AND id=$2',[businessId,campaignId])).rows[0];if(!campaign)throw notFound('Oferta no encontrada.');
  const now=new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at),region=businessRegion(business);assertRegionAmount(parsed.data.amount_q,region.currency,business);
  const branches=(await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name LIMIT 200',[businessId])).rows;
  const tiers=(await client.query('SELECT id,name,points_multiplier,perks FROM loyalty_tiers WHERE business_id=$1 AND active ORDER BY tier_level LIMIT 100',[businessId])).rows;
  const rewards=(await client.query(`SELECT r.id,r.name,r.points_cost,r.active,r.stock,r.valid_until,COALESCE(a.available,true) AS available,
    ARRAY(SELECT rb.branch_id FROM reward_branches rb WHERE rb.reward_id=r.id) AS branch_ids
    FROM rewards r LEFT JOIN reward_availability a ON a.business_id=r.business_id AND a.reward_id=r.id WHERE r.business_id=$1 ORDER BY r.name LIMIT 200`,[businessId])).rows;
  if(parsed.data.branch_id&&!branches.some(r=>r.id===parsed.data.branch_id)||parsed.data.tier_id&&!tiers.some(r=>r.id===parsed.data.tier_id)||parsed.data.reward_id&&!rewards.some(r=>r.id===parsed.data.reward_id))throw badRequest('Una opción ya no pertenece a la configuración disponible. Actualiza la comprobación.');
  const overlaps=(await client.query(`SELECT g.id,g.name,g.bonus_points,g.minimum_purchase_q,g.expires_at,count(DISTINCT m.customer_id)::int AS shared_customers
   FROM growth_campaigns g JOIN growth_campaign_members m ON m.business_id=g.business_id AND m.campaign_id=g.id AND m.allocation='treatment' AND m.claimed_at IS NULL
   JOIN growth_campaign_members own ON own.business_id=m.business_id AND own.customer_id=m.customer_id AND own.campaign_id=$2
   WHERE g.business_id=$1 AND g.id<>$2 AND g.status='active' AND g.starts_at<=clock_timestamp() AND g.expires_at>clock_timestamp()
   AND (g.points_budget IS NULL OR g.points_committed<=g.points_budget-g.bonus_points) GROUP BY g.id ORDER BY g.expires_at,g.id`,[businessId,campaignId])).rows;
  const queued=(await client.query(`WITH audience AS(SELECT customer_id FROM growth_campaign_members WHERE business_id=$1 AND campaign_id=$2),pending AS(
   SELECT customer_id,'campaign' AS source FROM growth_message_outbox WHERE business_id=$1 AND campaign_id<>$2 AND status IN ('queued','failed','processing')
   UNION ALL SELECT customer_id,'automation' FROM lifecycle_message_outbox WHERE business_id=$1 AND status IN ('queued','failed','processing'))
   SELECT count(*)::int AS pending_contacts,count(DISTINCT p.customer_id)::int AS shared_customers FROM pending p JOIN audience a ON a.customer_id=p.customer_id`,[businessId,campaignId])).rows[0];
  const preflight=(await evaluateCampaignPreflight({businessId,campaign,business,now},client)).report;
  const selected=parsed.data.reward_id?rewards.find(r=>r.id===parsed.data.reward_id):null;
  const issues=[];
  if(selected){if(!selected.active)issues.push('inactive');if(!selected.available)issues.push('unavailable');if(selected.stock!==null&&selected.stock<=0)issues.push('out_of_stock');if(selected.valid_until&&new Date(selected.valid_until)<=now)issues.push('expired');if(selected.branch_ids.length&&(!parsed.data.branch_id||!selected.branch_ids.includes(parsed.data.branch_id)))issues.push(parsed.data.branch_id?'wrong_branch':'select_branch');}
  const sample=collisionSample({business,input:parsed.data,campaigns:[campaign,...overlaps],now}),mode=operatingMode(business,now);
  const maximumUnits=Math.floor(preflight.maximum_commitment_points/campaign.bonus_points),occupied=await occupiedOperatingCapacity(client,businessId,campaign.id);
  return {ok:true,generated_at:now.toISOString(),currency:region.currency,sample,options:{branches,tiers,rewards},overlaps,contacts:{...preflight.contacts,...queued},operating_mode:mode,
   capacity:{configured:mode.capacity,occupied_operational_units:occupied,proposed_units:maximumUnits,exceeds_capacity:mode.capacity!==null&&maximumUnits+occupied>mode.capacity},
   reward_availability:{reward:selected,issues,state:selected?(issues.length?'blocked':'available_now'):'not_selected',inventory_note:'La oferta concede puntos; este ejemplo no reserva existencias ni confirma stock del POS externo.'},
   tier:selectedTier(tiers,parsed.data.tier_id),
   remediation:[...(queued.pending_contacts?[{code:'contacts',message:'Coordina las campañas y automatizaciones con contactos pendientes. La frecuencia y el consentimiento se vuelven a comprobar al enviar.'}]:[]),...(issues.length?[{code:'reward',message:'Selecciona una sucursal habilitada, repón el premio o publica una alternativa aprobada antes de invitar.'}]:[]),...(sample.rejected_combinations.length?[{code:'guard',message:'Reduce el bono o ajusta la oferta: las combinaciones sobre el límite serán rechazadas al registrar la compra.'}]:[]),...(mode.capacity!==null&&maximumUnits+occupied>mode.capacity?[{code:'capacity',message:'Reduce la audiencia o el presupuesto antes de activar. Las plantillas operativas comprueban la capacidad durante la activación.'}]:[])],
   notes:['El máximo compatible compara los bonos disponibles para participantes compartidos; cada compra utiliza solo el bono elegible que vence primero. No garantiza que un cliente reúna todas las condiciones.',
    'La compra del ejemplo usa las reglas y hora actuales. El servidor vuelve a aplicar las reglas, los límites y el presupuesto al registrar una compra.',
    'Los multiplicadores y beneficios descriptivos de niveles no se aplican automáticamente por el registro de compras actual. Se muestran para revisar promesas manuales; no aumentan el total calculado.',
    'Descuentos externos, ventas futuras y valor de beneficios descriptivos: desconocidos.']};
 });
}
function selectedTier(tiers,id){const tier=tiers.find(t=>t.id===id);return tier?{...tier,applied_to_sample:false,descriptive_benefits_value:'unknown'}:null;}
