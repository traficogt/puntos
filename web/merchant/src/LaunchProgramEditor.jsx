import { NumberInput, Select } from './inputs';
import {merchantRegion} from './region.js';
import {useEffect,useState} from 'react';
import {Alert,Button,Group,Stack,Text} from '@mantine/core';
import {useForm} from '@mantine/form';
import {merchantApi} from './typed-api';
import {number,BusinessLink} from './ui.jsx';
import {basePointsPreview,discountPreview} from './launch-model.js';
/** @param {{program: import('./types/api').ProgramBasics, onDirty?: (dirty: boolean) => void, onSaved?: (program: import('./types/api').ProgramBasics) => void}} props */
export default function LaunchProgramEditor({program,onDirty,onSaved}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[quantity,setQuantity]=useState(/** @type {number | string} */ (75));
 const form=useForm({initialValues:/** @type {import('./types/api').ProgramForm} */ (program),validate:{
  rate:(value,values)=>values.program_type==='DISCOUNT'?null:typeof value!=='number'||!Number.isFinite(value)||value<=0||value>10000?'Ingresa un valor mayor que cero y hasta 10,000.':values.program_type==='SPEND'&&Math.abs(value*10000-Math.round(value*10000))>=0.000001?'Usa hasta cuatro decimales.':values.program_type!=='SPEND'&&!Number.isInteger(value)?'Usa puntos enteros.':null,
  percent_off:(value,values)=>values.program_type!=='DISCOUNT'?null:typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100?'Ingresa un porcentaje entre 1 y 100.':null
 }});
 const dirty=form.isDirty();useEffect(()=>{onDirty?.(dirty||busy);return()=>onDirty?.(false);},[dirty,busy,onDirty]);
 // Mantine runs the field validators before this submit handler.
 /** @param {import('./types/api').ProgramForm} values */
 async function save(values){setBusy(true);setError('');setSaved(false);try{const payload=values.program_type==='DISCOUNT'?{program_type:'DISCOUNT',percent_off:values.percent_off,version:values.version}:{program_type:values.program_type,rate:values.rate,round:values.round,version:values.version};const result=await merchantApi.put('/api/admin/launch/program',/** @type {import('./types/api').ProgramUpdate} */ (payload));form.setValues(result.program);form.resetDirty(result.program);setSaved(true);onSaved?.(result.program);}catch(e){if(e.name!=='AbortError')setError(e.status===409?'Otra sesión cambió la regla. Usa «Recargar configuración» para revisar la versión actual.':e.message||'No se pudo guardar la regla. Vuelve a intentar.');}finally{setBusy(false);}}
 const isDiscount=form.values.program_type==='DISCOUNT';
 const unit=form.values.program_type==='SPEND'?merchantRegion().currency:form.values.program_type==='VISIT'?'visita':'artículo';
 const sampleDiscount=discountPreview(form.values,typeof quantity==='number'?quantity:Number(quantity));
 return <form onSubmit={form.onSubmit(save)}><Stack gap="md">
  <Select label="Cómo funciona tu programa" data={[{value:'SPEND',label:'Puntos por importe de compra'},{value:'VISIT',label:'Puntos por visita'},{value:'ITEM',label:'Puntos por artículo'},{value:'DISCOUNT',label:'Descuento fijo para miembros (sin puntos)'}]} allowDeselect={false} disabled={busy} {...form.getInputProps('program_type')}/>
  {isDiscount
   ?<NumberInput label="Descuento para miembros (%)" min={1} max={100} decimalScale={0} allowNegative={false} disabled={busy} {...form.getInputProps('percent_off')}/>
   :<NumberInput label={`Puntos por ${unit}`} min={0.0001} max={10000} decimalScale={form.values.program_type==='SPEND'?4:0} allowNegative={false} disabled={busy} {...form.getInputProps('rate')}/>}
  {form.values.program_type==='SPEND'&&<Select label="Redondeo de puntos" allowDeselect={false} data={[{value:'ceil',label:'Hacia arriba'},{value:'round',label:'Al entero más cercano'},{value:'floor',label:'Hacia abajo'}]} disabled={busy} {...form.getInputProps('round')}/>}
  {isDiscount
   ?<div className="launch-example"><NumberInput label={`Compra de ejemplo (${merchantRegion().currency})`} min={0} max={100000} decimalScale={merchantRegion().minorUnits} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{sampleDiscount==null?'—':`${merchantRegion().currency} ${number(sampleDiscount)}`} de descuento</Text><Text size="sm" c="dimmed">El miembro paga menos en cada compra. Un programa de descuento no otorga puntos.</Text></div>
   :<div className="launch-example"><NumberInput label={form.values.program_type==='SPEND'?`Compra de ejemplo (${merchantRegion().currency})`:form.values.program_type==='VISIT'?'Visitas de ejemplo':'Artículos de ejemplo'} min={form.values.program_type==='SPEND'?0:1} max={100000} decimalScale={form.values.program_type==='SPEND'?merchantRegion().minorUnits:0} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{number(basePointsPreview(form.values,typeof quantity==='number'?quantity:Number(quantity)))} puntos base</Text><Text size="sm" c="dimmed">Ejemplo antes de bonos, niveles y límites. Los puntos pueden quedar pendientes según tu política de liberación.</Text></div>}
  <Text size="sm">Guardar cambia las compras futuras; conserva saldos, campañas, automatizaciones e integraciones existentes.</Text>
  {error&&<Alert color="red" role="alert">{error}</Alert>}{saved&&<Text role="status">Regla guardada.</Text>}
  <Group><Button type="submit" loading={busy} disabled={!dirty}>{isDiscount?'Guardar descuento':'Guardar regla de puntos'}</Button><BusinessLink href="/administracion/?configurar=puntos">Límites y configuración avanzada</BusinessLink></Group>
 </Stack></form>;
}
