import {useState} from 'react';
import {Alert,Button,Group,NativeSelect,NumberInput,Stack,Text,Title} from '@mantine/core';
import {createPracticeSession} from '../../../public/staff/service-briefing.js';
import {merchantRegion} from './region.js';
import {number} from './ui.jsx';

export default function LaunchPractice({program,rewards,onComplete}){
 const [{session,error}]=useState(()=>{
  try{
   const key={SPEND:'points_per_q',VISIT:'points_per_visit',ITEM:'points_per_item'}[program?.program_type];
   return {session:createPracticeSession({program_type:program?.program_type,program_json:{[key]:program?.rate,round:program?.round}},rewards)};
  }catch(cause){return {error:cause.message};}
 });
 const [snapshot,setSnapshot]=useState(()=>session?.snapshot()),[quantity,setQuantity]=useState(program?.program_type==='SPEND'?100:1),[rewardId,setRewardId]=useState(rewards[0]?.id??'');
 const [earned,setEarned]=useState(false),[redeemed,setRedeemed]=useState(false),[complete,setComplete]=useState(false),[notice,setNotice]=useState(''),[failure,setFailure]=useState('');
 if(error)return <Alert color="yellow">{error}</Alert>;
 function act(action){setFailure('');try{setNotice(action());setSnapshot(session.snapshot());}catch(cause){setFailure(cause.message);}}
 const type=program.program_type,label=type==='SPEND'?`Compra de práctica (${merchantRegion().currency})`:type==='VISIT'?'Visitas de práctica':'Artículos de práctica';
 return <section aria-labelledby="launch-practice-title"><Stack gap="md">
  <div><Title order={3} id="launch-practice-title">Ensaya antes de atender a un cliente</Title><Text size="sm" mt="sm">Practica una compra, un canje y su corrección con un cliente ficticio. Empieza con 200 puntos; los saldos, el inventario y el historial real no cambian.</Text></div>
  <Text size="sm" c="dimmed">Usa tu regla base guardada. No reproduce bonos, puntos pendientes, restricciones de clientes ni una prueba física de caja.</Text>
  <Text fw={600} aria-live="polite">Cliente ficticio · {number(snapshot.points)} puntos</Text>
  <form onSubmit={event=>{event.preventDefault();act(()=>{const points=session.earn({amount:quantity,visits:quantity,items:quantity});setEarned(true);return `Se registraron ${number(points)} puntos ficticios.`;});}}>
   <Group align="end"><NumberInput label={label} value={quantity} onChange={setQuantity} min={type==='SPEND'?0.01:1} max={1000000} decimalScale={type==='SPEND'?merchantRegion().minorUnits:0} allowNegative={false}/><Button type="submit" variant="outline">Registrar puntos ficticios</Button></Group>
  </form>
  <Group align="end"><NativeSelect label="Recompensa para practicar" value={rewardId} onChange={event=>setRewardId(event.currentTarget.value)} data={snapshot.rewards.map(reward=>({value:reward.id,label:`${reward.name} · ${number(reward.points_cost)} puntos`}))} disabled={!snapshot.rewards.length||!!snapshot.redemption} style={{flex:'1 1 240px',minWidth:0}}/><Button variant="outline" disabled={!snapshot.rewards.length||!!snapshot.redemption||!earned} onClick={()=>act(()=>{const points=session.redeem(rewardId);setRedeemed(true);return `Canje ficticio registrado por ${number(points)} puntos.`;})}>Canjear en práctica</Button></Group>
  {!earned&&<Text size="sm" c="dimmed">Primero registra una compra ficticia para recorrer los tres pasos.</Text>}
  {!snapshot.rewards.length&&<Text size="sm">Prepara una recompensa disponible para ensayar el canje. Puedes practicar la compra mientras tanto.</Text>}
  <Group><Button variant="outline" disabled={!snapshot.redemption} onClick={()=>act(()=>{const points=session.correct();if(earned&&redeemed){setComplete(true);onComplete?.(true);}return `Se restauraron ${number(points)} puntos ficticios.`;})}>Corregir canje ficticio</Button><Button variant="subtle" onClick={()=>act(()=>{session.reset();setEarned(false);setRedeemed(false);setComplete(false);onComplete?.(false);return 'Práctica reiniciada.';})}>Reiniciar práctica</Button></Group>
  {failure&&<Alert color="red" role="alert">{failure}</Alert>}{notice&&<Text size="sm" role="status">{notice}</Text>}
  {complete&&<Text fw={600}>Práctica ficticia completada en esta sesión.</Text>}
 </Stack></section>;
}
