import { useEffect, useState } from 'react';
import { Alert, NumberInput, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { api } from './api.js';
import { number } from './ui.jsx';
import { measurementPlanInput } from './campaign-measurement-inputs.js';
export function PlanningSummary({ planning:p, preparing=false }) {
 if(!p)return null;
 const required=p.required_total ?? p.required_total_members, available=p.available_members;
 return <Stack gap="xs"><Text size="sm">Regreso habitual supuesto: {number(p.baseline_return_rate_pct)}%. Mejora mínima prevista: {number(p.minimum_detectable_lift_pp)} puntos porcentuales. Son estimaciones previas del negocio.</Text><Text>Participantes necesarios según los supuestos: <strong>{required==null?'No calculado':number(required)}</strong>. Disponibles: <strong>{available==null?'Selecciona una audiencia':number(available)}</strong>.</Text>
 {p.required_treatment!=null&&<Text size="sm">Muestra necesaria: {number(p.required_treatment)} con oferta y {number(p.required_control)} sin oferta.</Text>}
 {p.feasible===false&&<Alert color="yellow" title="La audiencia puede ser insuficiente">{preparing?'Puedes guardar la campaña, pero quizá no permita distinguir la mejora que buscas. Considera ampliar la audiencia o aceptar un resultado inconcluso.':'Los participantes disponibles no alcanzan la muestra prevista. Conserva esta limitación al interpretar el resultado y planifica una nueva prueba si necesitas mayor precisión.'} No cambies la meta después de ver los resultados.</Alert>}
 <Text size="sm" c="dimmed">Plan aproximado con 80% de potencia y 95% de confianza para una comparación de regreso entre grupos independientes. No garantiza un resultado. {p.note}</Text></Stack>;
}
export default function CampaignMeasurementPlan({ form, availableMembers, disabled }) {
 const input=measurementPlanInput(form.values,availableMembers), signature=input?JSON.stringify(input):null;
 const [state,setState]=useState({signature:null,planning:null,error:'',loading:false});
 useEffect(()=>{
  if(!signature)return;
  const controller=new AbortController();setState({signature,planning:null,error:'',loading:true});
  const timer=setTimeout(async()=>{try{const out=await api('/api/admin/growth-campaigns/measurement-plan',{method:'POST',body:signature,signal:controller.signal});if(!controller.signal.aborted)setState({signature,planning:out.planning,error:'',loading:false});}catch(e){if(!controller.signal.aborted)setState({signature,planning:null,error:e.message||'No se pudo calcular la muestra. Revisa la conexión y vuelve a cambiar un campo.',loading:false});}},350);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[signature]);
 const current=state.signature===signature?state:null;
 return <section aria-labelledby="growth-measurement-plan"><Stack gap="md"><div><Title order={3} id="growth-measurement-plan">Plan de medición</Title><Text size="sm" mt="xs">Define los supuestos antes de activar. La vigencia de la oferta y el seguimiento son ventanas distintas; estos valores quedarán guardados con la campaña.</Text></div>
 <SimpleGrid cols={{base:1,sm:2}}>
  <NumberInput label="Regreso habitual supuesto (%)" description="Estimación del negocio; no es una tasa histórica calculada por PF." min={1} max={95} decimalScale={1} required disabled={disabled} {...form.getInputProps('measurement_plan.baseline_return_rate_pct')} />
  <NumberInput label="Mejora mínima que quieres detectar (puntos porcentuales)" description="Por ejemplo, pasar de 30% a 40% equivale a 10 puntos." min={0.1} max={50} decimalScale={1} required disabled={disabled} {...form.getInputProps('measurement_plan.minimum_detectable_lift_pp')} />
  <NumberInput label="Observación total desde la activación (días)" description="Incluye la oferta y el seguimiento posterior, hasta 180 días." min={Number(form.values.duration_days)} max={180} allowDecimal={false} required disabled={disabled} {...form.getInputProps('measurement_plan.observation_days')} />
  <NumberInput label="Plazo adicional de conciliación (días)" description="Espera por compras tardías y devoluciones; no amplía la ventana de compras." min={0} max={30} allowDecimal={false} required disabled={disabled} {...form.getInputProps('measurement_plan.reconciliation_days')} />
 </SimpleGrid>
 {!signature?<Text size="sm" c="red" role="status">Revisa los supuestos: regreso y mejora deben sumar menos de 100%; la observación debe cubrir la oferta.</Text>:current?.error?<Alert color="yellow" role="alert">{current.error}</Alert>:current?.planning?<PlanningSummary planning={current.planning} preparing/>:<Text size="sm" role="status">Calculando participantes necesarios…</Text>}
 </Stack></section>;
}
