import {merchantRegion} from './region.js';
import {useEffect,useState} from 'react';
import {Alert,Button,Group,NumberInput,Select,Stack,Text} from '@mantine/core';
import {useForm} from '@mantine/form';
import {api} from './api.js';
import {number,BusinessLink} from './ui.jsx';
import {basePointsPreview} from './launch-model.js';
export default function LaunchProgramEditor({program,onDirty,onSaved}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[quantity,setQuantity]=useState(75);
 const form=useForm({initialValues:program,validate:{rate:(value,values)=>typeof value!=='number'||!Number.isFinite(value)||value<=0||value>10000?'Ingresa un valor mayor que cero y hasta 10,000.':values.program_type==='SPEND'&&Math.abs(value*10000-Math.round(value*10000))>=0.000001?'Usa hasta cuatro decimales.':values.program_type!=='SPEND'&&!Number.isInteger(value)?'Usa puntos enteros.':null}});
 const dirty=form.isDirty();useEffect(()=>{onDirty?.(dirty||busy);return()=>onDirty?.(false);},[dirty,busy,onDirty]);
 async function save(values){setBusy(true);setError('');setSaved(false);try{const result=await api('/api/admin/launch/program',{method:'PUT',body:JSON.stringify(values)});form.setValues(result.program);form.resetDirty(result.program);setSaved(true);onSaved?.(result.program);}catch(e){if(e.name!=='AbortError')setError(e.status===409?'Otra sesión cambió la regla. Usa «Recargar configuración» para revisar la versión actual.':e.message||'No se pudo guardar la regla. Vuelve a intentar.');}finally{setBusy(false);}}
 const unit=form.values.program_type==='SPEND'?merchantRegion().currency:form.values.program_type==='VISIT'?'visita':'artículo';
 return <form onSubmit={form.onSubmit(save)}><Stack gap="md">
  <Select label="Cómo ganan puntos tus clientes" data={[{value:'SPEND',label:'Por importe de compra'},{value:'VISIT',label:'Por visita'},{value:'ITEM',label:'Por artículo'}]} allowDeselect={false} disabled={busy} {...form.getInputProps('program_type')}/>
  <NumberInput label={`Puntos por ${unit}`} min={0.0001} max={10000} decimalScale={form.values.program_type==='SPEND'?4:0} allowNegative={false} disabled={busy} {...form.getInputProps('rate')}/>
  {form.values.program_type==='SPEND'&&<Select label="Redondeo de puntos" allowDeselect={false} data={[{value:'ceil',label:'Hacia arriba'},{value:'round',label:'Al entero más cercano'},{value:'floor',label:'Hacia abajo'}]} disabled={busy} {...form.getInputProps('round')}/>}
  <div className="launch-example"><NumberInput label={form.values.program_type==='SPEND'?`Compra de ejemplo (${merchantRegion().currency})`:form.values.program_type==='VISIT'?'Visitas de ejemplo':'Artículos de ejemplo'} min={form.values.program_type==='SPEND'?0:1} max={100000} decimalScale={form.values.program_type==='SPEND'?merchantRegion().minorUnits:0} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{number(basePointsPreview(form.values,quantity))} puntos base</Text><Text size="sm" c="dimmed">Ejemplo antes de bonos, niveles y límites. Los puntos pueden quedar pendientes según tu política de liberación.</Text></div>
  <Text size="sm">Guardar cambia las compras futuras; conserva saldos, campañas, automatizaciones e integraciones existentes.</Text>
  {error&&<Alert color="red" role="alert">{error}</Alert>}{saved&&<Text role="status">Regla guardada.</Text>}
  <Group><Button type="submit" loading={busy} disabled={!dirty}>Guardar regla de puntos</Button><BusinessLink href="/administracion/?configurar=puntos">Límites y configuración avanzada</BusinessLink></Group>
 </Stack></form>;
}
