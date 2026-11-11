import {useEffect,useState} from 'react';
import {Alert,Badge,Button,Group,Progress,Stack,Text,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
import {regionalDate} from './region.js';
const base='/api/admin/customer-import-jobs';
const labels={queued:'En espera',running:'Importando',completed:'Completada',cancelled:'Cancelada',failed:'Requiere revisión'};
export default function ImportJobs({revision=0}){
 const [tick,setTick]=useState(0),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const resource=useResource(base,`${revision}:${tick}`);
 useEffect(()=>{if(!resource.data?.jobs.some(job=>['queued','running'].includes(job.status)))return;const timer=setTimeout(()=>setTick(v=>v+1),5000);return()=>clearTimeout(timer);},[resource.data]);
 async function action(job,kind){if(kind==='cancel'&&!confirm(`Se conservarán los ${job.processed} clientes ya procesados. ¿Detener los siguientes lotes?`))return;setBusy(job.id);setError('');try{await api(`${base}/${job.id}/${kind}`,{method:'POST',body:'{}'});setTick(v=>v+1);}catch(e){setError(e.message);}finally{setBusy('');}}
 return <section aria-labelledby="import-jobs-title"><Group justify="space-between" mb="md"><Title id="import-jobs-title" order={2}>Importaciones en segundo plano</Title><Button variant="subtle" onClick={()=>setTick(v=>v+1)}>Actualizar estado</Button></Group>
 {error&&<Alert color="red" role="alert" mb="md">{error}</Alert>}
 {resource.loading&&!resource.data?<Loading/>:resource.error?<Failure error={resource.error} retry={()=>setTick(v=>v+1)}/>:!resource.data?.jobs.length?<Text c="dimmed">Todavía no has encolado un archivo grande.</Text>:<Stack gap="lg">{resource.data.jobs.map(job=><div key={job.id}><Group justify="space-between"><Text fw={600}>{job.label}</Text><Badge>{labels[job.status]}</Badge></Group><Text size="sm" c="dimmed">{regionalDate(job.created_at)}</Text><Progress my="sm" value={100*job.processed/job.total} aria-label={`${job.processed} de ${job.total} clientes procesados`}/><Text size="sm">{number(job.processed)} de {number(job.total)} filas procesadas · {number(job.imported)} clientes creados · {number(job.skipped)} existentes omitidos · {number(job.opening_points)} puntos iniciales</Text>{job.last_error&&<Text c="red" size="sm" mt="xs">{job.last_error}</Text>}<Group mt="sm">{['queued','running'].includes(job.status)&&<Button size="xs" variant="outline" color="red" disabled={Boolean(busy)} loading={busy===job.id} onClick={()=>action(job,'cancel')}>Detener siguientes lotes</Button>}{job.status==='failed'&&new Date(job.expires_at)>new Date()&&<Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={()=>action(job,'retry')}>Reintentar pendientes</Button>}</Group></div>)}</Stack>}
 </section>;
}
