import {useState} from 'react';
import {Accordion,Alert,Anchor,Button,Group,List,Stack,Text,Textarea,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
import {merchantRegion} from './region.js';
const date=v=>v?new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'short',timeStyle:'short',timeZone:merchantRegion().timezone}).format(new Date(v)):'Sin registrar';
export function HistoricalReplay({replay,history}){
 if(!replay&&!history)return null;
 return <Accordion><Accordion.Item value="saved-history"><Accordion.Control>Repetir el cálculo y revisar la secuencia guardada</Accordion.Control><Accordion.Panel><Stack gap="md">
  {replay&&<Alert color={replay.status==='matched'?'green':replay.status==='mismatch'?'orange':'gray'} title={replay.status==='matched'?'El cálculo coincide':replay.status==='mismatch'?'Diferencia en la evidencia':'Repetición no disponible'}><Text size="sm">{replay.summary}</Text>{replay.calculated_points!=null&&<Text size="sm">Recalculados: {number(replay.calculated_points)}. Registrados: {number(replay.recorded_points)}. Diferencia: {number(replay.difference)}.</Text>}<Text size="sm" mt="xs">Esta comprobación no cambia puntos ni emite recompensas.</Text></Alert>}
  {replay?.limitations?.map(line=><Text key={line} size="sm">{line}</Text>)}
  {history?.events?.length>0&&<List spacing="sm">{history.events.map(e=><List.Item key={e.id}>{date(e.created_at)}: {e.previous_status?`${e.previous_status} → `:''}{e.status}; {number(e.points)} puntos. Origen guardado: {e.source}.</List.Item>)}</List>}
  {history?.redemptions?.map(e=><div key={e.id}><Text fw={600}>{date(e.created_at)} · {e.previous_status?`${e.previous_status} → `:''}{e.recorded_status}</Text><Text size="sm">Costo registrado: {number(e.points_cost)} puntos. Recompensa observada: {e.rule_snapshot.name??'Sin nombre guardado'}. Vigencia configurada en ese evento: {date(e.rule_snapshot.valid_until)}.</Text><Text size="sm" c="dimmed">La configuración observada puede diferir de una promesa anterior; el costo debitado es el registrado en el canje.</Text></div>)}
  {history?.promise&&<Alert color="gray" title="Promesa que se cumplió"><Text size="sm">Prometida: {history.promise.promised_reward_name??'Cortesía autorizada'}. Entregada: {history.promise.fulfilled_reward_name}. Aceptación registrada: {history.promise.customer_accepted?'Sí':'No'}.</Text>{history.promise.promised_points_cost!=null&&<Text size="sm">Costo de la promesa: {number(history.promise.promised_points_cost)} puntos.</Text>}</Alert>}
  {history?.cases?.map(c=><div key={c.id}><Text size="sm">{date(c.created_at)} · {c.reason}</Text><Text size="sm">{c.status==='resolved'?'Resuelto':'Pendiente'}{c.resolution?` · ${c.resolution}`:''}</Text></div>)}
  {history&&<Text size="sm" c="dimmed">{history.note}</Text>}
 </Stack></Accordion.Panel></Accordion.Item></Accordion>;
}
export function RejectedAttempts(){
 const [version,setVersion]=useState(0),r=useResource('/api/admin/transaction-rejections',version);
 return <Accordion><Accordion.Item value="rejections"><Accordion.Control>Explicar intentos de canje rechazados</Accordion.Control><Accordion.Panel>{r.loading?<Loading label="Consultando intentos…"/>:r.error?<Failure error={r.error} retry={()=>setVersion(v=>v+1)}/>:<Stack gap="md"><Text size="sm">{r.data.note}</Text>{r.data.attempts.length?r.data.attempts.map(a=><div key={a.id}><Text fw={600}>{a.customer_name??'Cliente'} · {a.reward_name??'Recompensa'}</Text><Text size="sm">{date(a.created_at)} · {a.reason}</Text><Text size="sm" c="dimmed">{a.status==='resolved'?'Caso resuelto':'Pendiente de resolución'}</Text></div>):<Text>No hay intentos rechazados con un caso registrado.</Text>}<Anchor href="#casos">Abrir Atención al cliente</Anchor></Stack>}</Accordion.Panel></Accordion.Item></Accordion>;
}
export function SafeCorrections({customerId}){
 const [open,setOpen]=useState(false),[version,setVersion]=useState(0),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null),[message,setMessage]=useState('');
 const r=useResource(open?'/api/admin/analytics/ledger-corrections?limit=50':null,version);
 async function act(path,body){setBusy(true);setError(null);setMessage('');try{await api(path,{method:'POST',body:JSON.stringify(body)});setMessage('Solicitud registrada. El historial original se conserva.');setReason('');setVersion(v=>v+1);}catch(e){setError(e);}finally{setBusy(false);}}
 return <section className="operation-section"><Button variant="outline" onClick={()=>setOpen(v=>!v)}>{open?'Cerrar correcciones':'Revisar una corrección de saldo'}</Button>{open&&<Stack gap="md" mt="md">
  <Title order={3}>Corregir con evidencia</Title><Text size="sm" maw="72ch">PF compara el saldo con el historial. Si hay una diferencia, registra una propuesta y otro propietario debe aprobarla. La corrección agrega un ajuste; no cambia compras anteriores ni permite inventar puntos.</Text>
  <Textarea label="Motivo y referencia para revisar" value={reason} onChange={e=>setReason(e.currentTarget.value)} minRows={2} maxLength={500}/>
  <Button w="fit-content" loading={busy} disabled={reason.trim().length<8} onClick={()=>act('/api/admin/analytics/ledger-corrections',{customerId,reason:reason.trim()})}>Comparar saldo y solicitar corrección</Button>
  {error&&<Alert color="red" title="No se pudo registrar la corrección">{error.message}</Alert>}{message&&<Text role="status">{message}</Text>}
  {r.loading?<Loading label="Cargando solicitudes…"/>:r.error?<Failure error={r.error} retry={()=>setVersion(v=>v+1)}/>:r.data?.corrections?.filter(c=>c.customer_id===customerId).map(c=><div key={c.id}><Text fw={600}>{c.status} · {c.reason}</Text>{c.status==='PENDING'&&<Group mt="sm"><Button variant="outline" disabled={busy} onClick={()=>act(`/api/admin/analytics/ledger-corrections/${c.id}/apply`,{})}>Aprobar como otro propietario</Button></Group>}</div>)}
 </Stack>}</section>;
}
