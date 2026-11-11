import {normalizeCustomerMigration,summarizeCustomerMigration} from '../../../src/app/services/customer-migration-csv.js';
const jobs=[],requests=new Map();
export function demoImportJobs(url,options={}){
 const suffix=url.pathname.replace('/api/admin/customer-import-jobs',''),body=options.body?JSON.parse(options.body):{},method=options.method||'GET';
 if(!suffix&&method==='GET')return{jobs:structuredClone(jobs)};
 const preview=()=>summarizeCustomerMigration(normalizeCustomerMigration({...body,limits:{rows:5000,bytes:750*1024}}),[],body.existing_policy);
 if(suffix==='/preview')return preview();
 if(!suffix&&method==='POST'){
  if(requests.has(body.request_id)){const old=requests.get(body.request_id);if(old.signature!==JSON.stringify(body))throw new Error('Este identificador ya corresponde a otro archivo.');return{job:old.job};}
  const out=preview();if(!body.confirmed||!body.request_id||!out.can_commit)throw new Error('Revisa y confirma el archivo.');
  const job={id:crypto.randomUUID(),label:body.label,status:'queued',total:out.rows.length,processed:0,imported:0,skipped:0,opening_points:0,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+7*86400000).toISOString()};
  jobs.unshift(job);requests.set(body.request_id,{signature:JSON.stringify(body),job});
  setTimeout(()=>{if(job.status==='queued')Object.assign(job,{status:'completed',processed:job.total,imported:job.total,opening_points:out.summary.opening_points});},1200);
  return{job};
 }
 const [id,action]=suffix.slice(1).split('/');const job=jobs.find(x=>x.id===id);if(!job)throw new Error('Importación no encontrada.');
 if(action==='cancel'&&!['completed','cancelled'].includes(job.status))job.status='cancelled';return{job};
}
