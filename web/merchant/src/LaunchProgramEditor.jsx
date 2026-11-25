import { NumberInput, Select } from './inputs';
import {merchantRegion} from './region.js';
import {useEffect,useState} from 'react';
import {Alert,Anchor,Button,Group,Stack,Text,TextInput} from '@mantine/core';
import {useForm} from '@mantine/form';
import {merchantApi} from './typed-api';
import {number} from './ui.jsx';
import {basePointsPreview,discountPreview,stampPreview,cashbackPreview,giftCardPreview} from './launch-model.js';
/** @param {{program: import('./types/api').ProgramBasics, onDirty?: (dirty: boolean) => void, onSaved?: (program: import('./types/api').ProgramBasics) => void}} props */
export default function LaunchProgramEditor({program,onDirty,onSaved}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[quantity,setQuantity]=useState(/** @type {number | string} */ (75));
 const form=useForm({initialValues:/** @type {import('./types/api').ProgramForm} */ (program),validate:{
  rate:(value,values)=>values.program_type==='DISCOUNT'||values.program_type==='STAMP'||values.program_type==='CASHBACK'||values.program_type==='GIFT_CARD'?null:typeof value!=='number'||!Number.isFinite(value)||value<=0||value>10000?'Ingresa un valor mayor que cero y hasta 10,000.':values.program_type==='SPEND'&&Math.abs(value*10000-Math.round(value*10000))>=0.000001?'Usa hasta cuatro decimales.':values.program_type!=='SPEND'&&!Number.isInteger(value)?'Usa puntos enteros.':null,
  percent_off:(value,values)=>values.program_type!=='DISCOUNT'?null:typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100?'Ingresa un porcentaje entre 1 y 100.':null,
  stamps_required:(value,values)=>values.program_type!=='STAMP'?null:!Number.isInteger(Number(value))||Number(value)<2||Number(value)>100?'Usa un número entero de 2 a 100.':null,
  head_start:(value,values)=>{if(values.program_type!=='STAMP'||value===''||value==null)return null;const req=Number(values.stamps_required);return !Number.isInteger(Number(value))||Number(value)<0?'Usa un número entero de 0 o más.':Number.isInteger(req)&&Number(value)>=req?'Los sellos de regalo deben ser menos que el total.':null;},
  reward_label:(value,values)=>values.program_type!=='STAMP'?null:typeof value!=='string'||!value.trim()?'Escribe el premio (por ejemplo, Café gratis).':null,
  cashback_percent:(value,values)=>values.program_type!=='CASHBACK'?null:typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100?'Ingresa un porcentaje entre 1 y 100.':null,
  load_bonus_percent:(value,values)=>values.program_type!=='GIFT_CARD'?null:value==null||value===''?null:typeof value!=='number'||!Number.isFinite(value)||value<0||value>100?'Ingresa un porcentaje entre 0 y 100.':null
 }});
 const dirty=form.isDirty();useEffect(()=>{onDirty?.(dirty||busy);return()=>onDirty?.(false);},[dirty,busy,onDirty]);
 // Give a stamp card sensible defaults the first time it is selected.
 useEffect(()=>{if(form.values.program_type==='STAMP'&&(form.values.stamps_required==null||form.values.stamps_required==='')){form.setFieldValue('stamps_required',10);if(form.values.head_start==null||form.values.head_start==='')form.setFieldValue('head_start',2);if(!form.values.reward_label)form.setFieldValue('reward_label','Café gratis');if(form.values.stamp_unit!=='visit'&&form.values.stamp_unit!=='item')form.setFieldValue('stamp_unit','visit');}
 if(form.values.program_type==='CASHBACK'&&(form.values.cashback_percent==null||form.values.cashback_percent===''))form.setFieldValue('cashback_percent',5);
 if(form.values.program_type==='GIFT_CARD'&&(form.values.load_bonus_percent==null||form.values.load_bonus_percent===''))form.setFieldValue('load_bonus_percent',0);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[form.values.program_type]);
 // Mantine runs the field validators before this submit handler.
 /** @param {import('./types/api').ProgramForm} values */
 async function save(values){setBusy(true);setError('');setSaved(false);try{const payload=values.program_type==='DISCOUNT'?{program_type:'DISCOUNT',percent_off:values.percent_off,version:values.version}:values.program_type==='CASHBACK'?{program_type:'CASHBACK',cashback_percent:values.cashback_percent,version:values.version}:values.program_type==='GIFT_CARD'?{program_type:'GIFT_CARD',load_bonus_percent:values.load_bonus_percent==null||values.load_bonus_percent===''?0:Number(values.load_bonus_percent),version:values.version}:values.program_type==='STAMP'?{program_type:'STAMP',stamps_required:Number(values.stamps_required),head_start:values.head_start==null||values.head_start===''?undefined:Number(values.head_start),reward_label:typeof values.reward_label==='string'?values.reward_label.trim():values.reward_label,stamp_unit:values.stamp_unit,version:values.version}:{program_type:values.program_type,rate:values.rate,round:values.round,version:values.version};const result=await merchantApi.put('/api/admin/launch/program',/** @type {import('./types/api').ProgramUpdate} */ (payload));form.setValues(result.program);form.resetDirty(result.program);setSaved(true);onSaved?.(result.program);}catch(e){if(e.name!=='AbortError')setError(e.status===409?'Otra sesión cambió la regla. Usa «Recargar configuración» para revisar la versión actual.':e.message||'No se pudo guardar la regla. Vuelve a intentar.');}finally{setBusy(false);}}
 const isDiscount=form.values.program_type==='DISCOUNT';
 const isStamp=form.values.program_type==='STAMP';
 const isCashback=form.values.program_type==='CASHBACK';
 const isGiftCard=form.values.program_type==='GIFT_CARD';
 const unit=form.values.program_type==='SPEND'?merchantRegion().currency:form.values.program_type==='VISIT'?'visita':'artículo';
 const sampleDiscount=discountPreview(form.values,typeof quantity==='number'?quantity:Number(quantity));
 const sampleCashback=cashbackPreview(form.values,typeof quantity==='number'?quantity:Number(quantity));
 const sampleGiftBonus=giftCardPreview(form.values,typeof quantity==='number'?quantity:Number(quantity));
 const card=stampPreview(form.values);
 const prize=typeof form.values.reward_label==='string'&&form.values.reward_label.trim()?form.values.reward_label.trim():'tu premio';
 return <form onSubmit={form.onSubmit(save)}><Stack gap="md">
  <Select label="Cómo funciona tu programa" data={[{value:'SPEND',label:'Puntos por importe de compra'},{value:'VISIT',label:'Puntos por visita'},{value:'ITEM',label:'Puntos por artículo'},{value:'DISCOUNT',label:'Descuento fijo para miembros (sin puntos)'},{value:'CASHBACK',label:'Cashback (gana % de cada compra como saldo)'},{value:'GIFT_CARD',label:'Tarjeta de regalo / monedero recargable'},{value:'STAMP',label:'Tarjeta de sellos (compra N, llévate 1 gratis)'}]} allowDeselect={false} disabled={busy} {...form.getInputProps('program_type')}/>
  {isDiscount
   ?<NumberInput label="Descuento para miembros (%)" min={1} max={100} decimalScale={0} allowNegative={false} disabled={busy} {...form.getInputProps('percent_off')}/>
   :isCashback
   ?<NumberInput label="Cashback para miembros (%)" min={1} max={100} decimalScale={0} allowNegative={false} disabled={busy} {...form.getInputProps('cashback_percent')}/>
   :isGiftCard
   ?<NumberInput label="Bono de recarga (%)" description="Opcional. Con 10%, una recarga de 100 deja 110 de saldo. Deja 0 para no dar bono." min={0} max={100} decimalScale={0} allowNegative={false} disabled={busy} {...form.getInputProps('load_bonus_percent')}/>
   :isStamp
   ?<Stack gap="sm">
     <NumberInput label="Sellos para completar la tarjeta" min={2} max={100} decimalScale={0} allowNegative={false} disabled={busy} {...form.getInputProps('stamps_required')}/>
     <NumberInput label="Sellos de regalo al empezar" description="Casillas ya marcadas como regalo. Con 2 de regalo en una tarjeta de 10, el miembro necesita 8 compras." min={0} max={99} decimalScale={0} allowNegative={false} disabled={busy} {...form.getInputProps('head_start')}/>
     <TextInput label="Premio al completar" placeholder="Café gratis" disabled={busy} {...form.getInputProps('reward_label')}/>
     <Select label="Un sello por" allowDeselect={false} data={[{value:'visit',label:'Visita'},{value:'item',label:'Artículo'}]} disabled={busy} {...form.getInputProps('stamp_unit')}/>
    </Stack>
   :<NumberInput label={`Puntos por ${unit}`} min={0.0001} max={10000} decimalScale={form.values.program_type==='SPEND'?4:0} allowNegative={false} disabled={busy} {...form.getInputProps('rate')}/>}
  {form.values.program_type==='SPEND'&&<Select label="Redondeo de puntos" allowDeselect={false} data={[{value:'ceil',label:'Hacia arriba'},{value:'round',label:'Al entero más cercano'},{value:'floor',label:'Hacia abajo'}]} disabled={busy} {...form.getInputProps('round')}/>}
  {isDiscount
   ?<div className="launch-example"><NumberInput label={`Compra de ejemplo (${merchantRegion().currency})`} min={0} max={100000} decimalScale={merchantRegion().minorUnits} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{sampleDiscount==null?'—':`${merchantRegion().currency} ${number(sampleDiscount)}`} de descuento</Text><Text size="sm" c="dimmed">El miembro paga menos en cada compra. Un programa de descuento no otorga puntos.</Text></div>
   :isCashback
   ?<div className="launch-example"><NumberInput label={`Compra de ejemplo (${merchantRegion().currency})`} min={0} max={100000} decimalScale={merchantRegion().minorUnits} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{sampleCashback==null?'—':`${merchantRegion().currency} ${number(sampleCashback)}`} de cashback</Text><Text size="sm" c="dimmed">El miembro acumula saldo para usar después. Un programa de cashback no otorga puntos.</Text></div>
   :isGiftCard
   ?<div className="launch-example"><NumberInput label={`Recarga de ejemplo (${merchantRegion().currency})`} min={0} max={100000} decimalScale={merchantRegion().minorUnits} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{sampleGiftBonus==null?'—':sampleGiftBonus>0?`+${merchantRegion().currency} ${number(sampleGiftBonus)} de bono`:'Sin bono'}</Text><Text size="sm" c="dimmed">El miembro recarga saldo para gastar después y puede regalarlo a otro miembro. Una tarjeta de regalo no otorga puntos.</Text></div>
   :isStamp
   ?<div className="launch-example">{card?<><Text fw={600} role="status" style={{letterSpacing:'0.18em',fontSize:'1.2rem'}}>{'●'.repeat(card.head_start)+'○'.repeat(card.purchases_required)}</Text><Text size="sm" mt="xs">{card.head_start>0?`Empieza con ${card.head_start} ${card.head_start===1?'sello de regalo':'sellos de regalo'}. `:''}El miembro necesita {card.purchases_required} {card.purchases_required===1?'compra':'compras'} para {prize}.</Text><Text size="sm" c="dimmed">Una tarjeta de sellos no otorga puntos; el premio se canjea al completarla.</Text></>:<Text size="sm" c="dimmed">Define los sellos y el premio para ver la tarjeta.</Text>}</div>
   :<div className="launch-example"><NumberInput label={form.values.program_type==='SPEND'?`Compra de ejemplo (${merchantRegion().currency})`:form.values.program_type==='VISIT'?'Visitas de ejemplo':'Artículos de ejemplo'} min={form.values.program_type==='SPEND'?0:1} max={100000} decimalScale={form.values.program_type==='SPEND'?merchantRegion().minorUnits:0} value={quantity} onChange={setQuantity}/><Text mt="sm" fw={600} role="status">{number(basePointsPreview(form.values,typeof quantity==='number'?quantity:Number(quantity)))} puntos base</Text><Text size="sm" c="dimmed">Ejemplo antes de bonos, niveles y límites. Los puntos pueden quedar pendientes según tu política de liberación.</Text></div>}
  <Text size="sm">Guardar cambia las compras futuras; conserva saldos, campañas, automatizaciones e integraciones existentes.</Text>
  {error&&<Alert color="red" role="alert">{error}</Alert>}{saved&&<Text role="status">Regla guardada.</Text>}
  <Group><Button type="submit" loading={busy} disabled={!dirty}>{isDiscount?'Guardar descuento':isCashback?'Guardar cashback':isGiftCard?'Guardar tarjeta de regalo':isStamp?'Guardar tarjeta de sellos':'Guardar regla de puntos'}</Button><Anchor href="#limites">Límites y configuración avanzada</Anchor></Group>
 </Stack></form>;
}
