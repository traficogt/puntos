import React,{useState} from 'react';
import {VStack,HStack,Heading,Button,Icon,Badge,Grid,TextInput,Switch,Slider,Selector,NumberInput,SampleNote,money,Collapsible} from './ui';
import RewardCard from './RewardCard';
import CampaignDialog from './CampaignDialog';

export default function Playground({notify}){
 const [name,setName]=useState('Casa Jacaranda');
 const [kind,setKind]=useState('retail');
 const [email,setEmail]=useState('');
 const [weekly,setWeekly]=useState(false);
 const [saved,setSaved]=useState(false);
 const [attempted,setAttempted]=useState(false);
 const [loading,setLoading]=useState(false);
 const [cap,setCap]=useState(25);
 const [cost,setCost]=useState(8);
 const [percentage,setPercentage]=useState(100);
 const [open,setOpen]=useState(false);
 const invalidEmail=weekly&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 async function save(e){e.preventDefault();setAttempted(true);setSaved(false);if(!name.trim()||invalidEmail)return;setLoading(true);await new Promise(r=>setTimeout(r,700));setLoading(false);setSaved(true);notify('Preferencias guardadas en esta demostración.');}
 return <main className="playground container" id="contenido">
  <VStack gap={4} className="playground-heading"><Heading level={1}>Tócalo. Cámbialo.<br/><em>Hazlo tuyo.</em></Heading><p>Componentes reales de Astryx, con el carácter de PuntosFieles. Prueba estados, formularios y pequeños flujos completos.</p><SampleNote/></VStack>
  <Grid columns={{minWidth:300,repeat:'fit'}} gap={6}>
   <VStack className="component-panel surface" gap={6} padding={6}><VStack gap={2}><Heading level={2}>Una recompensa más cerca.</Heading><p>Progreso que cambia con cada visita.</p></VStack><RewardCard/><HStack gap={2} wrap="wrap"><Badge label="ProgressBar"/><Badge label="Button"/><Badge label="Badge"/></HStack></VStack>
   <VStack as="form" onSubmit={save} className="component-panel surface" gap={5} padding={6}>
    <VStack gap={2}><Heading level={2}>Tu negocio, a tu manera.</Heading><p>Prueba la validación y el estado de guardado.</p></VStack>
    <TextInput label="Nombre del negocio" value={name} onChange={v=>{setName(v);setSaved(false);}} status={attempted&&!name.trim()?{type:'error',message:'Escribe el nombre de tu negocio.'}:undefined}/>
    <Selector label="Tipo de negocio" value={kind} onChange={setKind} options={[{value:'retail',label:'Comercio'},{value:'salon',label:'Salón de belleza'},{value:'gym',label:'Gimnasio'},{value:'service',label:'Servicios'},{value:'restaurant',label:'Restaurante'}]}/>
    <Switch label="Resumen semanal por correo" description="En este prototipo no se envían correos." value={weekly} onChange={setWeekly}/>
    {weekly&&<TextInput label="Correo del resumen" value={email} onChange={setEmail} placeholder="tu@negocio.com" status={attempted&&invalidEmail?{type:'error',message:'Escribe un correo válido, por ejemplo tu@negocio.com.'}:undefined}/>}
    <Button label="Guardar preferencias de ejemplo" type="submit" variant="primary" isLoading={loading}/>
    {saved&&<p className="success-message" role="status">Preferencias guardadas para {name}. No se modificó ninguna cuenta.</p>}
    <HStack gap={2} wrap="wrap"><Badge label="TextInput"/><Badge label="Selector"/><Badge label="Switch"/></HStack>
   </VStack>
   <VStack className="component-panel surface" gap={6} padding={6}>
    <VStack gap={2}><Heading level={2}>Ponle un límite.</Heading><p>Explora el costo de una recompensa antes de prometerla.</p></VStack>
    <Slider label="Recompensas disponibles" value={cap} onChange={setCap} min={5} max={100} step={5} valueDisplay="text"/>
    <NumberInput label="Costo directo por recompensa (Q)" value={cost} onChange={v=>setCost(v??0)} min={0} max={100} step={1}/>
    <Slider label="Escenario de canje" value={percentage} onChange={setPercentage} min={0} max={100} step={10} valueDisplay="text" formatValue={v=>`${v}%`}/>
    <VStack className="cost-total" gap={2}><span>Costo estimado en este escenario</span><strong aria-live="polite">{money(Math.ceil(cap*percentage/100)*cost)}</strong><small>{Math.ceil(cap*percentage/100)} recompensas a {money(cost)} cada una.</small></VStack>
    <p className="microcopy">Es un escenario con costos ingresados. No es un pronóstico ni una obligación contable.</p>
    <HStack gap={2} wrap="wrap"><Badge label="Slider"/><Badge label="NumberInput"/></HStack>
   </VStack>
  </Grid>
  <HStack className="flow-section" gap={8} wrap="wrap" vAlign="center"><VStack gap={3}><Heading level={2}>También los detalles.</Heading><p>Un diálogo que mantiene el foco. Una confirmación clara.<br/>Controles que funcionan con teclado.</p></VStack><HStack gap={3} wrap="wrap"><Button label="Abrir creador de campaña" onClick={()=>setOpen(true)} variant="primary"/><Button label="Probar confirmación" onClick={()=>notify('Todo listo. Esta es una confirmación de ejemplo.')}/><Button label="Acción no disponible" isDisabled tooltip="Ejemplo del estado deshabilitado"/></HStack></HStack>
  <Collapsible defaultIsOpen={false} trigger="¿Qué estamos probando aquí?" className="technical-note"><p>Astryx 0.7.16, React 19 y su tema neutral. La landing parte de la plantilla Side Gallery y el panel del patrón Dashboard. Botones, campos, pestañas, tablas, diálogos, barras de progreso y controles de selección son componentes de la biblioteca. La composición, la marca y los textos están adaptados a PF.</p><p>Todos los números y nombres son ilustrativos. Puedes recargar para restablecerlos. Este prototipo no guarda ni envía información a PF.</p></Collapsible>
  <CampaignDialog open={open} onClose={()=>setOpen(false)} onSave={()=>notify('Campaña simulada. No se enviaron invitaciones.')}/>
 </main>;
}
