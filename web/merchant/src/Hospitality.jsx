import {useEffect,useRef,useState} from 'react';
import {Alert,Badge,Button,Group,NativeSelect,NumberInput,SimpleGrid,Stack,Table,Text,TextInput,Title} from '@mantine/core';
import {api,isDemo,useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
import {hospitalityCapacity,hospitalityPreset} from './hospitality-pilot.js';

export default function Hospitality(){
 const pending=useRef(null),[version,setVersion]=useState(0),resource=useResource('/api/admin/hospitality',version);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[online,setOnline]=useState(()=>navigator.onLine);
 const [person,setPerson]=useState(''),[branch,setBranch]=useState(''),[reward,setReward]=useState(''),[title,setTitle]=useState(''),[units,setUnits]=useState(5),[budget,setBudget]=useState(25),[unitCost,setUnitCost]=useState(5),[hours,setHours]=useState('8'),[validHours,setValidHours]=useState('48');
 useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
 const refresh=()=>setVersion(v=>v+1),data=resource.data,region=data?.region,currency=region?.currency||'',offline=!isDemo&&!online,disabled=!!busy||offline;
 const format=value=>new Intl.NumberFormat(region?.locale,{style:'currency',currency:currency||'GTQ'}).format(Number(value));
 const when=value=>new Intl.DateTimeFormat(region?.locale,{dateStyle:'medium',timeStyle:'short',timeZone:region?.timezone}).format(new Date(value));
 const selectedReward=data?.rewards.find(row=>row.id===reward),knownCost=selectedReward?.unit_cost_q;
 const capacity=hospitalityCapacity({units,budget,unitCost,minorUnits:region?.minorUnits??2}),preset=hospitalityPreset({knownCost,budget,minorUnits:region?.minorUnits??2});
 const invalidCost=knownCost!=null&&Number(unitCost)<Number(knownCost),canCreate=!!capacity?.units&&knownCost!=null&&!invalidCost;
 const available=row=>hospitalityCapacity({units:row.remaining_units,budget:row.remaining_cost,unitCost:row.unit_cost_limit,minorUnits:region?.minorUnits??2})?.units??0;
 async function mutate(key,fn,success){
  if(disabled)return;
  setBusy(key);setError('');setMessage('');
  try{await fn();setMessage(success);refresh();}catch(failure){setError(failure.message);}finally{setBusy('');}
 }
 function submit(event){
  event.preventDefault();if(!canCreate)return;
  const terms={staff_id:person,branch_id:branch||null,reward_id:reward,title,total_units:units,total_cost:budget,unit_cost_limit:unitCost,valid_hours:Number(validHours)},key=JSON.stringify({...terms,hours});
  if(pending.current?.key!==key){const now=Date.now();pending.current={key,body:JSON.stringify({...terms,request_id:crypto.randomUUID(),starts_at:new Date(now).toISOString(),ends_at:new Date(now+Number(hours)*3600000).toISOString()})};}
  return mutate('create',async()=>{await api('/api/admin/hospitality',{method:'POST',body:pending.current.body});pending.current=null;setOpen(false);},'Cortesía autorizada. Cada entrega quedará vinculada a su cliente.');
 }
 const state=row=>row.revoked_at?'Revocada':new Date(row.ends_at)<=new Date(data.server_now)?'Vencida':available(row)<1?'Agotada':new Date(row.starts_at)>new Date(data.server_now)?'Programada':'Vigente';
 return <Stack gap="xl">
  <div><Title order={1}>Cortesías del equipo</Title><Text c="dimmed" mt="sm" maw={750}>Aprueba un beneficio concreto, quién puede ofrecerlo y hasta cuánto puede comprometer. Cada acción entrega una unidad; nunca permite puntos libres.</Text></div>
  {isDemo&&<Alert title="Demostración" color="blue">Los cambios usan personas ficticias y se quedan en esta sesión.</Alert>}
  {offline&&<Alert title="Sin conexión" color="yellow">Los datos visibles corresponden a la última consulta. Reconecta y actualiza para ver el estado actual o cambiar una autorización.</Alert>}
  {error&&<Alert title="No pudimos guardar" color="red" role="alert">{error}</Alert>}
  {message&&<Text role="status">{message}</Text>}
  {resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={refresh}/>:<>
   <section className="operation-section">
    <Group justify="space-between" align="start"><div><Title order={2}>Autorizaciones</Title><Text c="dimmed" mt="sm" maw={750}>Se reserva el límite de costo por cada cortesía emitida. Revocar detiene nuevas emisiones y conserva las ya entregadas al cliente.</Text></div><Button disabled={disabled||open||!data.staff.length||!data.rewards.length} onClick={()=>{setOpen(true);setPerson(data.staff[0]?.id||'');}}>Autorizar cortesía</Button></Group>
    {(!data.staff.length||!data.rewards.length)&&<Text mt="md">Primero agrega una persona activa y una recompensa con costo conocido en Costos del programa.</Text>}
    {open&&<form onSubmit={submit}><Stack mt="xl" maw={700}>
     <Title order={3}>Nueva cortesía autorizada</Title>
     <TextInput label="Nombre para el cliente" placeholder="Un café de cortesía" required maxLength={100} value={title} onChange={e=>setTitle(e.currentTarget.value)} disabled={disabled}/>
     <NativeSelect label="Persona autorizada" data={[{value:'',label:'Selecciona una persona'},...data.staff.map(r=>({value:r.id,label:r.name}))]} required value={person} onChange={e=>{setPerson(e.currentTarget.value);setBranch('');}} disabled={disabled}/>
     <NativeSelect label="Sucursal" data={[{value:'',label:'Sucursal actual de la persona al emitir'},...data.branches.filter(r=>data.staff.find(s=>s.id===person)?.branch_id===r.id).map(r=>({value:r.id,label:r.name}))]} value={branch} onChange={e=>setBranch(e.currentTarget.value)} disabled={disabled}/>
     <NativeSelect label="Recompensa aprobada" data={[{value:'',label:'Selecciona una recompensa'},...data.rewards.map(r=>({value:r.id,label:`${r.name} · ${r.unit_cost_q==null?'Falta registrar costo':format(r.unit_cost_q)}`,disabled:r.unit_cost_q==null}))]} required value={reward} onChange={e=>{setReward(e.currentTarget.value);const row=data.rewards.find(r=>r.id===e.currentTarget.value);if(row?.unit_cost_q!=null)setUnitCost(Number(row.unit_cost_q));}} disabled={disabled}/>
     <SimpleGrid cols={{base:1,sm:3}}>
      <NumberInput label="Unidades totales" min={1} max={10000} allowDecimal={false} value={units} onChange={setUnits} required disabled={disabled}/>
      <NumberInput label={`Límite por unidad (${currency})`} min={0} max={1000000} decimalScale={region?.minorUnits??2} value={unitCost} onChange={setUnitCost} required disabled={disabled} error={invalidCost?'El costo registrado supera este límite.':undefined}/>
      <NumberInput label={`Presupuesto total (${currency})`} min={0} max={1000000} decimalScale={region?.minorUnits??2} value={budget} onChange={setBudget} required disabled={disabled}/>
     </SimpleGrid>
     <div>
      <Button variant="default" disabled={disabled||!preset} onClick={()=>{setUnits(preset.totalUnits);setBudget(preset.totalCost);setUnitCost(preset.unitCostLimit);}}>Usar prueba de hasta 5 unidades</Button>
      <Text size="sm" c="dimmed" mt="xs">Opcional: usa el costo registrado y ajusta las unidades y el presupuesto a lo que alcanza. Puedes editar los límites después.</Text>
     </div>
     <SimpleGrid cols={{base:1,sm:2}}>
      <NativeSelect label="Tiempo para emitir" data={[{value:'4',label:'4 horas'},{value:'8',label:'8 horas'},{value:'24',label:'1 día'},{value:'168',label:'7 días'}]} value={hours} onChange={e=>setHours(e.currentTarget.value)} disabled={disabled}/>
      <NativeSelect label="Plazo del cliente para canjear" description="Contado desde que se emite su cortesía." data={[{value:'24',label:'24 horas'},{value:'48',label:'48 horas'},{value:'168',label:'7 días'},{value:'720',label:'30 días'}]} value={validHours} onChange={e=>setValidHours(e.currentTarget.value)} disabled={disabled}/>
     </SimpleGrid>
     <div aria-live="polite">
      <Text fw={600}>{capacity?`Máximo: ${number(capacity.units)} cortesías · compromiso de ${format(capacity.commitment)}.`:'Completa límites válidos para ver cuántas cortesías puedes emitir.'}</Text>
      {capacity?.units===0&&<Text size="sm" c="red">El presupuesto no alcanza para una unidad al límite aprobado.</Text>}
      <Text size="sm" c="dimmed" mt="xs">El compromiso reserva el límite por unidad; no es el costo de las entregas. Cada emisión requiere conexión y no reserva existencias.</Text>
     </div>
     <Group><Button type="submit" loading={busy==='create'} disabled={offline||!canCreate}>Guardar autorización</Button><Button variant="default" onClick={()=>setOpen(false)} disabled={!!busy}>Cancelar</Button></Group>
    </Stack></form>}
    {!data.grants.length?<Text mt="lg">Todavía no hay cortesías autorizadas. Empieza con una recompensa y un límite pequeño para un turno.</Text>:<Table.ScrollContainer scrollAreaProps={{viewportProps:{tabIndex:0}}} minWidth={740}>
     <Table mt="lg"><Table.Thead><Table.Tr><Table.Th>Beneficio y persona</Table.Th><Table.Th>Por emitir</Table.Th><Table.Th>Vigencia</Table.Th><Table.Th>Estado</Table.Th><Table.Th>Acción</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.grants.map(row=><Table.Tr key={row.id}>
      <Table.Td><Text fw={600}>{row.title}</Text><Text size="sm">{row.staff_name} · {row.reward_name}</Text></Table.Td>
      <Table.Td>Hasta {number(available(row))} unidades<Text size="sm">{format(row.remaining_cost)} sin comprometer</Text></Table.Td>
      <Table.Td>{when(row.ends_at)}</Table.Td><Table.Td><Badge color={state(row)==='Vigente'?'green':'gray'}>{state(row)}</Badge></Table.Td>
      <Table.Td><Button variant="default" size="sm" aria-label={`Revocar ${row.title}`} disabled={disabled||!!row.revoked_at} loading={busy===row.id} onClick={()=>mutate(row.id,()=>api(`/api/admin/hospitality/${row.id}/revoke`,{method:'POST',body:'{}'}),'Autorización revocada. Los beneficios ya emitidos siguen vigentes.')}>Revocar</Button></Table.Td>
     </Table.Tr>)}</Table.Tbody></Table>
    </Table.ScrollContainer>}
   </section>
   <section className="operation-section" aria-labelledby="hospitality-results-heading">
    <Group justify="space-between" align="start"><div><Title id="hospitality-results-heading" order={2}>Resultados por autorización</Title><Text c="dimmed" mt="sm" maw={750}>Todas las emisiones desde la creación de cada autorización. Las entregadas, vencidas sin usar y pendientes suman el total emitido.</Text></div><Button variant="default" onClick={refresh} disabled={disabled}>Actualizar resultados</Button></Group>
    <Text size="sm" c="dimmed" mt="sm">Consulta: {when(data.server_now)} · {region?.timezone}. {offline?'Sin actualizar por falta de conexión.':'Actualiza para incluir nuevas emisiones y entregas.'}</Text>
    {data.grants.length>0&&<Text size="sm" c="dimmed" mt="sm" hiddenFrom="sm">Desliza la tabla para ver todos los resultados.</Text>}
    {!data.grants.length?<Text mt="lg">Después de autorizar una cortesía, podrás seguir aquí sus emisiones y entregas.</Text>:<Table.ScrollContainer scrollAreaProps={{viewportProps:{tabIndex:0,role:'region','aria-label':'Resultados de cortesías: tabla desplazable'}}} minWidth={1060}>
     <Table mt="lg"><Table.Thead><Table.Tr><Table.Th>Autorización</Table.Th><Table.Th>Emitidas</Table.Th><Table.Th>Entregadas</Table.Th><Table.Th>Vencidas sin usar</Table.Th><Table.Th>Pendientes</Table.Th><Table.Th>Compromiso reservado</Table.Th><Table.Th>Costo estimado de entregas</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.grants.map(row=><Table.Tr key={row.id}>
      <Table.Td><Text fw={600}>{row.title}</Text><Text size="sm">{row.staff_name}</Text></Table.Td>
      {row.report?<>
       <Table.Td>{number(row.report.issued)}</Table.Td><Table.Td>{number(row.report.fulfilled)}</Table.Td><Table.Td>{number(row.report.expired_unused)}</Table.Td><Table.Td>{number(row.report.pending)}</Table.Td>
       <Table.Td>{format(row.report.committed_cost)}<Text size="sm">de {format(row.total_cost)} autorizado</Text></Table.Td>
       <Table.Td>{row.report.fulfilled===0?'Sin entregas':row.report.fulfilled_known_cost==null?'Desconocido':format(row.report.fulfilled_known_cost)}<Text size="sm">{number(row.report.fulfilled_cost_known_units)} de {number(row.report.fulfilled)} entregas con costo</Text>{row.report.fulfilled_cost_unknown_units>0&&<Text size="sm">{number(row.report.fulfilled_cost_unknown_units)} sin costo registrado</Text>}</Table.Td>
      </>:<Table.Td colSpan={6}>Informe no disponible. Actualiza para volver a consultar.</Table.Td>}
     </Table.Tr>)}</Table.Tbody></Table>
    </Table.ScrollContainer>}
    <Text size="sm" c="dimmed" mt="md" maw={800}>El costo estimado suma solo los costos registrados al entregar; los desconocidos quedan fuera. El compromiso reservado se conserva aunque una cortesía venza. Estos registros no miden retorno de inversión ni visitas causadas por la cortesía.</Text>
   </section>
   <section className="operation-section"><Title order={2}>Historial de cortesías</Title><Text mt="sm" c="dimmed" maw={750}>Últimas 100 emisiones. Una cortesía vencida conserva su historial y el compromiso reservado; no repone automáticamente el presupuesto.</Text>
    {!data.history.length?<Text mt="lg">Las cortesías emitidas aparecerán aquí con su cliente y estado de entrega.</Text>:<Table.ScrollContainer scrollAreaProps={{viewportProps:{tabIndex:0}}} minWidth={620}>
     <Table mt="lg"><Table.Thead><Table.Tr><Table.Th>Emitida</Table.Th><Table.Th>Beneficio</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Estado</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.history.map(row=><Table.Tr key={row.id}><Table.Td>{when(row.issued_at)}</Table.Td><Table.Td>{row.title}<Text size="sm">{row.reward_name}</Text></Table.Td><Table.Td>{row.customer_name||'Cliente'}</Table.Td><Table.Td>{row.redemption_id?'Entregada':new Date(row.expires_at)<=new Date(data.server_now)?'Vencida':`Por entregar · vence ${when(row.expires_at)}`}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
    </Table.ScrollContainer>}
   </section>
  </>}
 </Stack>;
}
