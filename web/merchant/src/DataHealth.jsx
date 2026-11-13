import {useEffect,useState} from 'react';
import {Accordion,Alert,Badge,Button,Code,Group,NumberInput,Select,Stack,Switch,Text,TextInput,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading} from './ui.jsx';
import {merchantRegion} from './region.js';
const path='/api/admin/data-health';
const date=v=>v?new Intl.DateTimeFormat(merchantRegion().locale,{dateStyle:'short',timeStyle:'short',timeZone:merchantRegion().timezone}).format(new Date(v)):'Sin confirmación';
export default function DataHealth(){
 const [revision,setRevision]=useState(0),resource=useResource(path,revision),[sources,setSources]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(null),[saved,setSaved]=useState(false);
 useEffect(()=>{if(resource.data)setSources(resource.data.sources.map(({id,source,label,branch_id,expected_minutes,enabled})=>({id,source,label,branch_id,expected_minutes,enabled})));},[resource.data]);
 const update=(id,key,value)=>{setSaved(false);setSources(rows=>rows.map(row=>row.id===id?{...row,[key]:value}:row));};
 const save=async()=>{setError(null);setBusy(true);try{await api(path,{method:'PUT',body:JSON.stringify({version:resource.data.version,sources})});setSaved(true);setRevision(v=>v+1);}catch(e){setError(e);}finally{setBusy(false);}};
 if(resource.loading)return <Loading label="Revisando la vigencia de los datos…"/>;
 if(resource.error)return <Failure error={resource.error} retry={()=>setRevision(v=>v+1)}/>;
 const data=resource.data;
 return <section className="operation-section" aria-labelledby="data-health-title"><Stack gap="lg">
  <Title order={2} id="data-health-title">¿Los datos están al día?</Title>
  <Text maw="72ch">Define cuánto puede tardar cada conexión en completar sus datos. Si supera ese plazo, PF pausa las recomendaciones y los mensajes que dependen de la ausencia de compras.</Text>
  <Alert color={data.readiness.state==='blocked'?'orange':'gray'} title={data.readiness.state==='blocked'?'Faltan datos para interpretar la actividad':'Cobertura de los registros'}>{data.readiness.summary}</Alert>
  {(data.readiness.sources??[]).map(s=><div key={s.id}><Group justify="space-between"><Text fw={600}>{s.label} · {s.branch_id?`Sucursal: ${data.branches.find(b=>b.id===s.branch_id)?.name??s.branch_id}`:'Todo el negocio'}</Text><Badge color={s.state==='ready'?'green':'orange'}>{s.state==='ready'?'Dentro del plazo':'Revisar conexión'}</Badge></Group><Text size="sm" mt="xs">{s.summary} Datos hasta: {date(s.coverage_through)}. Confirmación recibida: {date(s.received_at)}.</Text></div>)}
  <Accordion><Accordion.Item value="settings"><Accordion.Control>Configurar conexiones y plazos</Accordion.Control><Accordion.Panel><Stack gap="lg">
   <Text size="sm">Activa el seguimiento cuando tu integrador pueda enviar confirmaciones de ventanas completas. Sin confirmaciones, PF pausará las campañas de inactividad. Un negocio que registra visitas manualmente no necesita inventar un plazo.</Text>
   {sources.map(s=><section key={s.id} className="operation-section"><Stack gap="sm">
    <TextInput label="Nombre de la conexión" value={s.label} onChange={e=>update(s.id,'label',e.currentTarget.value)} maxLength={100}/>
    <TextInput label="Código de origen" description="Lo define tu integrador, por ejemplo odoo o mi-pos. Usa letras minúsculas, números y guiones." value={s.source} onChange={e=>update(s.id,'source',e.currentTarget.value)} maxLength={50}/>
    <Select label="Sucursal" value={s.branch_id??'all'} onChange={v=>update(s.id,'branch_id',v==='all'?null:v)} data={[{value:'all',label:'Todo el negocio'},...data.branches.map(b=>({value:b.id,label:b.name}))]} allowDeselect={false}/>
    <NumberInput label="Plazo máximo entre ventanas completas (minutos)" min={5} max={10080} allowDecimal={false} value={s.expected_minutes} onChange={v=>update(s.id,'expected_minutes',v)}/>
    <Switch label="Vigilar esta conexión" checked={s.enabled} onChange={e=>update(s.id,'enabled',e.currentTarget.checked)}/>
    <Text size="sm" c="dimmed">ID para tu integrador: <Code style={{overflowWrap:'anywhere'}}>{s.id}</Code></Text>
    <Button variant="subtle" color="red" onClick={()=>setSources(rows=>rows.filter(row=>row.id!==s.id))} w="fit-content">Quitar seguimiento</Button>
   </Stack></section>)}
   {!sources.length&&<Text>No hay conexiones con plazo configurado. El análisis usa los registros disponibles y las comprobaciones de tu conexión de caja actual.</Text>}
   <Group><Button variant="outline" disabled={sources.length>=100||busy} onClick={()=>setSources(rows=>[...rows,{id:crypto.randomUUID(),source:'mi-pos',label:'Conexión de caja',branch_id:null,expected_minutes:1440,enabled:false}])}>Agregar conexión</Button><Button loading={busy} onClick={save}>Guardar seguimiento</Button></Group>
   {error&&<Failure error={error} retry={save}/>}{saved&&<Text role="status">Seguimiento guardado.</Text>}
  </Stack></Accordion.Panel></Accordion.Item>
  <Accordion.Item value="integration"><Accordion.Control>Instrucciones para el integrador</Accordion.Control><Accordion.Panel><Stack gap="sm"><Text size="sm">Envía una confirmación firmada con la conexión de caja existente. Cada ID de solicitud es único; repetir el mismo contenido es seguro. La fecha indica hasta dónde se procesaron todos los registros, incluso cuando no hubo ventas.</Text><Code block>{`POST ${data.heartbeat_path}\nAuthorization: Bearer <clave existente>\nx-signature: <firma HMAC del cuerpo>\n\n${JSON.stringify({request_id:'UUID único',monitor_id:'ID de la conexión',coverage_through:'2026-11-13T18:00:00Z',status:'complete',pending:0,errors:0},null,2)}`}</Code><Text size="sm">Usa partial si quedan registros y error si hay fallos. PF conserva las confirmaciones; una señal reciente con datos antiguos no elimina la alerta.</Text></Stack></Accordion.Panel></Accordion.Item></Accordion>
  <Text size="sm" c="dimmed">Las confirmaciones las declara la integración. No prueban ventas que nunca llegaron al sistema. Desactivar el seguimiento retira esta protección para esa conexión; no elimina sus registros.</Text>
 </Stack></section>;
}
