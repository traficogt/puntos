export const RETRYABLE_JOB_TYPES=['customer.import','growth.campaign.prepare'];
export const canRetryJob=job=>RETRYABLE_JOB_TYPES.includes(job.job_type)&&Number(job.attempts)<5;
export const jobRetrySeconds=attempt=>Math.min(900,30*2**Math.max(0,Number(attempt)-1));
// Both domain updates consume only rows changed by the fenced queue update.
// One statement is atomic even when the caller is an autocommit pool/client.
const terminalDomainUpdates=`failed_imports AS (
 UPDATE customer_import_jobs d SET status='failed',last_error='No se completó el procesamiento después de cinco intentos. Puedes reintentar el archivo vigente.',updated_at=now()
 FROM changed_jobs j WHERE j.status='FAILED' AND j.job_type='customer.import' AND d.business_id=j.business_id
 AND d.id::text=j.payload->>'importJobId' AND d.status IN ('queued','running') RETURNING d.id
), failed_campaigns AS (
 UPDATE growth_campaigns d SET preparation_status='failed' FROM changed_jobs j
 WHERE j.status='FAILED' AND j.job_type='growth.campaign.prepare' AND d.business_id=j.business_id
 AND d.id::text=j.payload->>'campaignId' AND d.preparation_status IN ('queued','preparing') RETURNING d.id
)`;
export async function recoverJobLeases(client){
 const result=await client.query(`WITH changed_jobs AS (
 UPDATE background_jobs SET status=CASE WHEN attempts<5 THEN 'QUEUED' ELSE 'FAILED' END,
  run_after=now(),locked_at=NULL,error='worker_lease_expired',completed_at=CASE WHEN attempts>=5 THEN now() ELSE NULL END
  WHERE job_type=ANY($1::text[]) AND status='RUNNING' AND locked_at<now()-interval '15 minutes' RETURNING *
 ), ${terminalDomainUpdates} SELECT * FROM changed_jobs`,[RETRYABLE_JOB_TYPES]);
 await client.query("UPDATE customer_import_jobs SET rows_json='[]'::jsonb,status=CASE WHEN status IN ('queued','running') THEN 'failed' ELSE status END,last_error=CASE WHEN status IN ('queued','running') THEN 'El archivo venció después de siete días.' ELSE last_error END WHERE expires_at<now() AND rows_json<>'[]'::jsonb");
 return result.rowCount;
}
export async function heartbeatJob(client,job){return client.query("UPDATE background_jobs SET locked_at=now() WHERE id=$1 AND status='RUNNING' AND attempts=$2",[job.id,job.attempts]);}
export async function completeClaimedJob(client,job,result){return client.query("UPDATE background_jobs SET status='DONE',result=$2,completed_at=now(),error=NULL,locked_at=NULL WHERE id=$1 AND status='RUNNING' AND attempts=$3",[job.id,result??{},job.attempts]);}
export async function failClaimedJob(client,job){
 const retry=canRetryJob(job);
 return client.query(`WITH changed_jobs AS (
 UPDATE background_jobs SET status=$2,error='processing_failed',locked_at=NULL,
 run_after=now()+($3::int*interval '1 second'),completed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END
 WHERE id=$1 AND status='RUNNING' AND attempts=$4 RETURNING *
 ), ${terminalDomainUpdates} SELECT id FROM changed_jobs`,[job.id,retry?'QUEUED':'FAILED',jobRetrySeconds(job.attempts),job.attempts]);
}
