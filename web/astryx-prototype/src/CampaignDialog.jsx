import React,{useState} from 'react';
import {Dialog,DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack,HStack,Button,TextInput,Slider,Switch,Badge,money} from './ui';

export default function CampaignDialog({open,onClose,onSave}){
 const [name,setName]=useState('Un buen motivo para volver');
 const [limit,setLimit]=useState(20);
 const [exclude,setExclude]=useState(true);
 const [error,setError]=useState(false);
 const [saving,setSaving]=useState(false);
 const audience=exclude?12:16;
 const cost=Math.min(limit,audience)*8;
 async function save(){
  if(!name.trim()){setError(true);return;}
  setSaving(true);
  await new Promise(resolve=>setTimeout(resolve,650));
  onSave({name:name.trim(),limit,audience,cost});setSaving(false);onClose();
 }
 return <Dialog isOpen={open} onOpenChange={value=>{if(!value&&!saving)onClose();}} width={540} purpose="form">
   <DialogHeader title="Preparar una invitación" subtitle="Simulación: no se enviarán mensajes ni se emitirán recompensas." onOpenChange={()=>!saving&&onClose()}/>
   <VStack gap={6} padding={6}>
    <TextInput label="Nombre de la campaña" value={name} onChange={v=>{setName(v);setError(false);}} status={error?{type:'error',message:'Escribe un nombre para identificar la campaña.'}:undefined}/>
    <Slider label="Límite de recompensas" value={limit} onChange={setLimit} min={5} max={50} step={5} valueDisplay="text"/>
    <Switch label="Evitar mensajes repetidos" description="Excluye a quienes ya recibieron una promoción esta semana." value={exclude} onChange={setExclude}/>
    <VStack className="budget-summary" gap={3} padding={5}><HStack hAlign="between"><span>Clientes de ejemplo elegibles</span><strong>{audience}</strong></HStack><HStack hAlign="between"><span>Costo directo máximo estimado</span><strong>{money(cost)}</strong></HStack><p>Ejemplo con un costo ingresado de Q8 por recompensa. No incluye otros costos ni estima ventas futuras.</p><Badge label="Se conservan las recompensas ya emitidas" variant="success"/></VStack>
    <HStack gap={3} hAlign="end"><Button label="Cancelar" onClick={onClose} isDisabled={saving}/><Button label="Guardar simulación" variant="primary" onClick={save} isLoading={saving}/></HStack>
   </VStack>
 </Dialog>;
}
