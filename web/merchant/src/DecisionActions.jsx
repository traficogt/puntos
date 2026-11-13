import {useState} from 'react';
import {Alert,Button,Group,Select,Stack,Text,Textarea} from '@mantine/core';
import {api} from './api.js';
export default function DecisionActions({item,staff=[],busy,change}){
 const [assigned,setAssigned]=useState(item.assigned_staff_id??''),[dismissing,setDismissing]=useState(false),[reason,setReason]=useState(''),[history,setHistory]=useState(null),[historyError,setHistoryError]=useState('');
 const body=extra=>({decision_key:item.key,fingerprint:item.fingerprint,version:item.review_version,status:'open',...extra});
 async function readHistory(){setHistoryError('');try{setHistory((await api(`/api/admin/decisions/history/${encodeURIComponent(item.key)}`)).events);}catch(error){setHistoryError(error.message);}}
 return <Stack gap="sm" mt="md">
  {item.evidence_changed&&<Alert color="yellow">La evidencia cambió desde la última revisión. El pendiente volvió a abrirse y conserva su responsable.</Alert>}
  <Text size="sm">Costo de la acción: {item.impact?.cost_state==='known'?item.impact.cost:'desconocido'}. {item.impact?.cost_note}</Text>
  {item.dismiss_reason&&<Text size="sm">Motivo del descarte: {item.dismiss_reason}</Text>}
  <Group align="end"><Select label={`Responsable de ${item.title}`} value={assigned} onChange={value=>setAssigned(value??'')} data={[{value:'',label:'Sin asignar'},...staff.map(person=>({value:person.id,label:`${person.name} · ${person.role==='MANAGER'?'Gerente':person.role==='OWNER'?'Dueño':'Equipo'}`}))]} searchable maw={400}/><Button mih={44} variant="default" disabled={busy||assigned===(item.assigned_staff_id??'')} onClick={()=>change('/api/admin/decisions/review',body({assigned_staff_id:assigned||null}),item.key,'Responsable guardado. La persona verá este pendiente en su pantalla de equipo.')}>Guardar responsable</Button></Group>
  <Group><Button mih={44} variant="subtle" disabled={busy} onClick={()=>setDismissing(value=>!value)}>Descartar con motivo</Button><Button mih={44} variant="subtle" onClick={readHistory}>Ver historial</Button></Group>
  {dismissing&&<><Textarea label="Motivo del descarte" description="Explica por qué no requiere más atención. No incluyas datos de clientes." maxLength={500} value={reason} onChange={event=>setReason(event.currentTarget.value)}/><Button mih={44} variant="outline" w="fit-content" disabled={busy||reason.trim().length<3} onClick={()=>change('/api/admin/decisions/review',body({status:'dismissed',dismiss_reason:reason.trim()}),item.key,'Motivo guardado. Si cambia la evidencia, el pendiente volverá a abrirse.')}>Confirmar descarte</Button></>}
  {historyError&&<Alert color="red" role="alert">{historyError}</Alert>}
  {history&&<Stack gap="xs" aria-label="Historial del pendiente">{!history.length?<Text size="sm">Todavía no hay revisiones registradas.</Text>:history.map(event=><Text size="sm" key={event.id}>Versión {event.version} · {event.actor_name} · {({open:'Abierto',reviewed:'Revisado',snoozed:'Pospuesto',dismissed:'Descartado'})[event.status]}{event.dismiss_reason?` · ${event.dismiss_reason}`:''}</Text>)}</Stack>}
 </Stack>;
}
