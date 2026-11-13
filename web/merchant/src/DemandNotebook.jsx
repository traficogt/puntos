import React,{useRef,useState} from 'react';
import {Alert,Badge,Button,Group,NativeSelect,Stack,Table,Text,Textarea,TextInput,Title} from '@mantine/core';
import {api,isDemo,useResource} from './api.js';
import {Failure,Loading} from './ui.jsx';
import {regionalDate} from './region.js';
const statuses={new:'Por revisar',reviewing:'En revisión',planned:'Planificado',available:'Disponible',declined:'No previsto'};
const categories={product:'Producto',reward:'Recompensa',availability:'Disponibilidad',service:'Servicio',other:'Otro'};
function TopicDetail({id,refresh,onSaved,disabled}){
 const resource=useResource(`/api/admin/demand-notebook/${id}`,refresh),pending=useRef(null);
 const [status,setStatus]=useState(''),[note,setNote]=useState(''),[date,setDate]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(resource.loading)return <Loading/>;if(resource.error)return <Failure error={resource.error} retry={onSaved}/>;
 const data=resource.data,currentStatus=status||data.topic.status,currentDate=date??(data.topic.follow_up_at?String(data.topic.follow_up_at).slice(0,10):'');
 async function save(event){event.preventDefault();const body={version:data.topic.version,status:currentStatus,note,follow_up_at:currentDate?`${currentDate}T12:00:00Z`:null},key=JSON.stringify(body);if(pending.current?.key!==key)pending.current={key,body:{...body,request_id:crypto.randomUUID()}};setBusy(true);setError('');try{await api(`/api/admin/demand-notebook/${id}/triage`,{method:'POST',body:JSON.stringify(pending.current.body)});pending.current=null;setNote('');onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Stack gap="lg"><Title order={2}>{data.topic.topic}</Title><Text c="dimmed">{categories[data.topic.category]} · {statuses[data.topic.status]}{data.topic.product_context?` · ${data.topic.product_context}`:''}</Text>
  {error&&<Alert color="red" title="No pudimos guardar" role="alert">{error}</Alert>}
  <form onSubmit={save}><Stack maw={650}>
   <Title order={3}>Decisión y seguimiento</Title><NativeSelect label="Estado después de revisar" data={Object.entries(statuses).map(([value,label])=>({value,label}))} value={currentStatus} onChange={e=>setStatus(e.currentTarget.value)} disabled={busy||disabled}/>
   <Textarea label="Nota interna de seguimiento" description="Registra lo revisado o el siguiente paso. Esta nota no se envía al cliente." required minLength={3} maxLength={1000} value={note} onChange={e=>setNote(e.currentTarget.value)} disabled={busy||disabled}/>
   <TextInput type="date" label="Volver a revisar (opcional)" description="La fecha queda en la agenda del negocio; no envía mensajes." value={currentDate} onChange={e=>setDate(e.currentTarget.value)} disabled={busy||disabled}/>
   <Button type="submit" loading={busy} disabled={disabled||note.trim().length<3}>Guardar seguimiento</Button>
  </Stack></form>
  <div><Title order={3}>Pedidos originales</Title><Text size="sm" c="dimmed">Últimos 100 registros. Un miembro cuenta una vez por tema; las observaciones sin cliente no representan personas únicas.</Text>
   {data.requests.map(row=><div className="operation-section" key={row.id}><Text fw={600}>{row.customer_name|| (row.customer_id?'Miembro del programa':'Observación del equipo')} · {row.source==='customer'?'Enviado por cliente':'Anotado por personal'}</Text><Text>{row.note||'Sin detalle adicional.'}</Text><Text size="sm" c="dimmed">{regionalDate(row.created_at)}</Text></div>)}
  </div>
  <div><Title order={3}>Historial de seguimiento</Title>{!data.events.length?<Text mt="sm">Todavía no hay seguimiento.</Text>:data.events.map(row=><div className="operation-section" key={row.version}><Text fw={600}>{statuses[row.details.status]} · {regionalDate(row.created_at)}</Text><Text>{row.details.note}</Text>{row.details.follow_up_at&&<Text size="sm">Revisar: {regionalDate(row.details.follow_up_at,{dateStyle:'medium'})}</Text>}</div>)}</div>
 </Stack>;
}
export function DemandNotebook({offline=false}){
 const [refresh,setRefresh]=useState(0),[status,setStatus]=useState('all'),[offset,setOffset]=useState(0),[selected,setSelected]=useState(null),[message,setMessage]=useState('');
 const reload=()=>setRefresh(v=>v+1),resource=useResource(`/api/admin/demand-notebook?status=${status}&offset=${offset}`,refresh);
 return <Stack gap="xl">
  <div><Title order={1}>Pedidos de clientes</Title><Text c="dimmed" mt="sm" maw={780}>Reúne solicitudes explícitas, reconoce temas repetidos y deja un siguiente paso. Estos pedidos no son compras garantizadas, ventas perdidas ni una muestra representativa del mercado.</Text></div>
  {isDemo&&<Alert color="blue" title="Demostración">Los pedidos son ficticios y los cambios quedan en esta sesión.</Alert>}
  {offline&&<Alert color="yellow" title="Sin conexión">Reconecta para consultar o guardar seguimiento.</Alert>}
  {message&&<Text role="status">{message}</Text>}
  <Group align="end"><NativeSelect label="Mostrar temas" data={[{value:'all',label:'Todos'},...Object.entries(statuses).map(([value,label])=>({value,label}))]} value={status} onChange={e=>{setStatus(e.currentTarget.value);setOffset(0);}}/><Button variant="default" onClick={reload} disabled={offline}>Actualizar</Button></Group>
  {resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={reload}/>:<>
   {!!resource.data.topics.length&&<Text size="sm" c="dimmed" hiddenFrom="sm">Desliza la tabla para ver el seguimiento y la acción de revisar.</Text>}
   {!resource.data.topics.length?<Text>No hay pedidos con este filtro. El personal puede anotarlos en Caja y los clientes desde su tarjeta en el navegador.</Text>:<Table.ScrollContainer minWidth={650} scrollAreaProps={{viewportProps:{tabIndex:0,'aria-label':'Temas solicitados'}}}><Table><Table.Thead><Table.Tr><Table.Th>Tema</Table.Th><Table.Th>Miembros únicos</Table.Th><Table.Th>Observaciones del equipo</Table.Th><Table.Th>Estado y seguimiento</Table.Th><Table.Th>Acción</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{resource.data.topics.map(row=><Table.Tr key={row.id}>
    <Table.Td><Text fw={600}>{row.topic}</Text><Text size="sm">{categories[row.category]}{row.reward_name?` · ${row.reward_name}`:''}</Text></Table.Td><Table.Td>{row.member_count}</Table.Td><Table.Td>{row.staff_observations}</Table.Td><Table.Td><Badge variant="light">{statuses[row.status]}</Badge>{row.follow_up_at&&<Text size="sm">{regionalDate(row.follow_up_at,{dateStyle:'medium'})}</Text>}</Table.Td><Table.Td><Button variant="default" size="sm" onClick={()=>{setSelected(row.id);setMessage('');}} aria-label={`Revisar ${row.topic}`}>Revisar</Button></Table.Td>
   </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
   <Group><Button variant="default" disabled={offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Anteriores</Button><Button variant="default" disabled={!resource.data.pagination.has_more} onClick={()=>setOffset(v=>v+50)}>Siguientes</Button></Group>
  </>}
  {selected&&<section className="operation-section"><Group justify="space-between" mb="lg"><Text fw={600}>Detalle del tema</Text><Button variant="subtle" onClick={()=>setSelected(null)}>Cerrar detalle</Button></Group><TopicDetail key={selected} id={selected} refresh={refresh} disabled={offline} onSaved={()=>{reload();setMessage('Seguimiento actualizado.');}}/></section>}
 </Stack>;
}
