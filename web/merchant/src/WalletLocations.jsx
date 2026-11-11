import {useEffect,useState} from 'react';
import {Alert,Button,Checkbox,Group,NumberInput,Select,SimpleGrid,Stack,Text,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading} from './ui.jsx';
const draftFor=branch=>({enabled:Boolean(branch.wallet_location_enabled),latitude:branch.wallet_latitude??'',longitude:branch.wallet_longitude??''});
const noop=()=>{};
export default function WalletLocations({onDirty=noop}){
 const [revision,setRevision]=useState(0),resource=useResource('/api/admin/branches/wallet-locations',revision);
 const [selected,setSelected]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const branches=resource.data?.branches??[],branch=branches.find(row=>row.id===selected);
 useEffect(()=>{if(!resource.data)return;const next=resource.data.branches.find(row=>row.id===selected)??resource.data.branches[0];if(next){setSelected(next.id);setDraft(draftFor(next));}},[resource.data]);
 const dirty=Boolean(branch&&draft&&JSON.stringify(draft)!==JSON.stringify(draftFor(branch)));
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
 const change=patch=>{setDraft(current=>({...current,...patch}));setSaved(false);setError('');};
 async function save(){
  const latitude=draft.latitude===''?null:Number(draft.latitude),longitude=draft.longitude===''?null:Number(draft.longitude);
  if((latitude===null)!==(longitude===null)||draft.enabled&&latitude===null||latitude!==null&&(!Number.isFinite(latitude)||Math.abs(latitude)>90)||longitude!==null&&(!Number.isFinite(longitude)||Math.abs(longitude)>180)){setError('Ingresa ambas coordenadas válidas. La latitud va de −90 a 90 y la longitud de −180 a 180.');return;}
  setBusy(true);setError('');try{await api(`/api/admin/branches/${selected}/wallet-location`,{method:'PUT',body:JSON.stringify({enabled:draft.enabled,latitude,longitude})});setSaved(true);onDirty(false);setRevision(v=>v+1);}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <Stack gap="md" component="section" aria-labelledby="wallet-locations-title">
  <div><Title order={2} id="wallet-locations-title">Ubicaciones en Wallet</Title><Text c="dimmed" mt="xs">Ayuda a que tus clientes encuentren su tarjeta cuando estén cerca de una sucursal. Activa hasta diez ubicaciones públicas del negocio.</Text></div>
  <Text size="sm">Apple y Google deciden cuándo mostrar la tarjeta o un aviso. Depende de los permisos y ajustes del cliente; no garantiza una notificación. PF no recibe la ubicación del cliente.</Text>
  {resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={()=>setRevision(v=>v+1)}/>:!branches.length?<Text c="dimmed">Primero crea una sucursal para configurar su ubicación.</Text>:draft&&<>
   {error&&<Alert color="red" role="alert" title="No se guardó la ubicación">{error}</Alert>}
   {saved&&<Alert color="green" role="status" title="Ubicación guardada">La ubicación quedó disponible para las tarjetas compatibles.</Alert>}
   <Select label="Sucursal" data={branches.map(row=>({value:row.id,label:row.name}))} value={selected} allowDeselect={false} disabled={busy||dirty} description={dirty?'Guarda o descarta los cambios antes de elegir otra sucursal.':branch?.address||'Selecciona una sucursal del negocio.'} onChange={id=>{setSelected(id);setDraft(draftFor(branches.find(row=>row.id===id)));setSaved(false);setError('');}}/>
   <SimpleGrid cols={{base:1,sm:2}}>
    <NumberInput label="Latitud" description="De −90 a 90. Usa el punto exacto de la sucursal." value={draft.latitude} decimalScale={6} min={-90} max={90} clampBehavior="none" disabled={busy} onChange={latitude=>change({latitude})}/>
    <NumberInput label="Longitud" description="De −180 a 180. Seis decimales como máximo." value={draft.longitude} decimalScale={6} min={-180} max={180} clampBehavior="none" disabled={busy} onChange={longitude=>change({longitude})}/>
   </SimpleGrid>
   <Checkbox label="Usar esta ubicación en las tarjetas de Wallet" description="Comparte estas coordenadas públicas con Apple y Google para la relevancia por cercanía." checked={draft.enabled} disabled={busy} onChange={event=>change({enabled:event.currentTarget.checked})}/>
   <Group><Button onClick={save} loading={busy} disabled={!dirty}>Guardar ubicación</Button><Button variant="subtle" disabled={busy||!dirty} onClick={()=>{setDraft(draftFor(branch));setError('');setSaved(false);}}>Descartar cambios</Button></Group>
  </>}
 </Stack>;
}
