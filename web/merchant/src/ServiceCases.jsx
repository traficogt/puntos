import {merchantRegion} from './region.js';
import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, List, NativeSelect, Paper, SegmentedControl, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { api, isDemo, useResource } from './api.js';
import { Failure, Loading, number } from './ui.jsx';
const kinds={redemption_failed:'Intento rechazado',unavailable:'Beneficio no disponible',unfulfilled:'Beneficio no entregado'};
const resolutions={original_fulfilled:'Se entregó el beneficio original',alternative_accepted:'El cliente aceptó una alternativa',closed_with_reason:'Cerrar con motivo',points_restored:'Restituir los puntos del canje'};
function date(value){return value?new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'medium',timeStyle:'short',timeZone:merchantRegion().timezone}).format(new Date(value)):'Sin fecha';}
function CaseContext({row,detail=false}){
 return <Stack gap={4} mt="xs">
  <Text size="sm">Cliente: {row.customer_display_name||'Sin nombre registrado'}</Text>
  <Text size="xs" c="dimmed" style={{overflowWrap:'anywhere'}}>Referencia de cliente: {row.customer_id}</Text>
  <Text size="sm">Sucursal: {row.branch_display_name||(row.branch_id?'Nombre no disponible':'Sin sucursal registrada')}</Text>
  <Text size="sm">Reportado por: {row.reporting_staff_display_name||'Nombre no disponible'}</Text>
  {detail&&<Text size="xs" c="dimmed" style={{overflowWrap:'anywhere'}}>Referencia del caso: {row.id}{row.redemption_id&&<> · Canje: {row.redemption_id}</>}</Text>}
 </Stack>;
}
function Detail({id,onBack,onSaved}){
 const [refresh,setRefresh]=useState(0),resource=useResource(`/api/admin/service-cases/${id}`,refresh);
 const [resolution,setResolution]=useState('closed_with_reason'),[reason,setReason]=useState(''),[attested,setAttested]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(null),[success,setSuccess]=useState('');
 const [assignee,setAssignee]=useState(''),[managementReason,setManagementReason]=useState(''),[promiseId,setPromiseId]=useState(''),[actualId,setActualId]=useState(''),[until,setUntil]=useState('');
 const managementPending=useRef(null);
 const heading=useRef(null),pending=useRef(null),row=resource.data?.case,needsAttestation=['original_fulfilled','alternative_accepted'].includes(resolution);
 useEffect(()=>{if(row&&!resource.loading)heading.current?.focus();},[row?.id,resource.loading]);
 async function save(event){
  event.preventDefault();if(busy||!row)return;setError(null);setBusy(true);
  const payload={version:row.version,resolution,reason:reason.trim(),attested,...(promiseId&&needsAttestation?{promiseId,...(resolution==='alternative_accepted'?{fulfillmentRewardId:actualId}:{})}:{})},key=JSON.stringify(payload);
  if(pending.current?.key!==key)pending.current={key,requestId:crypto.randomUUID()};
  try{await api(`/api/admin/service-cases/${id}/resolve`,{method:'POST',body:JSON.stringify({...payload,requestId:pending.current.requestId})});setSuccess(isDemo?'Resolución guardada solo en esta demostración.':'Resolución guardada en el historial.');setRefresh(value=>value+1);onSaved();}
  catch(cause){setError(cause.message);}finally{setBusy(false);}
 }
 async function manage(action){if(busy)return;setBusy(true);setError(null);const payload={action,version:row.version,reason:managementReason,...(action==='assign'?{assignedStaffId:assignee||null}:{}),...(action==='extend_expiry'?{promiseId,extendedUntil:new Date(until).toISOString()}:{})},key=JSON.stringify(payload);if(managementPending.current?.key!==key)managementPending.current={key,requestId:crypto.randomUUID()};try{await api(`/api/admin/service-cases/${id}/manage`,{method:'POST',body:JSON.stringify({...payload,requestId:managementPending.current.requestId})});managementPending.current=null;setSuccess('Acción guardada en el historial del caso.');setRefresh(v=>v+1);onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const availablePromises=(resource.data?.promises??[]).filter(p=>!row?.reward_id||p.reward_id===row.reward_id),selectedPromise=availablePromises.find(p=>p.id===promiseId);
 return <Stack gap="lg">
  <Button variant="subtle" onClick={onBack} w="fit-content">Volver a los casos</Button>
  {resource.loading?<Loading label="Consultando el caso…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(value=>value+1)}/>:row&&<>
   <Group justify="space-between"><Title ref={heading} tabIndex={-1} order={2}>{row.evidence?.reward_name_at_report||'Incidencia de servicio'}</Title><Badge color="gray" variant="light">{row.status==='open'?'Pendiente':'Resuelto'}</Badge></Group>
   <Text>{row.reason}</Text><CaseContext row={row} detail/><Text size="sm" c="dimmed">{kinds[row.kind]} · Registrado el {date(row.created_at)}</Text>
   <Paper p="md" withBorder>
    <Title order={3} size="h4">Qué está registrado</Title>
    <List mt="sm" spacing="sm">
     <List.Item>{row.redemption_id?`Canje vinculado: ${number(row.evidence?.redemption?.points_cost??0)} puntos. La restitución requiere verificar el débito original.`:'Al reportarse, este caso no tenía un canje completado. Las entregas posteriores aparecen en el historial.'}</List.Item>
     {row.kind==='redemption_failed'&&<List.Item>El intento rechazado no descontó puntos. Un nuevo canje debe registrarse por separado.</List.Item>}
     <List.Item>{row.evidence?.promise_terms?`Promesa guardada: ${row.evidence.promise_terms.reward_name} · ${number(row.evidence.promise_terms.points_cost)} puntos.`:'Condiciones prometidas anteriormente: sin evidencia guardada. La configuración actual no demuestra cuáles eran.'}</List.Item>
     <List.Item>La entrega física y cualquier alternativa deben confirmarse con el cliente.</List.Item>
    </List>
   </Paper>
   {resource.data.customer_active===false&&<Alert color="yellow">La cuenta del cliente está desactivada. Su caso e historial se conservan; no se pueden entregar beneficios ni modificar su saldo.</Alert>}
   {success&&<Alert color="green" role="status">{success}</Alert>}
   {row.status==='open'&&<Stack gap="md" maw={700}>
    <Title order={3}>Responsable y seguimiento</Title><Text size="sm">Responsable: {resource.data.team?.find(p=>p.id===row.assigned_staff_id)?.name||'Sin asignar'}. {row.escalated_at?`Escalado: ${row.escalation_reason}`:''}</Text>
    <NativeSelect label="Asignar a" value={assignee} onChange={e=>setAssignee(e.currentTarget.value)} data={[{value:'',label:'Sin asignar'},...(resource.data.team??[]).filter(p=>p.role==='OWNER'||(p.branch_id??null)===(row.branch_id??null)).map(p=>({value:p.id,label:p.name}))]}/>
    <Textarea label="Motivo del seguimiento" required minLength={3} maxLength={500} value={managementReason} onChange={e=>setManagementReason(e.currentTarget.value)}/>
    <Group><Button variant="outline" disabled={busy||managementReason.trim().length<3} onClick={()=>manage('assign')}>Guardar responsable</Button><Button variant="outline" disabled={busy||managementReason.trim().length<3} onClick={()=>manage('escalate')}>Escalar al dueño</Button></Group>
    {!!availablePromises.length&&<><NativeSelect label="Promesa protegida del cliente" value={promiseId} onChange={e=>{setPromiseId(e.currentTarget.value);setActualId('');}} data={[{value:'',label:'Selecciona una promesa'},...availablePromises.map(p=>({value:p.id,label:`${p.reward_name} · ${number(p.points_cost)} puntos`}))]}/>{selectedPromise&&<><Text size="sm">Condiciones originales: {selectedPromise.description||'Sin descripción guardada'}. Vencimiento original: {selectedPromise.valid_until?date(selectedPromise.valid_until):'Sin vencimiento'}. Vigencia actual: {selectedPromise.effective_valid_until?date(selectedPromise.effective_valid_until):'Sin vencimiento'}.</Text>{selectedPromise.valid_until&&<Group align="end"><TextInput type="datetime-local" label="Ampliar vigencia hasta" value={until} onChange={e=>setUntil(e.currentTarget.value)}/><Button variant="outline" disabled={busy||!until||managementReason.trim().length<3} onClick={()=>manage('extend_expiry')}>Guardar extensión</Button></Group>}</>}</>}
   </Stack>}
   {row.status==='open'&&<form onSubmit={save}><Stack gap="md" maw={700}>
    <Title order={3}>Registrar una resolución</Title>
    <NativeSelect label="Cómo se resolvió" value={resolution} onChange={event=>{setResolution(event.currentTarget.value);setAttested(false);}} data={Object.entries(resolutions).map(([value,label])=>({value,label,disabled:value==='points_restored'&&(!row.redemption_id||!!resource.data.restoration)}))}/>
    {needsAttestation&&!row.redemption_id&&<Text size="sm">{promiseId?'Al guardar se registra el canje real con las condiciones protegidas y se descuenta su saldo una sola vez.':'Sin promesa seleccionada, solo se registra la confirmación del equipo; no se genera un canje.'}</Text>}
    {needsAttestation&&promiseId&&resolution==='alternative_accepted'&&<NativeSelect label="Alternativa aprobada que se entregó" value={actualId} onChange={e=>setActualId(e.currentTarget.value)} data={[{value:'',label:'Selecciona la alternativa'},...(selectedPromise?.alternatives??[]).map(r=>({value:r.id,label:r.name}))]}/>}
    {resolution==='points_restored'&&<Text size="sm">Se restituirá únicamente el débito verificado, una vez por canje. No cambia los puntos ganados de por vida ni las existencias. La actualización de Wallet se programa al guardar.</Text>}
    <Textarea label={resolution==='alternative_accepted'?'Alternativa acordada y motivo':'Motivo y lo que confirmaste con el cliente'} description="No incluyas teléfonos, documentos ni datos sensibles." required minLength={3} maxLength={500} autosize minRows={3} value={reason} onChange={event=>setReason(event.currentTarget.value)}/>
    {needsAttestation&&<Checkbox label={resolution==='original_fulfilled'?'Confirmo que se entregó el beneficio original.':'Confirmo que el cliente aceptó la alternativa descrita.'} checked={attested} onChange={event=>setAttested(event.currentTarget.checked)}/>}
    {error&&<Alert color="red" role="alert">{error}<Button display="block" mt="sm" variant="subtle" onClick={()=>setRefresh(value=>value+1)}>Actualizar el caso</Button></Alert>}
    <Button type="submit" loading={busy} disabled={busy||reason.trim().length<3||(needsAttestation&&!attested)||(needsAttestation&&promiseId&&resolution==='alternative_accepted'&&!actualId)} w="fit-content">Guardar resolución</Button>
   </Stack></form>}
   <section aria-labelledby="case-history"><Title id="case-history" order={3}>Historial del caso</Title><List mt="md" spacing="md">{resource.data.events.map(event=><List.Item key={event.id}><Text fw={600}>{event.event_type==='reported'?'Caso registrado':resolutions[event.details.resolution]||({assigned:'Responsable actualizado',escalated:'Caso escalado',expiry_extended:'Vigencia ampliada'})[event.event_type]||'Caso actualizado'}</Text><Text>{event.details.reason}</Text><Text size="sm" c="dimmed">{date(event.created_at)}{event.details.attested?' · Confirmado por el equipo':''}</Text>{event.details.evidence_level&&<Text size="sm">Evidencia: {({fulfilled:'Canje real y entrega confirmada',attested:'Confirmación del equipo',balance_restored:'Ajuste de saldo registrado',code_generated:'Código generado',attempted:'Intento registrado'})[event.details.evidence_level]||event.details.evidence_level}{event.details.fulfillment?.redemptionId?` · Canje ${event.details.fulfillment.redemptionId}`:''}</Text>}{event.details.restoration&&<Text size="sm">{number(event.details.restoration.points_restored)} puntos restituidos.</Text>}</List.Item>)}</List></section>
  </>}
 </Stack>;
}
export default function ServiceCases(){
 const [status,setStatus]=useState('open'),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[selected,setSelected]=useState(null);
 const insights=useResource('/api/admin/service-cases/insights',refresh);
 const resource=useResource(selected?null:`/api/admin/service-cases?status=${status}&offset=${offset}`,refresh);
 return <Stack gap="xl">
  <div><Title order={1}>Resolver casos</Title><Text c="dimmed" mt="sm" maw={760}>Atiende los beneficios que no pudieron entregarse y deja constancia de lo acordado con el cliente.</Text></div>
  {isDemo&&<Text size="sm" c="dimmed">Casos ficticios. Las resoluciones se guardan solo en esta sesión de demostración.</Text>}
  {!selected&&insights.data&&<section className="operation-section"><Title order={2}>Motivos de los últimos 30 días</Title>{insights.data.reasons.length?<List mt="md">{insights.data.reasons.map(r=><List.Item key={r.kind}>{kinds[r.kind]}: {number(r.total)} casos, {number(r.open)} pendientes, {number(r.escalated)} escalados.</List.Item>)}</List>:<Text mt="sm">Aún no hay casos en este período.</Text>}{insights.data.suggestions.map(s=><Text key={s.kind} mt="sm">{number(s.evidence_count)} escalaciones por {kinds[s.kind]?.toLowerCase()}. {s.suggestion}</Text>)}</section>}
  {selected?<Detail key={selected} id={selected} onBack={()=>setSelected(null)} onSaved={()=>setRefresh(value=>value+1)}/>:<>
   <Group justify="space-between"><SegmentedControl aria-label="Estado de los casos" value={status} onChange={value=>{setStatus(value);setOffset(0);}} data={[{value:'open',label:'Pendientes'},{value:'resolved',label:'Resueltos'}]}/><Button variant="outline" loading={resource.loading} onClick={()=>setRefresh(value=>value+1)}>Actualizar casos</Button></Group>
   {resource.loading?<Loading label="Consultando los casos…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(value=>value+1)}/>:<>
    {!resource.data?.cases.length?<Stack gap="sm"><Title order={2} size="h3">{status==='open'?'Sin casos pendientes registrados':'Todavía no hay resoluciones registradas'}</Title><Text c="dimmed">El equipo puede reportar un beneficio no disponible desde la pantalla de atención. Los intentos rechazados conocidos se registran automáticamente.</Text></Stack>:<Stack gap="lg">{resource.data.cases.map(row=><section key={row.id} className="operation-section"><Group justify="space-between" align="start"><div><Title order={2} size="h3">{row.evidence?.reward_name_at_report||'Incidencia de servicio'}</Title><Text mt="xs">{row.reason}</Text><CaseContext row={row}/><Text size="sm" c="dimmed" mt="xs">{kinds[row.kind]} · {date(row.created_at)}</Text></div><Button variant="outline" onClick={()=>setSelected(row.id)}>{row.status==='open'?'Revisar caso':'Ver resolución'}</Button></Group></section>)}</Stack>}
    <Group justify="space-between"><Button variant="subtle" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Anteriores</Button><Text size="sm" c="dimmed">Página {Math.floor(offset/50)+1}</Text><Button variant="subtle" disabled={!resource.data?.pagination?.has_more} onClick={()=>setOffset(value=>value+50)}>Siguientes</Button></Group>
   </>}
  </>}
 </Stack>;
}
