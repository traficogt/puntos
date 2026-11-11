import {useEffect,useRef,useState} from 'react';
import {useForm} from '@mantine/form';
import {Alert,Anchor,Badge,Button,Group,Select,SimpleGrid,Stack,Switch,Text,TextInput,Title} from '@mantine/core';
import {api,useResource,isDemo} from './api.js';
import {Failure,Loading} from './ui.jsx';
import {regionalDate} from './region.js';
const base='/api/admin/automations/owner-brief';
const status={queued:'En cola',processing:'En proceso',accepted:'Aceptado por proveedor',failed:'Falló el envío',uncertain:'Entrega incierta',suppressed:'No enviado'};
export default function WeeklyOwnerBrief({onDirty}){
 const [version,setVersion]=useState(0),resource=useResource(base,version);
 return <section aria-labelledby="owner-brief-heading"><Stack gap="md"><Title order={2} id="owner-brief-heading" tabIndex={-1}>Tu resumen de la semana</Title><Text>Tres observaciones de tus registros, con enlaces para revisarlas. Recíbelas en el correo verificado de tu cuenta de propietario; tú eliges cuándo activar el envío.</Text>
 {resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={()=>setVersion(v=>v+1)}/>:<Editor key={version} data={resource.data} onDirty={onDirty} onSaved={()=>setVersion(v=>v+1)}/>}
 </Stack></section>;
}
function Editor({data,onDirty,onSaved}){
 const form=useForm({initialValues:{...data.settings,channel:data.channel??'email'}});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState(null),[previewBusy,setPreviewBusy]=useState(false),[verification,setVerification]=useState(data.verification),[token,setToken]=useState('');
 const requests=useRef({verification:null,test:null}),alive=useRef(true),dirty=form.isDirty(),emailChannel=form.values.channel==='email';
 const ready=emailChannel?data.email_verified:data.destination_ready,providerReady=emailChannel?data.email_provider_ready:data.provider_ready;
 const bindingNeedsSave=data.subscription_binding_current===false&&ready;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onDirty?.(dirty||busy);return()=>onDirty?.(false);},[dirty,busy,onDirty]);
 async function action(suffix,body,onSuccess){if(busy)return;setBusy(true);setError('');setNotice('');try{const out=await api(`${base}${suffix}`,{method:suffix?'POST':'PUT',body:JSON.stringify(body)});if(alive.current)onSuccess(out);}catch(e){if(alive.current)setError(e.message||'No se completó la solicitud. Puedes volver a intentarlo.');}finally{if(alive.current)setBusy(false);}}
 async function sample(){if(previewBusy)return;setPreviewBusy(true);setError('');try{const out=await api(`${base}/preview`,{method:'POST',body:'{}'});if(alive.current)setPreview(out);}catch(e){if(alive.current)setError(e.message||'No se pudo preparar la muestra.');}finally{if(alive.current)setPreviewBusy(false);}}
 function requestVerification(){requests.current.verification??=crypto.randomUUID();action('/email-verification/request',{request_id:requests.current.verification},out=>{setVerification({id:out.request_id,status:out.status});setNotice(`${status[out.status]||'Solicitud registrada'}. Revisa tu correo; aceptar el mensaje no confirma su entrega.`);requests.current.verification=null;});}
 function testSend(){requests.current.test??=crypto.randomUUID();action('/test',{request_id:requests.current.test},out=>{setNotice(`Prueba: ${status[out.status]||'solicitud registrada'}. Actualiza los estados para revisar el resultado. La prueba no activa el resumen semanal.`);requests.current.test=null;});}
 return <Stack gap="md">
  {data.channel==='phone'&&<Alert color="blue" title="Suscripción anterior por teléfono">Tu envío por teléfono sigue disponible. Puedes elegir correo y verificarlo antes de cambiar el destino.</Alert>}
  {emailChannel&&<Stack gap="sm"><Group><Text fw={600} style={{overflowWrap:'anywhere'}}>{data.email_destination||'Tu cuenta aún no tiene correo'}</Text><Badge variant="light" color="gray">{data.email_verified?'Correo verificado':'Verificación pendiente'}</Badge></Group>
   <Text size="sm">Usamos el correo de la cuenta con la que iniciaste sesión. Para cambiarlo, <Anchor underline="always" href="/soporte.html">contacta a soporte</Anchor>.</Text>
   {!data.email_verified&&<><Text size="sm">Verifica que puedes recibir correo antes de activar el resumen. La verificación por sí sola no lo activa.</Text><Button variant="default" w="fit-content" disabled={busy||!data.email_destination||!data.email_provider_ready} onClick={requestVerification}>{verification?'Solicitar otro código de verificación':'Enviar código a mi correo'}</Button>
    {verification&&<form onSubmit={event=>{event.preventDefault();action('/email-verification/confirm',{request_id:verification.id,token:token.trim()},onSaved);}}><Stack gap="xs"><TextInput label="Código del correo" description={isDemo?'Demostración: pega 43 letras «a». No se envían correos.':'Pega el código completo. Vence en 30 minutos y permite cinco intentos.'} value={token} onChange={event=>setToken(event.currentTarget.value)} autoComplete="one-time-code" disabled={busy}/><Button type="submit" w="fit-content" disabled={busy||token.trim().length!==43}>Verificar mi correo</Button></Stack></form>}
   </>}
  </Stack>}
  {!providerReady&&<Alert color="yellow" title="Correo saliente pendiente de configuración">{emailChannel?'El proveedor de correo todavía no está configurado.':'El proveedor de mensajes todavía no está configurado.'} Puedes preparar una muestra sin enviar. Un administrador debe completar la configuración antes del envío.</Alert>}
  {data.subscription_binding_current===false&&<Alert color="yellow" title="Actualiza el destinatario semanal">{ready?'El resumen guardado todavía no está vinculado al destino actual de tu cuenta. Guarda el resumen semanal para actualizarlo; no necesitas cambiar el día ni la hora.':'El resumen guardado todavía no está vinculado al destino actual de tu cuenta. Verifica tu correo y guarda el resumen semanal para actualizarlo.'} Enviar una prueba no actualiza este vínculo.</Alert>}
  {!data.recipient_is_current_owner&&<Alert color="blue">El resumen actual pertenece a otra cuenta de propietario. Al guardar, quedará vinculado a tu cuenta.</Alert>}
  <form onSubmit={form.onSubmit(values=>action('',values,onSaved))}><Stack gap="md">
   {data.channel==='phone'&&<Select label="Canal del resumen" data={[{value:'phone',label:'Teléfono actual'},{value:'email',label:'Correo de mi cuenta'}]} allowDeselect={false} disabled={busy} {...form.getInputProps('channel')}/>}
   <Switch label="Recibir resumen semanal" description={emailChannel?'Desactivado al comenzar. Solo se envía al correo verificado de un propietario activo.':`Destino actual: ${data.destination||'Sin teléfono válido'}.`} disabled={busy||(!ready&&!form.values.enabled)} {...form.getInputProps('enabled',{type:'checkbox'})}/>
   <SimpleGrid cols={{base:1,sm:2}}><Select label="Día del resumen" data={['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map((label,i)=>({value:String(i+1),label}))} value={String(form.values.weekday)} onChange={value=>form.setFieldValue('weekday',Number(value))} allowDeselect={false} disabled={busy}/>
    <Select label="Hora del resumen" description={`Zona del negocio: ${data.timezone}`} data={Array.from({length:9},(_,i)=>({value:String(i+9),label:`${String(i+9).padStart(2,'0')}:00`}))} value={String(form.values.hour)} onChange={value=>form.setFieldValue('hour',Number(value))} allowDeselect={false} disabled={busy}/></SimpleGrid>
   <Text size="sm" c="dimmed">Como máximo un resumen por semana, desde el próximo horario elegido. Los enlaces requieren iniciar sesión. Cambiar el correo de tu cuenta exige verificarlo otra vez y guardar este destino.</Text>
   <Group><Button type="submit" loading={busy} disabled={!dirty&&!bindingNeedsSave}>{isDemo?'Guardar resumen en demostración':'Guardar resumen semanal'}</Button><Button variant="default" loading={previewBusy} disabled={busy} onClick={sample}>Preparar muestra, sin enviar</Button></Group>
  </Stack></form>
  {data.email_verified&&<Stack gap="xs"><Button variant="default" w="fit-content" disabled={busy||!data.email_provider_ready} onClick={testSend}>{isDemo?'Simular prueba de correo':'Enviar prueba a mi correo'}</Button><Text size="sm" c="dimmed">Solo al solicitarla. Hasta dos pruebas por hora y cinco al día; se envía al correo verificado de tu cuenta.</Text></Stack>}
  {error&&<Alert color="red" role="alert">{error}</Alert>}{notice&&<Alert color="blue" role="status">{notice}</Alert>}
  {preview&&<Stack gap="md"><Title order={3}>Muestra del resumen · sin envío</Title>{preview.generated_at&&<Text size="sm" c="dimmed">Preparado: {regionalDate(preview.generated_at)} · Cada observación indica su propio período.</Text>}{preview.findings.map(f=><div key={f.key}><Text fw={600}>{f.title}</Text><Text size="sm">{f.text}</Text><Anchor underline="always" href={f.href}>{f.action}</Anchor></div>)}{preview.additional_count>0&&<Text size="sm">Hay {preview.additional_count} {preview.additional_count===1?'observación adicional':'observaciones adicionales'}. <Anchor underline="always" href={preview.inbox_href}>Revisar decisiones y seguimientos</Anchor></Text>}<Text size="sm" c="dimmed">{preview.note}</Text></Stack>}
  <Group justify="space-between"><Title order={3}>Estado de los resúmenes</Title><Button variant="subtle" disabled={busy||dirty} onClick={onSaved}>Actualizar estados del resumen</Button></Group>
  {!data.history?.length?<Text size="sm" c="dimmed">Todavía no hay envíos. Preparar una muestra no crea un envío.</Text>:<Stack gap="sm">{data.history.map(row=><Group key={row.id} justify="space-between" align="start"><div><Text size="sm">{row.kind==='test'?'Prueba solicitada':`Semana del ${String(row.period_start).slice(0,10)}`} · {row.channel==='email'?'correo':'teléfono'}</Text><Text size="xs" c="dimmed">{regionalDate(row.created_at)} · {row.attempts} de 3 intentos</Text></div><Badge variant="light" color="gray">{status[row.status]}</Badge>{row.status==='failed'&&row.attempts<3&&<Button size="compact-sm" variant="default" disabled={busy} onClick={()=>action(`/${row.id}/retry`,{},onSaved)}>Reintentar resumen</Button>}</Group>)}</Stack>}
  <Text size="sm" c="dimmed">Proveedor configurado no significa correo entregado. Aceptado por el proveedor tampoco confirma entrega. Un envío sin confirmación no se repite automáticamente; los fallos confirmados tienen hasta tres intentos.</Text>
 </Stack>;
}
