import {merchantRegion} from './region.js';
import SecondVisitControls from "./SecondVisitControls.jsx";
import WeeklyOwnerBrief from "./WeeklyOwnerBrief.jsx";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useForm} from '@mantine/form';
import {Alert,Badge,Button,Fieldset,Group,NumberInput,Progress,Select,SimpleGrid,Stack,Switch,Table,Text,Title} from '@mantine/core';
import {api,useResource,isDemo} from './api.js';
import {Failure,Loading,Locked,number,periodDate} from './ui.jsx';
const noop=()=>{};
const titles={birthday:'Cumpleaños',winback:'Recuperar clientes'};
const statuses={queued:'En cola',processing:'En proceso',accepted:'Aceptado por el proveedor',failed:'Falló el envío',uncertain:'Entrega incierta',suppressed:'No enviado'};
const reasons={automation_paused:'Automatización pausada',consent_revoked:'Cliente retiró su consentimiento',customer_unavailable:'Cliente no disponible',message_expired:'Mensaje vencido',frequency_cap:'Límite de frecuencia',quiet_hours:'Fuera del horario de envío',plan_unavailable:'Plan sin acceso',provider_rejected:'Proveedor rechazó el envío',delivery_uncertain:'Sin respuesta concluyente; no se reenvía',processing_lease_expired:'Proceso interrumpido; no se reenvía',dispatch_suppressed:'No cumplía los requisitos al enviar'};
export default function Automations({features,onDirty=noop,focusSection=null}) {
  useEffect(()=>{
    if(!['owner-brief','second-visit'].includes(focusSection))return;
    const id=focusSection+'-heading',container=document.getElementById('contenido')||document.body;
    let observer,resize,target;
    const stop=()=>{observer?.disconnect();resize?.disconnect();};
    const focus=()=>{target=document.getElementById(id);if(!target)return;observer?.disconnect();target.scrollIntoView({block:'start'});target.focus({preventScroll:true});resize=new ResizeObserver(()=>{if(document.activeElement===target)target.scrollIntoView({block:'start'});else stop();});resize.observe(container);};
    observer=new MutationObserver(focus);observer.observe(container,{childList:true,subtree:true});focus();
    container.addEventListener('pointerdown',stop,{once:true});container.addEventListener('wheel',stop,{once:true});container.addEventListener('keydown',stop,{once:true});
    return()=>{stop();container.removeEventListener('pointerdown',stop);container.removeEventListener('wheel',stop);container.removeEventListener('keydown',stop);};
  },[focusSection]);
  const [dirtyParts,setDirtyParts]=useState({});
  const markLegacy=useCallback(value=>setDirtyParts(old=>({...old,legacy:value})),[]),markSecond=useCallback(value=>setDirtyParts(old=>({...old,second:value})),[]),markBrief=useCallback(value=>setDirtyParts(old=>({...old,brief:value})),[]);
  useEffect(()=>{onDirty(Object.values(dirtyParts).some(Boolean));return()=>onDirty(false);},[dirtyParts,onDirty]);
  const [refresh,setRefresh]=useState(0),[saved,setSaved]=useState(false);
  const resource=useResource(features.lifecycle_automation?'/api/admin/automations':null,refresh);
  if(!features.lifecycle_automation)return <Locked feature="Automatizaciones"/>;
  return <Stack gap="xl">
    <div><Title order={1}>Un buen motivo para volver</Title><Text className="intro">Acompaña la segunda visita, celebra un cumpleaños y mantente al día con tu negocio. Tú apruebas cada regla y su presupuesto.</Text></div>
    {features.analytics&&features.campaign_rules&&<SecondVisitControls onDirty={markSecond}/>}
    {features.analytics&&<WeeklyOwnerBrief onDirty={markBrief}/>}
    <Title order={2}>Cumpleaños y recuperación</Title>
    {saved&&<Alert color="teal" title="Configuración guardada" role="status">Las reglas activas se prepararán en su próximo horario. Las reglas pausadas ya no preparan nuevos incentivos.</Alert>}
    {resource.loading?<Loading label="Cargando automatizaciones…"/>:resource.error?<Failure error={resource.error} retry={()=>setRefresh(x=>x+1)}/>:resource.data&&<AutomationEditor key={refresh} data={resource.data} onDirty={markLegacy} onSaved={()=>{setSaved(true);setRefresh(x=>x+1);}}/>}
  </Stack>;
}
function AutomationEditor({data,onDirty,onSaved}) {
  const form=useForm({initialValues:data.settings,validate:values=>{
    const errors={};
    for(const rule of ['birthday','winback']) {
      const points=values[`${rule}_points`],cap=values[`${rule}_monthly_points_cap`];
      if(!Number.isInteger(points)||points<0||points>10000)errors[`${rule}_points`]='Usa entre 0 y 10,000 puntos.';
      if(!Number.isInteger(cap)||cap<0||cap>2000000)errors[`${rule}_monthly_points_cap`]='Usa entre 0 y 2,000,000 puntos.';
      else if(values[`${rule}_enabled`]&&cap<points)errors[`${rule}_monthly_points_cap`]='El presupuesto debe cubrir al menos un incentivo.';
    }
    if(!Number.isInteger(values.winback_days)||values.winback_days<7||values.winback_days>365)errors.winback_days='Usa entre 7 y 365 días.';
    if(!Number.isInteger(values.minimum_contact_days)||values.minimum_contact_days<7||values.minimum_contact_days>90)errors.minimum_contact_days='Usa entre 7 y 90 días.';
    return errors;
  }});
  const [saving,setSaving]=useState(false),[error,setError]=useState('');const active=useRef(true);const dirty=form.isDirty();
  useEffect(()=>{active.current=true;return()=>{active.current=false;onDirty(false);};},[onDirty]);
  useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
  async function save(event) {
    event.preventDefault();if(form.validate().hasErrors)return;setSaving(true);setError('');
    try {await api('/api/admin/automations',{method:'PUT',body:JSON.stringify(form.values)});if(active.current){form.resetDirty();onDirty(false);onSaved();}}
    catch(e){if(active.current&&e.name!=='AbortError')setError(e.message||'No se guardaron los cambios. Inténtalo de nuevo.');}
    finally {if(active.current)setSaving(false);}
  }
  return <Stack gap="xl">
    {data.data_readiness?.inactivity_allowed===false&&<Alert color="yellow" title="Recuperación en espera">{data.data_readiness.summary} No se preparan nuevas invitaciones por inactividad mientras falten datos. Los cumpleaños siguen su propia regla.</Alert>}
    {data.promotion_pause&&<Alert color="blue" title="Invitaciones en pausa">La pausa temporal del negocio retrasa los mensajes pendientes. Los puntos ya otorgados se conservan. Puedes revisarla en Decisiones.</Alert>}
    {!data.provider_ready&&<Alert color="yellow" title="Mensajería sin configurar">Los incentivos activos pueden abonar puntos, pero no podrán avisar al cliente hasta conectar un proveedor. Mantén las reglas pausadas si prefieres esperar.</Alert>}
    <Alert color="blue" title="Solo clientes que aceptaron promociones">Se requiere consentimiento y un teléfono disponible. Los puntos se abonan al preparar el incentivo; un mensaje fallido, pausado o no entregado no revierte ese abono. Los envíos respetan el horario de 9:00 a 18:00 en {data.timezone} y el límite compartido con tus campañas.</Alert>
    <form onSubmit={save}>
      <Stack gap="lg">
        <SimpleGrid cols={{base:1,lg:2}} spacing="lg">
          {['birthday','winback'].map(rule=><Fieldset key={rule} legend={titles[rule]} disabled={saving}>
            <Stack gap="md">
              <Switch label={`Activar ${rule==='birthday'?'cumpleaños':'recuperación'}`} description="Se aplica cuando guardas los cambios." {...form.getInputProps(`${rule}_enabled`,{type:'checkbox'})}/>
              <Text size="sm" c="dimmed">{rule==='birthday'?'En el día de cumpleaños registrado por el cliente.':'En el día en que se cumple el plazo desde la última actividad registrada. Compras y canjes cuentan como actividad. No recupera días anteriores.'}</Text>
              {rule==='winback'&&<NumberInput label="Días sin actividad" min={7} max={365} allowDecimal={false} {...form.getInputProps('winback_days')}/>}
              <NumberInput label={`Puntos por ${rule==='birthday'?'cumpleaños':'invitación'}`} description="0 envía solo el saludo, sin puntos adicionales." min={0} max={10000} allowDecimal={false} {...form.getInputProps(`${rule}_points`)}/>
              <NumberInput label={`Presupuesto mensual de ${rule==='birthday'?'cumpleaños':'recuperación'}`} description="En puntos. Al agotarse, no se preparan más incentivos de esta regla." min={0} max={2000000} allowDecimal={false} {...form.getInputProps(`${rule}_monthly_points_cap`)}/>
              <Text size="sm">Mensaje: {rule==='birthday'?'«¡Feliz cumpleaños!»':'«Te extrañamos. Nos encantará verte de nuevo.»'}{Number(form.values[`${rule}_points`])>0?` Se informa al cliente que ya recibió ${number(form.values[`${rule}_points`])} puntos.`:' Se invita a consultar sus beneficios.'}</Text>
            </Stack>
          </Fieldset>)}
        </SimpleGrid>
        <Fieldset legend="Horario y frecuencia" disabled={saving}>
          <SimpleGrid cols={{base:1,sm:2}}>
            <Select label="Preparar incentivos a partir de" description={`Hora de ${data.timezone}. Se procesan durante esta hora, sin repetir el mismo evento.`} data={Array.from({length:9},(_,i)=>({value:String(i+9),label:`${String(i+9).padStart(2,'0')}:00`}))} value={String(form.values.scheduler_hour_local)} onChange={value=>form.setFieldValue('scheduler_hour_local',Number(value))} allowDeselect={false}/>
            <NumberInput label="Días mínimos entre mensajes" description="Compartido con ofertas de campañas. Los mensajes de estas reglas vencen a las 48 horas; si el límite no permite enviarlos, se omiten." min={7} max={90} allowDecimal={false} {...form.getInputProps('minimum_contact_days')}/>
          </SimpleGrid>
        </Fieldset>
        <Text size="sm" c="dimmed">El presupuesto vuelve a estar disponible al comenzar el siguiente mes en {data.timezone}. Los reembolsos y las bajas de clientes no lo reponen. Pausar cancela los mensajes en cola; un envío ya aceptado no se puede retirar.</Text>
        {error&&<Alert color="red" role="alert" title="No se guardaron los cambios">{error}</Alert>}
        <Group><Button type="submit" loading={saving} disabled={!dirty}>{isDemo?'Guardar en demostración':'Guardar y aplicar'}</Button>{dirty&&<Text size="sm" role="status">Cambios sin guardar</Text>}</Group>
      </Stack>
    </form>
    <section aria-labelledby="automation-preview-title">
      <Title order={2} id="automation-preview-title">Hoy, con la configuración guardada</Title>
      <Text c="dimmed" size="sm" mb="md">Vista previa de candidatos, antes de aplicar el horario y los límites de envío. No garantiza que todos reciban un mensaje.</Text>
      <SimpleGrid cols={{base:1,sm:2}}>
        {['birthday','winback'].map(rule=>{const row=data.rules[rule],cap=data.settings[`${rule}_monthly_points_cap`];return <Stack key={rule} className="panel" gap="xs">
          <Group justify="space-between"><Title order={3}>{titles[rule]}</Title><Badge color={data.settings[`${rule}_enabled`]?'teal.9':'gray.8'}>{data.settings[`${rule}_enabled`]?'Activa':'Pausada'}</Badge></Group>
          <Text>{number(row.candidates)} cumplen la fecha · {number(row.consented)} con consentimiento y teléfono</Text>
          <Text fw={600}>Hasta {number(row.available_awards)} incentivos pendientes dentro del presupuesto</Text>
          <Progress value={cap?Math.min(100,100*row.points_committed/cap):0} aria-label={`Presupuesto usado de ${titles[rule]}`}/>
          <Text size="sm">{number(row.points_committed)} de {number(cap)} puntos comprometidos este mes · {number(row.monthly_awards)} incentivos preparados</Text>
        </Stack>;})}
      </SimpleGrid>
    </section>
    <section aria-labelledby="automation-results-title">
      <Group justify="space-between" mb="sm"><Title order={2} id="automation-results-title">Ejecuciones y mensajes</Title><Text size="sm" c="dimmed">Últimos 30 días</Text></Group>
      <Group gap="md" mb="md">{Object.entries(data.counts).map(([status,count])=><Text key={status} size="sm"><strong>{number(count)}</strong> {statuses[status]}</Text>)}</Group>
      <Text size="sm" mb="md">{data.delivery_note}</Text>
      {!data.history.length?<Text c="dimmed">Todavía no hay ejecuciones. Guarda una regla activa para que se prepare en su próximo horario.</Text>:<Table.ScrollContainer minWidth={640} type="native" tabIndex={0} role="region" aria-label="Historial de automatizaciones"><Table><Table.Thead><Table.Tr><Table.Th>Fecha</Table.Th><Table.Th>Regla</Table.Th><Table.Th>Puntos abonados</Table.Th><Table.Th>Mensaje</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.history.map((row,index)=><Table.Tr key={`${row.created_at}-${index}`}><Table.Td>{periodDate(row.created_at,data.timezone)}</Table.Td><Table.Td>{titles[row.rule]}</Table.Td><Table.Td>{number(row.points)}</Table.Td><Table.Td><Text size="sm">{statuses[row.status]}</Text>{row.reason&&<Text size="xs" c="dimmed">{reasons[row.reason]||'Consulta el estado de la operación.'}</Text>}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
      <Text size="xs" c="dimmed" mt="sm">Se muestran las últimas 30 ejecuciones disponibles. Los registros de clientes eliminados se retiran; el presupuesto comprometido se conserva.</Text>
    </section>
  </Stack>;
}
