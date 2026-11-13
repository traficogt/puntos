import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Group,List,NativeSelect,NumberInput,Stack,Text,Title} from '@mantine/core';
import {api,useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
const labels={signup:'Inscripción ficticia',ineligibility:'Intento no elegible',earn:'Compra ficticia',unlock:'Recompensa desbloqueada',redeem:'Canje ficticio',refund:'Devolución ficticia'};
export default function LaunchPractice({onComplete}){
 const base='/api/admin/service-operations/rehearsal',[revision,setRevision]=useState(0),resource=useResource(base,revision),[saved,setSaved]=useState(null),[quantity,setQuantity]=useState(1),[rewardId,setRewardId]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const pending=useRef(null),session=saved??resource.data?.session,state=session?.state,config=state?.config??resource.data?.config,rewards=config?.rewards??[],selected=rewardId||rewards.find(r=>r.active&&r.available)?.id||rewards[0]?.id||'';
 useEffect(()=>{onComplete?.(!!state?.complete&&resource.data?.current!==false);},[state?.complete,resource.data?.current,onComplete]);
 async function act(action){if(busy)return;setBusy(action);setError('');const input=action==='start'?{}:{version:session.version,action,...(['ineligibility','unlock','redeem'].includes(action)?{rewardId:selected}:{}),...(action==='earn'?{quantity}:{})},key=JSON.stringify([session?.id,action,input]);if(pending.current?.key!==key)pending.current={key,requestId:crypto.randomUUID()};
  try{const result=await api(action==='start'?base:`${base}/${session.id}/step`,{method:'POST',body:JSON.stringify({...input,requestId:pending.current.requestId})});pending.current=null;setSaved(result.session);if(action==='start')setRevision(v=>v+1);}catch(e){setError(e.message);}finally{setBusy('');}}
 if(resource.loading&&!session)return <Loading label="Consultando tu práctica guardada…"/>;
 if(resource.error&&!session)return <Failure error={resource.error} retry={()=>setRevision(v=>v+1)}/>;
 return <section aria-labelledby="launch-practice-title"><Stack gap="md">
  <div><Title order={3} id="launch-practice-title">Ensaya el recorrido completo</Title><Text mt="sm">Cliente ficticio desde cero. La práctica y su avance quedan guardados para tu usuario; no cambian clientes, puntos reales ni existencias.</Text></div>
  {!!resource.data?.readiness?.blockers.length&&<Alert color="yellow" title="Antes de lanzar"><List>{resource.data.readiness.blockers.map(item=><List.Item key={item}>{item}</List.Item>)}</List></Alert>}
  <Text size="sm" c="dimmed">Usa la regla, recompensa, sucursal y disponibilidad guardadas. Bonos personalizados, caja, Wallet y mensajes requieren una prueba física aparte.</Text>
  {resource.data?.current===false&&<Alert color="yellow">La configuración cambió después de esta práctica. Inicia otra para comprobar las nuevas condiciones.</Alert>}
  {error&&<Alert color="red" role="alert">{error}<Button variant="subtle" onClick={()=>{setSaved(null);setRevision(v=>v+1);}}>Recargar práctica</Button></Alert>}
  {!session?<Button onClick={()=>act('start')} loading={busy==='start'} w="fit-content">Iniciar práctica guardada</Button>:<>
   <Text fw={600} aria-live="polite">Cliente ficticio · {number(state.points)} puntos · versión {session.version}</Text>
   <NativeSelect label="Recompensa de práctica" value={selected} onChange={e=>setRewardId(e.currentTarget.value)} data={rewards.map(r=>({value:r.id,label:`${r.name} · ${number(r.points_cost)} puntos${!r.available||r.stock===0?' · no disponible':''}`}))} disabled={!!busy}/>
   {!state.signed_up?<Button onClick={()=>act('signup')} disabled={!!busy} w="fit-content">Simular inscripción</Button>:<>
    <Button variant="outline" onClick={()=>act('ineligibility')} disabled={!!busy||!selected} w="fit-content">Comprobar intento no elegible</Button>
    <Text size="sm">Antes de ganar puntos, comprueba el rechazo por saldo insuficiente. También puedes elegir una recompensa no disponible.</Text>
    <Group align="end"><NumberInput label={config.program_type==='SPEND'?'Importe de compra ficticia':config.program_type==='VISIT'?'Visitas ficticias':'Artículos ficticios'} min={config.program_type==='SPEND'?0.01:1} max={1000000} allowDecimal={config.program_type==='SPEND'} value={quantity} onChange={setQuantity}/><Button variant="outline" onClick={()=>act('earn')} disabled={!!busy}>Registrar compra ficticia</Button></Group>
    <Group><Button variant="outline" onClick={()=>act('unlock')} disabled={!!busy||!selected}>Comprobar desbloqueo</Button><Button variant="outline" onClick={()=>act('redeem')} disabled={!!busy||!state.unlocked.includes(selected)||!!state.redemption}>Canjear en práctica</Button><Button variant="outline" onClick={()=>act('refund')} disabled={!!busy||!state.redemption}>Devolver canje ficticio</Button></Group>
   </>}
   {!!state.history.length&&<List spacing="xs">{state.history.map((item,index)=><List.Item key={index}>{labels[item.action]}{item.outcome!=='completed'?` · ${item.outcome==='insufficient_points'?'saldo insuficiente':'no disponible según la configuración'}`:item.points?` · ${number(item.points)} puntos`:''}</List.Item>)}</List>}
   {state.complete&&<Text fw={600} role="status">Recorrido ficticio completo guardado: inscripción, rechazo, compra, desbloqueo, canje y devolución.</Text>}
   <Button variant="subtle" onClick={()=>act('start')} disabled={!!busy} w="fit-content">Iniciar otra práctica</Button>
  </>}
 </Stack></section>;
}
