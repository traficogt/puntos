import {merchantRegion} from './region.js';
import { useEffect, useRef, useState } from 'react';
import { Accordion, Alert, Anchor, Button, Group, Pagination, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { api, isDemo, useResource } from './api.js';
import { Failure, Loading, Locked, money, number } from './ui.jsx';
const noop=()=>{};

export default function Acquisition({features,staff,onDirty=noop}) {
  if(staff?.role!=='OWNER')return <Stack><Title order={1}>Orígenes de clientes</Title><Text>El dueño del negocio puede crear enlaces y revisar sus resultados.</Text></Stack>;
  if(!features?.analytics)return <Locked feature="Orígenes de clientes"/>;
  return <AcquisitionContent onDirty={onDirty} features={features}/>;
}
function AcquisitionContent({onDirty,features}) {
  const [refresh,setRefresh]=useState(0),[page,setPage]=useState(1);
  const resource=useResource('/api/admin/acquisition',refresh);
  const [name,setName]=useState(''),[branch,setBranch]=useState(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const requestId=useRef(null);
  useEffect(()=>{onDirty(Boolean(name.trim()||branch));return()=>onDirty(false);},[name,branch,onDirty]);
  const data=resource.data;
  async function create(event){
    event.preventDefault();if(saving||!name.trim())return;
    setSaving(true);setError('');setStatus('');requestId.current??=crypto.randomUUID();
    try{
      await api('/api/admin/acquisition/sources',{method:'POST',body:JSON.stringify({name:name.trim(),branch_id:branch,request_id:requestId.current})});
      setName('');setBranch(null);requestId.current=null;setPage(1);setRefresh(n=>n+1);setStatus(isDemo?'Origen de ejemplo creado en esta pestaña.':'Origen creado. Su enlace queda listo para compartir.');
    }catch(e){setError(e.message||'No pudimos crear el origen. Vuelve a intentar.');}
    finally{setSaving(false);}
  }
  async function copy(source){try{await navigator.clipboard.writeText(source.registration_url);setStatus(`Enlace de ${source.name} copiado.`);}catch{setStatus('Abre el enlace para copiar su dirección.');}}
  const totals=(data?.sources||[]).reduce((out,s)=>{for(const key of Object.keys(out))out[key]+=Number(s[key]||0);return out;},{visits:0,registrations:0,first_purchasers:0,repeat_purchasers:0,recorded_sales_q:0});
  return <Stack gap="xl">
    <div><Title order={1}>De un enlace a una nueva visita</Title><Text className="intro">Identifica dónde llegan tus clientes: mostrador, mesas o una publicación. Cada origen conserva su enlace de inscripción.</Text></div>
    {isDemo&&<Alert color="yellow" title="Datos de ejemplo">Las cifras son ficticias. Los enlaces abren la demostración y los cambios se quedan en esta pestaña.</Alert>}
    {resource.loading?<Loading label="Cargando orígenes…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(n=>n+1)}/>:<>
      <section aria-labelledby="source-results"><Title order={2} id="source-results">Resultados registrados</Title><Text size="sm" c="dimmed" mt="xs">{data.definitions.period}</Text>
        <SimpleGrid cols={{base:1,sm:2,lg:5}} mt="md">{[['Aperturas del enlace','visits'],['Nuevos registros','registrations'],['Clientes con compra','first_purchasers'],['Clientes recurrentes','repeat_purchasers'],['Ventas registradas','recorded_sales_q']].map(([label,key])=><Paper key={key} withBorder p="md"><Text size="sm">{label}</Text><Text size="xl" fw={700}>{key==='recorded_sales_q'?money(totals[key]):number(totals[key])}</Text></Paper>)}</SimpleGrid>
        <Text size="sm" mt="md">Las aperturas no son personas únicas ni escaneos. Las ventas se observan en clientes atribuidos; no prueban que el QR las haya causado.</Text>
      </section>
      <section aria-labelledby="create-source"><Title order={2} id="create-source">Crea un origen</Title><Text size="sm" mt="xs">Usa un nombre que reconozcas después. Los enlaces impresos se conservan; no se reasignan a otro origen. Hasta 100 por negocio.</Text>
        <form onSubmit={create}><Stack mt="md" gap="md" maw={600}>
          <TextInput label="Nombre del origen" placeholder="Por ejemplo, mostrador de Zona 10" value={name} maxLength={80} required disabled={saving} onChange={event=>{setName(event.currentTarget.value);requestId.current=null;}}/>
          <Select label="Sucursal (opcional)" placeholder="Todo el negocio" clearable value={branch} disabled={saving} onChange={value=>{setBranch(value);requestId.current=null;}} data={data.branches.map(b=>({value:b.id,label:b.name}))}/>
          {error&&<Alert color="red" title="No se creó el origen" role="alert">{error}</Alert>}
          <Button type="submit" loading={saving} disabled={!name.trim()||data.sources.length>=data.limit} mih={44} w="fit-content">Crear enlace</Button>
        </Stack></form>
      </section>
      <section aria-labelledby="source-list"><Group justify="space-between"><Title order={2} id="source-list">Tus orígenes</Title>{features.branded_qr&&<Anchor href="#marca">Preparar QR con marca</Anchor>}</Group>
        {!data.sources.length?<Text mt="md">Todavía no hay orígenes. Crea el primero para empezar a medir sus nuevas inscripciones.</Text>:<>
          <Table.ScrollContainer minWidth={900} mt="md"><Table striped highlightOnHover><Table.Caption>Acumulado por origen. Recurrentes: dos o más compras registradas.</Table.Caption><Table.Thead><Table.Tr>{['Origen','Aperturas','Registros','Con compra','Recurrentes',`Ventas (${merchantRegion().currency})`,'Enlace'].map(label=><Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{data.sources.slice((page-1)*10,page*10).map(s=><Table.Tr key={s.id}><Table.Td><Text fw={600}>{s.name}</Text><Text size="xs" c="dimmed">{s.branch_name||'Todo el negocio'}</Text></Table.Td><Table.Td>{number(s.visits)}</Table.Td><Table.Td>{number(s.registrations)}</Table.Td><Table.Td>{number(s.first_purchasers)}</Table.Td><Table.Td>{number(s.repeat_purchasers)}</Table.Td><Table.Td>{money(s.recorded_sales_q)}</Table.Td><Table.Td><Group gap="xs"><Button variant="subtle" mih={44} onClick={()=>copy(s)} aria-label={`Copiar enlace de ${s.name}`}>Copiar</Button><Anchor c="var(--mantine-color-text)" underline="always" href={s.registration_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir enlace de ${s.name}`}>Abrir</Anchor></Group></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
          {data.sources.length>10&&<Pagination mt="md" value={page} onChange={setPage} total={Math.ceil(data.sources.length/10)} aria-label="Páginas de orígenes"/>}
        </>}
      </section>
      <Accordion variant="separated"><Accordion.Item value="definitions"><Accordion.Control>Cómo se cuentan estos resultados</Accordion.Control><Accordion.Panel><Stack gap="sm">{['visits','registrations','purchases','sales','deletion'].map(key=><Text key={key} size="sm">{data.definitions[key]}</Text>)}</Stack></Accordion.Panel></Accordion.Item></Accordion>
    </>}
    <Text role="status" aria-live="polite" size="sm">{status}</Text>
  </Stack>;
}
