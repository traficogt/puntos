import {REGIONAL_COUNTRIES,REGIONAL_CURRENCIES} from '../../../public/regional-catalog.js';
import WalletLocations from './WalletLocations.jsx';
import {useEffect,useState} from 'react';
import {Alert,Button,Checkbox,Group,Select,Stack,Text,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading} from './ui.jsx';
import {setMerchantRegion} from './region.js';
export default function RegionSettings({onDirty=()=>{},onSaved=()=>{}}){
 const [locationDirty,setLocationDirty]=useState(false);
 const [revision,setRevision]=useState(0),resource=useResource('/api/admin/region',revision);
 const [value,setValue]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{if(resource.data){setValue({country:resource.data.region.country,currency:resource.data.region.currency,timezone:resource.data.region.timezone});setConfirmed(false);}},[resource.data]);
 const dirty=Boolean(value&&resource.data&&Object.keys(value).some(k=>value[k]!==resource.data.region[k]));
 useEffect(()=>{onDirty(dirty||confirmed||locationDirty);return()=>onDirty(false);},[dirty,confirmed,locationDirty,onDirty]);
 if(resource.loading||!value&&!resource.error)return <Loading/>;
 if(resource.error)return <Failure error={resource.error} retry={()=>setRevision(v=>v+1)}/>;
 const change=patch=>{setValue(v=>({...v,...patch}));setSaved(false);setConfirmed(false);setError('');};
 async function save(){setBusy(true);setError('');try{const out=await api('/api/admin/region',{method:'PUT',body:JSON.stringify({...value,version:resource.data.version,confirmed_currency:value.currency})});setMerchantRegion(out.region);setSaved(true);onDirty(false);setRevision(v=>v+1);onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Stack gap="xl" maw={780}><div><Title order={1}>Región del negocio</Title><Text mt="sm" c="dimmed">Define la moneda de tus operaciones y el horario local que usan las reglas y comunicaciones del programa.</Text></div>
 {error&&<Alert color="red" role="alert" title="No se pudo guardar">{error}</Alert>}{saved&&<Alert color="green" role="status" title="Configuración guardada">Las próximas operaciones usarán esta configuración.</Alert>}
 <Select label="País" searchable data={Object.keys(resource.data.countries).map(code=>({value:code,label:resource.data.countries[code].name||REGIONAL_COUNTRIES[code]?.name||code}))} value={value.country} allowDeselect={false} disabled={busy} onChange={country=>{const defaults=resource.data.countries[country];change({country,timezone:defaults.timezone,...(!resource.data.currency_locked?{currency:defaults.currency}:{})});}}/>
 <Select label="Moneda de operación" data={Object.entries(resource.data.currencies||REGIONAL_CURRENCIES).map(([value,label])=>({value,label:`${value} · ${label}`}))} value={value.currency} allowDeselect={false} disabled={busy||resource.data.currency_locked} onChange={currency=>change({currency})} description="Una moneda por negocio. PF no convierte divisas ni cambia el valor de movimientos anteriores."/>
 {resource.data.currency_locked&&<Text size="sm">La moneda está protegida porque el negocio ya tiene movimientos o costos registrados.</Text>}
 <Select label="Zona horaria" searchable data={Array.from(new Set([value.timezone,...Intl.supportedValuesOf('timeZone')]))} value={value.timezone} allowDeselect={false} disabled={busy} onChange={timezone=>change({timezone})} description="Los horarios de reglas y mensajes respetan los cambios de hora de esta zona. Las fechas históricas conservan su instante original."/>
 <Alert color="yellow" title="Revisa la moneda antes de empezar">Después de registrar movimientos, costos, campañas o autorizaciones de cortesía, la moneda queda protegida. Cambiar el país no convierte esos importes. Esta es la moneda de tus operaciones; la facturación de PF se acuerda por separado.</Alert>
 <Checkbox label={`Confirmo que ${value.currency} es la moneda de las operaciones de mi negocio.`} checked={confirmed} onChange={event=>setConfirmed(event.currentTarget.checked)} disabled={busy}/>
 <Text size="sm" c="dimmed">En integraciones, envía esta moneda y teléfonos internacionales completos. Si un importe llega en otra moneda, se rechazará para que puedas corregirlo.</Text>
 <Group><Button onClick={save} loading={busy} disabled={locationDirty||!confirmed||(!dirty&&resource.data.currency_confirmed)}>Guardar región</Button></Group>{locationDirty&&<Text size="sm">Guarda o descarta los cambios de ubicación antes de guardar la región.</Text>}<WalletLocations onDirty={setLocationDirty}/></Stack>;
}
