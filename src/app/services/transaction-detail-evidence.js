import {dbQuery} from '../database.js';

// Read only. Explicit column selection keeps credentials and arbitrary metadata
// out of the support surface. All joins repeat the tenant boundary.
export async function transactionDetailEvidence(businessId,movement,query=dbQuery){
 const events=movement.record==='transaction'?(await query(`SELECT id,event_type,created_at,
 previous_state->>'status' AS previous_status,recorded_state->>'status' AS status,
 (recorded_state->>'points')::int AS points,recorded_state->>'source' AS source
 FROM transaction_evidence_events WHERE business_id=$1 AND transaction_id=$2 ORDER BY created_at,id LIMIT 100`,[businessId,movement.id])).rows:[];
 const redemptionId=movement.redemption?.id;
 const redemptions=redemptionId?(await query(`SELECT id,created_at,previous_status,recorded_status,points_cost,branch_id,staff_user_id,
 jsonb_build_object('reward_id',rule_snapshot->'reward_id','name',rule_snapshot->'name','active',rule_snapshot->'active',
 'configured_points_cost',rule_snapshot->'configured_points_cost','valid_until',rule_snapshot->'valid_until','branch_ids',rule_snapshot->'branch_ids','evidence',rule_snapshot->'evidence') AS rule_snapshot
 FROM redemption_evidence_events WHERE business_id=$1 AND redemption_id=$2 ORDER BY created_at,id LIMIT 100`,[businessId,redemptionId])).rows:[];
 const promise=redemptionId?(await query(`SELECT f.promise_id,f.hospitality_id,f.fulfilled_reward_name,f.customer_accepted,f.created_at,
 p.reward_name AS promised_reward_name,p.points_cost AS promised_points_cost,p.valid_until AS original_valid_until,
 c.program_type,c.earning_terms,c.observed_at AS terms_recorded_at
 FROM reward_entitlement_fulfillments f LEFT JOIN customer_reward_promises p ON p.business_id=f.business_id AND p.id=f.promise_id
 LEFT JOIN reward_promise_cycles c ON c.business_id=p.business_id AND c.id=p.cycle_id
 WHERE f.business_id=$1 AND f.redemption_id=$2 LIMIT 1`,[businessId,redemptionId])).rows[0]??null:null;
 const cases=redemptionId?(await query(`SELECT id,status,reason,resolution,created_at,resolved_at FROM service_cases WHERE business_id=$1 AND redemption_id=$2 ORDER BY created_at,id LIMIT 50`,[businessId,redemptionId])).rows:[];
 return {events,redemptions,promise,cases,
  note:'La secuencia contiene eventos guardados desde la activación del registro. Una configuración observada no demuestra entrega física ni reconstruye un saldo anterior.'};
}
