import {useEffect,useRef,useState} from 'react';
import {Alert,Anchor,Badge,Button,Checkbox,Group,NativeSelect,Stack,Text,Textarea,TextInput,Title} from '@mantine/core';
import {api,isDemo,useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
import {merchantRegion} from './region.js';
import {actionLabels,fulfillmentActions,fulfillmentLabels,fulfillmentState,manualPayload,mappingPayload,stableRequest,stockDescription} from './fulfillment-model.js';

const base='/api/admin/redemption-pos',mappingBase='/api/admin/reward-pos-mappings';
const date=value=>value?new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'medium',timeStyle:'short',timeZone:merchantRegion().timezone}).format(new Date(value)):'Sin fecha';
const quantity=value=>new Intl.NumberFormat(merchantRegion().locale,{maximumFractionDigits:6}).format(value);
function Status({value}) {return <Badge variant="light" c="var(--mantine-color-text)" color={value==='recorded'?'teal':['review','pending'].includes(value)?'yellow':'gray'}>{fulfillmentLabels[value]??fulfillmentLabels.unknown}</Badge>;}
function useAlive(){const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);return alive;}
function ServiceLink(){return <Anchor href="#casos" c="inherit" underline="always">Resolver una incidencia de entrega</Anchor>;}

function Detail({id,onBack,onSaved}) {
 const [refresh,setRefresh]=useState(0),resource=useResource(`${base}/${encodeURIComponent(id)}`,refresh),detail=resource.data;
 const [action,setAction]=useState('recorded'),[receiptRef,setReceipt]=useState(''),[reason,setReason]=useState(''),[attested,setAttested]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const pending=useRef(null),inFlight=useRef(false),heading=useRef(null),alive=useAlive(),record=detail?.fulfillment,state=fulfillmentState(record),actions=fulfillmentActions(detail);
 const chosen=actions.includes(action)?action:actions[0];
 useEffect(()=>{if(detail?.redemption)heading.current?.focus();},[detail?.redemption?.id]);
 async function save(event){
  event.preventDefault();if(inFlight.current||!detail?.redemption)return;
  setError('');let payload;
  try{payload=manualPayload({version:state.version,action:chosen,receiptRef,reason,attested});}catch(cause){setError(cause.message);return;}
  pending.current=stableRequest({redemptionId:id,...payload},pending.current);inFlight.current=true;setBusy(true);
  try{
   const result=await api(`${base}/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({...payload,requestId:pending.current.requestId})});
   if(!alive.current)return;
   if(!result?.fulfillment)throw new Error('No se confirmó la evidencia. Reintenta la misma solicitud.');
   pending.current=null;setAttested(false);setReason('');setReceipt('');setSuccess(isDemo?'Evidencia guardada solo en esta demostración.':'Evidencia guardada. El canje de puntos conserva su historial.');setRefresh(v=>v+1);onSaved();
  }catch(cause){if(alive.current&&cause.name!=='AbortError')setError(cause.message||'No se confirmó la evidencia. Reintenta la misma solicitud.');}
  finally{inFlight.current=false;if(alive.current)setBusy(false);}
 }
 return <Stack gap="lg">
  <Group justify="space-between"><Button variant="subtle" onClick={onBack} disabled={busy}>Volver a los canjes</Button><Button variant="outline" disabled={busy||resource.loading} onClick={()=>{setError('');setAttested(false);setRefresh(v=>v+1);}}>Actualizar este canje</Button></Group>
  {success&&<Alert color="teal" role="status">{success}</Alert>}
  {resource.loading?<Loading label="Consultando evidencia del canje…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(v=>v+1)}/>:!detail?.redemption||!Array.isArray(detail.events)?<Failure error={new Error('Respuesta incompleta')} retry={()=>setRefresh(v=>v+1)}/>:<>
   <div><Group justify="space-between" align="start"><Title ref={heading} tabIndex={-1} order={2}>{detail.redemption.reward_name}</Title><Status value={state.status}/></Group><Text mt="sm">Código PF: <Text component="strong" style={{overflowWrap:'anywhere'}}>{detail.redemption.code}</Text></Text><Text size="sm" c="dimmed">Este código identifica el canje de puntos. El recibo de la caja es una referencia distinta.</Text></div>
   {state.status==='unknown'&&<Alert color="gray">Este canje es anterior al seguimiento POS. Su estado de caja es desconocido; comprueba el historial antes de actuar.</Alert>}
   {(state.status==='review'||record?.returnedQuantity>0||detail.redemption.points_restored)&&<Alert color="yellow" title="Revisa la entrega y el historial"><Stack gap="xs">{record?.returnedQuantity>0&&<Text size="sm">Cantidad devuelta: {quantity(record.returnedQuantity)}. La devolución conserva la evidencia original.</Text>}{detail.redemption.points_restored&&<Text size="sm">Los puntos de este canje fueron restituidos. Comprueba la entrega antes de registrar cualquier ajuste en caja.</Text>}<ServiceLink/></Stack></Alert>}
   <section className="operation-section"><Title order={3} size="h4">Evidencia de caja</Title><Stack gap="xs" mt="sm">
    <Text>{stockDescription(record)}</Text>
    {record?.receiptRef&&<Text style={{overflowWrap:'anywhere'}}>Recibo declarado: {record.receiptRef}</Text>}
    {record?.source&&<Text style={{overflowWrap:'anywhere'}}>Origen: {record.source}</Text>}
    {record?.orderId&&<Text style={{overflowWrap:'anywhere'}}>Venta POS: {record.orderId}</Text>}
    {record?.lineId&&<Text size="sm" style={{overflowWrap:'anywhere'}}>Línea POS: {record.lineId}</Text>}
    {record?.recordedAt&&<Text size="sm" c="dimmed">Registrado el {date(record.recordedAt)}</Text>}
   </Stack></section>
   <form onSubmit={save}><Stack gap="md" maw={700}>
    <Title order={3}>Registrar una comprobación</Title>
    <Text size="sm">Comprueba primero el recibo en tu caja. Esta declaración deja evidencia en PF; el registro y las existencias se gestionan en el POS.</Text>
    <NativeSelect label="Acción sobre la evidencia" value={chosen} onChange={event=>{setAction(event.currentTarget.value);setAttested(false);}} disabled={busy} data={actions.map(value=>({value,label:actionLabels[value]}))}/>
    {chosen==='recorded'&&<TextInput label="Referencia del recibo" required maxLength={200} value={receiptRef} onChange={event=>setReceipt(event.currentTarget.value)} disabled={busy}/>}
    {chosen==='not_required'&&<Text size="sm">Explica por qué este beneficio no necesita un registro en caja. Esta decisión queda en el historial.</Text>}
    {chosen==='review'&&<Text size="sm">Deja constancia de lo que debe comprobarse. La revisión conserva recibos, devoluciones y restituciones anteriores.</Text>}
    {chosen==='reviewed'&&<Text size="sm">Confirma que revisaste el recibo y la entrega. Cerrar la revisión conserva las devoluciones y la evidencia original; no cambia puntos ni existencias. Resuelve cualquier incidencia de puntos en los casos de servicio.</Text>}
    <Textarea label="Motivo o detalle comprobado" description="No incluyas teléfonos, documentos ni datos sensibles." required minLength={3} maxLength={500} minRows={3} autosize value={reason} onChange={event=>setReason(event.currentTarget.value)} disabled={busy}/>
    <Checkbox label="Confirmo que comprobé lo descrito." checked={attested} onChange={event=>setAttested(event.currentTarget.checked)} disabled={busy}/>
    {error&&<Alert color="red" role="alert">{error}<Text size="sm" mt="xs">Puedes reintentar con los mismos datos. Si el canje cambió, actualízalo antes de continuar.</Text></Alert>}
    <Button type="submit" loading={busy} disabled={!attested||reason.trim().length<3||(chosen==='recorded'&&!receiptRef.trim())} w="fit-content">{chosen==='reviewed'?'Cerrar revisión':'Guardar evidencia'}</Button>
   </Stack></form>
   {state.status!=='review'&&<ServiceLink/>}
   <section aria-labelledby="fulfillment-history"><Title order={3} id="fulfillment-history">Historial de la evidencia</Title>{!detail.events.length?<Text c="dimmed" mt="sm">Todavía no hay comprobaciones registradas.</Text>:<Stack mt="md" gap="md">{detail.events.map((event,index)=><div key={`${event.source}:${event.event_id}:${index}`}><Text fw={600}>{fulfillmentLabels[event.kind]??({reversed:'Devolución recibida',stock_updated:'Actualización de existencias'}[event.kind]??'Evidencia recibida')}</Text>{event.details?.reason&&<Text>{event.details.reason}</Text>}<Text size="sm" c="dimmed" style={{overflowWrap:'anywhere'}}>{date(event.created_at)} · {event.source==='manual'?'Declarado por el equipo':event.source}</Text></div>)}</Stack>}</section>
  </>}
 </Stack>;
}

const blankMapping={rewardId:'',source:'',branchId:'',productRef:'',itemName:'',itemKind:'product',quantity:'1',enabled:true,version:0};
function Mappings() {
 const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const resource=useResource(open?mappingBase:null,refresh),data=resource.data,alive=useAlive(),inFlight=useRef(false);
 const update=(key,value)=>setDraft(prior=>({...prior,[key]:value}));
 async function save(event){event.preventDefault();if(inFlight.current||!draft?.rewardId)return;setError('');let payload;try{payload=mappingPayload(draft);}catch(cause){setError(cause.message);return;}inFlight.current=true;setBusy(true);
  try{const result=await api(`${mappingBase}/${encodeURIComponent(draft.rewardId)}`,{method:'PUT',body:JSON.stringify(payload)});if(!alive.current)return;if(!result?.mapping)throw new Error('No se confirmó el vínculo. Actualiza la lista para comprobarlo.');setDraft(null);setSuccess('Vínculo guardado. El POS debe usarlo al registrar cada canje.');setRefresh(v=>v+1);}
  catch(cause){if(alive.current&&cause.name!=='AbortError')setError(cause.message||'No se confirmó el vínculo. Actualiza la lista antes de volver a guardar.');}finally{inFlight.current=false;if(alive.current)setBusy(false);}
 }
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary style={{cursor:'pointer',fontWeight:600}}>Vincular recompensas con artículos del POS</summary>{open&&<Stack gap="md" mt="md">
  <Text maw={760}>Opcional, para una integración compatible. Pide al administrador de tu POS el origen exacto y la referencia del producto o servicio. Guardar un vínculo no registra canjes ni confirma movimientos de existencias.</Text>
  {success&&<Alert color="teal" role="status">{success}</Alert>}
  {resource.loading?<Loading label="Consultando vínculos de recompensas…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(v=>v+1)}/>:!Array.isArray(data?.mappings)||!Array.isArray(data?.rewards)||!Array.isArray(data?.branches)?<Failure error={new Error('Respuesta incompleta')} retry={()=>setRefresh(v=>v+1)}/>:<>
   {!data.mappings.length?<Text c="dimmed">Todavía no hay vínculos. Puedes seguir registrando los recibos manualmente.</Text>:<Stack gap="md">{data.mappings.map(row=><section key={row.id} className="operation-section"><Group justify="space-between" align="start"><div><Text fw={600}>{data.rewards.find(r=>r.id===row.reward_id)?.name??'Recompensa'} · {row.enabled?'Vínculo activo':'Vínculo desactivado'}</Text><Text style={{overflowWrap:'anywhere'}}>{row.item_name} · {row.product_ref}</Text><Text size="sm" c="dimmed" style={{overflowWrap:'anywhere'}}>{row.source} · {row.branch_id?(data.branches.find(b=>b.id===row.branch_id)?.name??'Sucursal registrada'):'Sin sucursal asignada'} · {new Intl.NumberFormat(merchantRegion().locale,{maximumFractionDigits:6}).format(row.quantity)} {row.item_kind==='service'?'servicios':'unidades'} por canje</Text></div><Button variant="outline" disabled={busy} onClick={()=>{setError('');setSuccess('');setDraft({rewardId:row.reward_id,source:row.source,branchId:row.branch_id??'',productRef:row.product_ref,itemName:row.item_name,itemKind:row.item_kind,quantity:String(row.quantity),enabled:row.enabled,version:row.version});}}>Editar vínculo</Button></Group></section>)}</Stack>}
   <Group><Button variant="outline" disabled={busy||!!draft||!data.rewards.length} onClick={()=>{setError('');setSuccess('');setDraft({...blankMapping});}}>Crear vínculo</Button><Button variant="subtle" disabled={busy} onClick={()=>{setDraft(null);setError('');setRefresh(v=>v+1);}}>Actualizar vínculos</Button></Group>
   {!data.rewards.length&&<Text size="sm">Crea primero una recompensa en tu programa.</Text>}
   {draft&&<form onSubmit={save}><Stack gap="md" maw={700}>
    <Title order={3}>{draft.version?'Editar vínculo':'Nuevo vínculo'}</Title>
    <NativeSelect label="Recompensa PF" required value={draft.rewardId} onChange={event=>update('rewardId',event.currentTarget.value)} disabled={busy||draft.version>0} data={[{value:'',label:'Selecciona una recompensa'},...data.rewards.map(row=>({value:row.id,label:`${row.name}${row.active?'':' (inactiva)'}`}))]}/>
    <TextInput label="Origen de la caja" description="Usa el nombre exacto facilitado por el administrador del POS." required maxLength={180} value={draft.source} onChange={event=>update('source',event.currentTarget.value)} disabled={busy||draft.version>0}/>
    <NativeSelect label="Sucursal del vínculo" value={draft.branchId} onChange={event=>update('branchId',event.currentTarget.value)} disabled={busy} data={[{value:'',label:'Sin sucursal asignada'},...data.branches.map(row=>({value:row.id,label:row.name}))]}/>
    <TextInput label="Referencia del artículo en el POS" required maxLength={200} value={draft.productRef} onChange={event=>update('productRef',event.currentTarget.value)} disabled={busy}/>
    <TextInput label="Nombre del artículo en el POS" required maxLength={150} value={draft.itemName} onChange={event=>update('itemName',event.currentTarget.value)} disabled={busy}/>
    <NativeSelect label="Tipo de artículo" value={draft.itemKind} onChange={event=>update('itemKind',event.currentTarget.value)} disabled={busy} data={[{value:'product',label:'Producto'},{value:'service',label:'Servicio'}]}/>
    <TextInput label="Cantidad por canje" description="Mayor que cero; hasta seis decimales con punto decimal." required inputMode="decimal" value={draft.quantity} onChange={event=>update('quantity',event.currentTarget.value)} disabled={busy}/>
    <Checkbox label="Vínculo habilitado para el POS" checked={draft.enabled} onChange={event=>update('enabled',event.currentTarget.checked)} disabled={busy}/>
    {error&&<Alert color="red" role="alert">{error}<Text size="sm" mt="xs">Si se perdió la respuesta, actualiza los vínculos para comprobar si se guardó antes de editar de nuevo.</Text></Alert>}
    <Group><Button type="submit" loading={busy} disabled={!draft.rewardId}>Guardar vínculo</Button><Button variant="subtle" disabled={busy} onClick={()=>setDraft(null)}>Cancelar</Button></Group>
   </Stack></form>}
  </>}
 </Stack>}</details>;
}

export default function Fulfillment() {
 const [status,setStatus]=useState('pending'),[code,setCode]=useState(''),[search,setSearch]=useState(''),[searchError,setSearchError]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[selected,setSelected]=useState(null);
 const resource=useResource(selected?null:`${base}?status=${status}&code=${encodeURIComponent(search)}&offset=${offset}`,refresh),data=resource.data;
 return <Stack gap="xl">
  <div><Title order={1}>Canjes y caja</Title><Text c="dimmed" mt="sm" maw={760}>Da seguimiento al registro en caja de las recompensas canjeadas. El código PF conecta el canje con la evidencia del POS.</Text></div>
  {isDemo&&<Text size="sm" c="dimmed">Canjes y recibos ficticios. Los cambios solo afectan esta sesión de demostración.</Text>}
  {selected?<Detail key={selected} id={selected} onBack={()=>setSelected(null)} onSaved={()=>setRefresh(v=>v+1)}/>:<>
   <section className="operation-section"><Title order={2} size="h3">Después del canje, registra la entrega en tu caja</Title><Text mt="sm" maw={760}>Usa el flujo de recompensa de tu POS y conserva el código PF con el recibo. Después, confirma aquí la referencia. PF registra la declaración del equipo; comprueba las existencias en tu caja.</Text></section>
   <Group align="end" justify="space-between"><NativeSelect label="Estado en caja" value={status} onChange={event=>{setStatus(event.currentTarget.value);setOffset(0);}} data={[...Object.entries(fulfillmentLabels).map(([value,label])=>({value,label})),{value:'all',label:'Todos los canjes'}]}/><Button variant="outline" disabled={resource.loading} onClick={()=>setRefresh(v=>v+1)}>Actualizar canjes</Button></Group>
   <form onSubmit={event=>{event.preventDefault();const value=code.trim().toUpperCase();if(!/^[A-F0-9]{0,16}$/.test(value)){setSearchError('Usa hasta 16 caracteres del código PF (0–9 y A–F).');return;}setSearchError('');setSearch(value);setOffset(0);}}><Group align="start"><TextInput label="Buscar por código PF" description="Código completo o sus primeros caracteres." value={code} maxLength={16} onChange={event=>setCode(event.currentTarget.value)} error={searchError} style={{flex:1,maxWidth:400}}/><Button type="submit" variant="default" mt={25}>Buscar canje</Button></Group></form>
   {resource.loading?<Loading label="Consultando canjes…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(v=>v+1)}/>:!Array.isArray(data?.records)||!data?.summary||!data?.pagination?<Failure error={new Error('Respuesta incompleta')} retry={()=>setRefresh(v=>v+1)}/>:<>
    <Text size="sm" c="dimmed">En todo el historial: {number(data.summary.pending??0)} pendientes en caja · {number(data.summary.review??0)} requieren revisión · {number(data.summary.unknown??0)} históricos sin evidencia.</Text>
    {!data.records.length?<section><Title order={2} size="h3">Sin canjes en este filtro</Title><Text c="dimmed" mt="sm">Prueba otro estado o código. Los canjes históricos sin evidencia se consultan por separado; no se convierten automáticamente en pendientes.</Text></section>:<Stack gap="lg">{data.records.map(row=><section key={row.id} className="operation-section"><Group justify="space-between" align="start"><div><Group gap="sm"><Title order={2} size="h3">{row.reward_name}</Title><Status value={fulfillmentState(row).status}/></Group><Text mt="xs" style={{overflowWrap:'anywhere'}}>Código PF: <strong>{row.code}</strong></Text><Text size="sm" c="dimmed">{row.branch_name??'Sin sucursal registrada'} · {number(row.points_cost)} puntos · {date(row.created_at)}</Text>{row.points_restored&&<Text size="sm">Puntos restituidos; comprueba la entrega.</Text>}{row.returned_quantity>0&&<Text size="sm">Cantidad devuelta: {quantity(row.returned_quantity)}</Text>}</div><Button variant="outline" onClick={()=>setSelected(row.id)}>Revisar canje</Button></Group></section>)}</Stack>}
    <Group justify="space-between"><Button variant="subtle" disabled={offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Anteriores</Button><Text size="sm" c="dimmed">Página {Math.floor(offset/50)+1}</Text><Button variant="subtle" disabled={!data.pagination.has_more} onClick={()=>setOffset(v=>v+50)}>Siguientes</Button></Group>
   </>}
   <Mappings/>
  </>}
 </Stack>;
}
