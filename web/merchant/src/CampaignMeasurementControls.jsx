import { NumberInput } from './inputs';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, SimpleGrid, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { api, isDemo, useResource } from './api.js';
import { Failure, Loading, money, number } from './ui.jsx';
import { merchantRegion, regionalDate } from './region.js';
import { measurementCostInput, measurementCostKeys } from './campaign-measurement-inputs.js';
const labels={gross_margin_pct:'Margen bruto estimado (%)',fulfillment_cost_q:'Costo de incentivos ya cumplidos',messaging_cost_q:'Costo de mensajes',other_cost_q:'Otros costos directos de la campaña',outstanding_reward_cost_q:'Costo estimado de incentivos pendientes'};
const formValues=costs=>({...Object.fromEntries(measurementCostKeys.map(key=>[key,costs?.[key]??''])),notes:costs?.notes??''});
export default function CampaignMeasurementControls({ campaign, results, onRefresh, onPending }) {
 const [historyVersion,setHistoryVersion]=useState(0);
 const [values,setValues]=useState(()=>formValues(results.costs)),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const alive=useRef(true),costRequest=useRef({signature:'',id:crypto.randomUUID()}),reportRequest=useRef(crypto.randomUUID());
 const dirty=JSON.stringify(values)!==JSON.stringify(formValues(results.costs));
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onPending(busy!==''||dirty);return()=>onPending(false);},[busy,dirty,onPending]);
 async function save(kind){
  if(busy)return;setError('');let body;
  try{if(kind==='costs'){body=measurementCostInput(values);const signature=JSON.stringify(body);if(costRequest.current.signature!==signature)costRequest.current={signature,id:crypto.randomUUID()};body.request_id=costRequest.current.id;}else body={request_id:reportRequest.current};}catch(e){setError(e.message);return;}
  setBusy(kind);
  try{await api(`/api/admin/growth-campaigns/${campaign.id}/measurement-${kind}`,{method:'POST',body:JSON.stringify(body)});if(alive.current){if(kind==='reports')reportRequest.current=crypto.randomUUID();onRefresh();}}
  catch(e){if(alive.current&&e.name!=='AbortError')setError(e.message||'No se pudo guardar. Reintenta con conexión.');}
  finally{if(alive.current)setBusy('');}
 }
 const revision=results.report_revision,latest=revision?.latest;
 const history=useResource(`/api/admin/growth-campaigns/${campaign.id}/measurement-reports`,`${latest?.revision??0}:${historyVersion}`);
 return <Stack gap="lg"><section aria-labelledby="growth-measurement-costs"><Stack gap="md"><div><Title order={3} id="growth-measurement-costs">Costos y margen de esta campaña</Title><Text size="sm" mt="xs">Estimaciones ingresadas por el negocio. Deja vacío lo desconocido; escribe 0 solo cuando confirmes que no hubo costo. Los incentivos incluyen únicamente lo que atribuyes a esta campaña.</Text></div>
 <form onSubmit={e=>{e.preventDefault();void save('costs');}}><Stack gap="md"><SimpleGrid cols={{base:1,sm:2}}>{measurementCostKeys.map(key=><NumberInput key={key} label={`${labels[key]}${key==='gross_margin_pct'?'':` (${merchantRegion().currency})`}`} description={key==='gross_margin_pct'?'Descuenta el costo habitual de la mercadería. Registra abajo solo costos adicionales de esta campaña, sin duplicarlos.':key==='fulfillment_cost_q'?'Premios entregados y otros incentivos: estimación directa, sin atribuir automáticamente puntos intercambiables.':key==='outstanding_reward_cost_q'?'Se muestra como escenario separado; no es un gasto confirmado.':undefined} value={values[key]} onChange={value=>setValues(current=>({...current,[key]:value}))} min={0} max={key==='gross_margin_pct'?100:999999999.99} decimalScale={key==='gross_margin_pct'?2:merchantRegion().minorUnits} disabled={Boolean(busy)} />)}</SimpleGrid>
 <Textarea label="Notas sobre las estimaciones" description="Origen, fecha o criterio usado para estos costos." maxLength={1000} autosize minRows={2} value={values.notes} onChange={e=>{const notes=e.currentTarget.value;setValues(current=>({...current,notes}));}} disabled={Boolean(busy)} />
 <Group><Button type="submit" variant="outline" loading={busy==='costs'} disabled={!dirty||(Boolean(busy)&&busy!=='costs')}>Guardar costos y margen</Button>{dirty&&<Button variant="subtle" disabled={Boolean(busy)} onClick={()=>{setValues(formValues(results.costs));setError('');}}>Descartar cambios de costos</Button>}{results.cost_updated_at&&<Text size="sm" c="dimmed">Guardados: {regionalDate(results.cost_updated_at)}</Text>}</Group></Stack></form>
 {error&&<Alert color="red" role="alert">{error}</Alert>}
 </Stack></section>
 <section aria-labelledby="growth-measurement-reports"><Stack gap="sm"><Title order={3} id="growth-measurement-reports">Cortes del informe</Title>
 <Text size="sm">Guardar un corte conserva los resultados y supuestos de ese momento. Consultar o actualizar esta pantalla no crea un corte. Las compras tardías y devoluciones pueden cambiar la lectura actual.</Text>
 {latest?<Text>Último corte guardado: revisión {latest.revision}, {regionalDate(latest.created_at)}.</Text>:<Text>Aún no hay un corte guardado para esta campaña.</Text>}
 {revision?.changed&&<Alert color="yellow" title="Los datos cambiaron desde el último corte">{revision.reason||'La lectura actual difiere del informe guardado. Revisa los cambios y guarda otro corte si lo necesitas.'}</Alert>}
 {latest&&!revision.changed&&<Text size="sm" c="dimmed">La lectura actual coincide con el último corte.</Text>}
 {dirty&&<Text size="sm">Guarda los costos antes de actualizar los resultados o guardar el informe.</Text>}
 <Group><Button variant="outline" onClick={()=>void save('reports')} loading={busy==='reports'} disabled={dirty||(Boolean(busy)&&busy!=='reports')}>Guardar corte del informe</Button><Button variant="subtle" onClick={onRefresh} disabled={Boolean(busy)||dirty}>Actualizar resultados</Button></Group>
 {history.loading?<Loading label="Cargando cortes guardados…"/>:history.error?<Failure error={history.error} retry={()=>setHistoryVersion(v=>v+1)}/>:history.data?.reports?.length>0&&<Stack gap="xs">{history.data.reports.map(report=><details key={report.revision}><summary>Revisión {report.revision} · {regionalDate(report.created_at)}</summary><Stack gap="sm" mt="sm"><Text size="sm">Datos consultados: {regionalDate(report.as_of??report.created_at)}. Este corte conserva sus cifras originales.</Text><Table.ScrollContainer minWidth={440} type="native" tabIndex={0} role="region" aria-label={`Resultados guardados en la revisión ${report.revision}`}><Table><Table.Thead><Table.Tr><Table.Th>Medida guardada</Table.Th><Table.Th>Con oferta</Table.Th><Table.Th>Sin oferta</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{(/** @type {const} */ ([['Clientes asignados','members',number],['Clientes que compraron','returned_customers',number],['Ventas registradas','recorded_sales_q',money]])).map(([label,key,format])=><Table.Tr key={key}><Table.Th scope="row">{label}</Table.Th><Table.Td>{report.treatment?.[key]==null?'Sin dato guardado':format(report.treatment[key])}</Table.Td><Table.Td>{report.control?.[key]==null?'Sin dato guardado':format(report.control[key])}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer><Text size="sm">Contribución incremental estimada en este corte: {report.contribution?.estimated_incremental_contribution_q==null?'Sin estimación':money(report.contribution.estimated_incremental_contribution_q)}. Costos directos: {report.contribution?.incurred_cost_q==null?'Sin estimación':money(report.contribution.incurred_cost_q)}.</Text>{report.decision&&<Text size="sm">Lectura guardada: {report.decision.title}. {report.decision.next_action}</Text>}</Stack></details>)}</Stack>}
 {isDemo&&<Text size="sm" c="dimmed">Los costos y cortes de ejemplo se conservan únicamente mientras esta pestaña siga abierta.</Text>}
 </Stack></section></Stack>;
}
