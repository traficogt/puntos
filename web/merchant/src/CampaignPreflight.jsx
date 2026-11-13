import CollisionPreview from './CollisionPreview.jsx';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { api } from './api.js';
import { Failure, Loading, number } from './ui.jsx';
import { merchantRegion } from './region.js';
import { preflightCostEstimate } from './offer-cost-model.js';
export default function CampaignPreflight({ campaign, busy, onActivate, onPending }) {
  const [state,setState]=useState(null), [revision,setRevision]=useState(0), [checked,setChecked]=useState(false), [expired,setExpired]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{
    const controller=new AbortController(), current=++generation.current;
    setState(null); setChecked(false); setExpired(false);
    api(`/api/admin/growth-campaigns/${campaign.id}/preflight`,{method:'POST',body:'{}',signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted&&current===generation.current)setState({data:data.preflight});})
      .catch(error=>{if(!controller.signal.aborted)setState({error});});
    return()=>controller.abort();
  },[campaign.id,revision]);
  useEffect(()=>{ if(!state?.data?.expires_at)return;const timer=setTimeout(()=>{setExpired(true);setChecked(false);},Math.max(0,Date.parse(state.data.expires_at)-Date.now()));return()=>clearTimeout(timer); },[state]);
  useEffect(()=>{onPending(checked);return()=>onPending(false);},[checked,onPending]);
  const p=state?.data, quiet=campaign.offer_kind==='quiet';
  const region=merchantRegion(),currency=p?.currency||region.currency;
  const money=new Intl.NumberFormat(region.locale,{style:'currency',currency});
  const cost=preflightCostEstimate(p,money.resolvedOptions().maximumFractionDigits);
  return <section aria-labelledby="campaign-preflight-heading"><Stack gap="md">
    <Group justify="space-between"><Title order={3} id="campaign-preflight-heading">Comprobar antes de activar</Title><Button variant="subtle" disabled={busy||!state} onClick={()=>setRevision(value=>value+1)}>Actualizar comprobación</Button></Group>
    {!state?<Loading label="Comprobando términos y participantes…"/>:state.error?<Failure error={state.error} retry={()=>setRevision(value=>value+1)}/>:p&&<>
      <SimpleGrid cols={{base:1,sm:2}}><div><Text fw={600}>Compromiso máximo</Text><Text>{number(p.maximum_commitment_points)} puntos extra · hasta {number(Math.floor(p.maximum_commitment_points/campaign.bonus_points))} bonos completos</Text><Text size="sm">{campaign.points_budget==null?'Sin límite adicional de puntos; una bonificación por cliente asignado.':`Límite guardado: ${number(campaign.points_budget)} puntos extra. La audiencia y los bonos completos pueden reducir el máximo.`}</Text><Text size="sm">Estimación si se canjean todos los puntos extra: {cost===null?'Desconocido; falta el costo por punto':money.format(cost)}. Excluye puntos normales, descuentos externos, mensajes y operación.</Text><Text size="sm" c="dimmed">El servidor controla el límite de puntos. El importe se redondea hacia arriba a la unidad mínima de {currency}. Esta estimación en dinero no garantiza el costo real; un escenario de canje menor no reduce el compromiso que apruebas.</Text></div>
        <div><Text fw={600}>Participantes</Text><Text>{number(p.treatment_count)} con oferta{!quiet&&` · ${number(p.control_count)} para comparación`}</Text><Text size="sm">Hasta {number(p.contacts?.eligible_now)} de la lista completa tienen permiso, teléfono y frecuencia disponible ahora. Los mensajes vuelven a comprobarlo.</Text></div></SimpleGrid>
      <Text size="sm">Solo un bono dirigido por compra, el que vence primero. Se suma a los puntos normales del programa. Máximo bono dirigido coincidente: {number(p.stacking?.maximum_targeted_bonus_per_purchase)} puntos.</Text>
      <Text size="sm">Límite total por compra: {p.stacking?.maximum_total_points_per_purchase==null?'depende de la compra y las reglas; no hay un máximo configurado':`${number(p.stacking.maximum_total_points_per_purchase)} puntos`}. Los descuentos externos son desconocidos.</Text>
      <Text size="sm">Sin permiso o teléfono válido: {number(p.contacts?.without_permission_or_phone)}. Con un contacto reciente: {number(p.contacts?.frequency_excluded)}. Separación mínima entre promociones: {number(p.contacts?.minimum_contact_days)} días.</Text>
      <Text size="sm">{p.data_readiness?.summary}</Text><Text size="sm" c="dimmed">Esta oferta concede puntos. No reserva premios ni garantiza existencias para canjearlos.</Text>
      {p.blockers?.map(item=><Alert key={item.code} color="red" role="alert">{item.message}</Alert>)}
      {p.warnings?.map(item=><Alert key={item.code} color="yellow">{item.message}</Alert>)}
      <CollisionPreview campaign={campaign}/>
      {expired&&<Alert color="yellow" role="status">La comprobación venció. Actualízala para revisar los datos actuales.</Alert>}
      <Checkbox label={`Apruebo estos términos y el compromiso máximo. La oferta durará ${quiet?`${campaign.duration_minutes} minutos`:`${campaign.duration_days} días`} desde la activación.`} checked={checked} disabled={busy||!p.can_activate||expired} onChange={event=>setChecked(event.currentTarget.checked)}/>
      <Text size="sm" c="dimmed">Activar aplica el bono a compras elegibles. Los mensajes se preparan por separado. Pausar o vencer no retira puntos ya otorgados.</Text>
      <Button w="fit-content" loading={busy} disabled={!checked||!p.can_activate||expired} onClick={()=>onActivate(p.id)}>Activar {quiet?'oferta breve':'campaña'}</Button>
    </>}
  </Stack></section>;
}
