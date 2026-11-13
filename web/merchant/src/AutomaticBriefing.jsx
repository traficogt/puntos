import {useRef,useState} from 'react';
import {Alert,Button,List,Stack,Text,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
export default function AutomaticBriefing(){
 const [revision,setRevision]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),resource=useResource('/api/admin/service-operations/briefing',revision),acknowledged=useRef(null),row=resource.data?.briefing,payload=row?.payload;
 async function ack(){setBusy(true);setError('');try{await api(`/api/admin/service-operations/briefing/${row.id}/ack`,{method:'POST',body:JSON.stringify({version:row.version})});acknowledged.current=row.id;setRevision(v=>v+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="operation-section"><Stack gap="md"><Title order={2}>Resumen automático del turno</Title><Text>Las ofertas activas, la disponibilidad, los casos pendientes y las reglas generan una nueva versión cuando cambian. Cada lectura es privada para la persona que la confirma.</Text>
  {resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={()=>setRevision(v=>v+1)}/>:row&&<>
   <Text fw={600}>Versión {row.version} · {row.acknowledged||acknowledged.current===row.id?'Lectura confirmada':'Cambios por leer'}</Text>
   <Text>Regla vigente: {number(payload.rules.rate)} puntos {payload.rules.program_type==='VISIT'?'por visita':payload.rules.program_type==='ITEM'?'por artículo':'por unidad monetaria'}.</Text>
   <Title order={3} size="h4">Ofertas activas</Title>{payload.offers.length?<List>{payload.offers.map(o=><List.Item key={o.id}>{o.name} · {number(o.bonus_points)} puntos adicionales</List.Item>)}</List>:<Text size="sm">No hay ofertas activas registradas.</Text>}
   <Title order={3} size="h4">Recompensas no disponibles</Title>{payload.unavailable_rewards.length?<List>{payload.unavailable_rewards.map(r=><List.Item key={r.id}>{r.name}. Alternativas aprobadas: {r.alternatives.map(a=>`${a.name}${a.available?'':' (no disponible)'}`).join(', ')||'ninguna'}.</List.Item>)}</List>:<Text size="sm">No hay recompensas marcadas sin disponibilidad.</Text>}
   <Text>Casos pendientes: {number(payload.cases.reduce((sum,c)=>sum+c.count,0))}. Escalados: {number(payload.cases.reduce((sum,c)=>sum+c.escalated,0))}.</Text>
   {!row.acknowledged&&<Button onClick={ack} loading={busy} w="fit-content">Confirmar lectura de esta versión</Button>}
  </>}{error&&<Alert color="red" role="alert">{error}</Alert>}
 </Stack></section>;
}
