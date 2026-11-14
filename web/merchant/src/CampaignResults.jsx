import { PlanningSummary } from './CampaignMeasurementPlan.jsx';
import { Alert, Anchor, Stack, Table, Text, Title } from '@mantine/core';
import { money, number } from './ui.jsx';
import { regionalDate as date } from './region.js';
const interpretation = {
 not_started:['La prueba aún no empieza','Los resultados estarán disponibles después de activar la oferta.'],
 reconciling:['La observación terminó; falta conciliar','Espera el plazo acordado para recibir compras tardías y resolver devoluciones antes de decidir.'],
 in_progress:['La prueba sigue en curso','Espera a que termine la ventana antes de comparar resultados. Una diferencia temprana puede cambiar.'],
 interrupted:['La prueba se interrumpió','Las compras siguen dentro de la ventana original, pero la oferta se pausó. No uses esta comparación como una prueba completa.'],
 incomplete_data:['Faltan datos para interpretar el resultado','Revisa la conexión y los registros faltantes. Conservamos a todos los clientes asignados en el denominador.'],
 insufficient_sample:['Todavía hay poca evidencia','Uno de los grupos tiene menos de 30 clientes. Es una precaución de lectura: alcanzar 30 tampoco garantiza una prueba suficiente.'],
 inconclusive:['No hay una diferencia clara','El intervalo incluye cero: estos datos son compatibles con una mejora, ningún cambio o un empeoramiento.'],
 positive_difference:['Se observa una diferencia a favor de la oferta','El intervalo de regreso está por encima de cero. Revisa la calidad de los datos y el costo antes de repetir la oferta. Esto no demuestra rentabilidad.'],
 negative_difference:['Se observa una diferencia a favor del grupo sin oferta','El intervalo de regreso está por debajo de cero. Revisa el contexto antes de decidir si repetir esta oferta.'],
 descriptive:['Esta oferta muestra actividad registrada','No hay un grupo sin oferta para estimar qué habría ocurrido sin ella.'],
};
const pct = value => `${number(value)}%`;
function rateInterval(group) {const r=group?.return_rate_interval;return r?`${pct(r.lower*100)} a ${pct(r.upper*100)}`:'Sin intervalo disponible';}
export function CampaignResults({ results:r, quiet=false }) {
 if(!r)return null;
 const m=r.measurement, difference=m?.return_difference, state=m?.state;
 const [heading,description]=state==='insufficient_sample'&&r.planning?['La muestra no alcanza el plan','Los grupos no alcanzan el tamaño previsto para la mejora que querías detectar. Revisa el intervalo; una audiencia pequeña puede dejar la comparación inconclusa.']:interpretation[state]||['Interpretación no disponible','Los totales están disponibles. Actualiza esta vista para consultar la ventana y la calidad de los datos.'];
 return <section aria-labelledby="growth-results"><Stack gap="md">
  <Title order={3} id="growth-results">Qué sabemos de esta campaña</Title>
  {r.decision?<Alert color={['waiting','not_started','descriptive','review_repeat'].includes(r.decision.code)?'blue':'yellow'} title={r.decision.title}><Text size="sm">{r.decision.summary}</Text><Text size="sm" mt="xs" fw={600}>Próximo paso: {r.decision.next_action}</Text></Alert>:<Alert color={['incomplete_data','interrupted','insufficient_sample'].includes(state)?'yellow':'blue'} title={heading}>{description}</Alert>}
  {m?.window&&<Text size="sm" c="dimmed">Ventana principal de medición: {date(m.window.starts_at)} a {date(m.window.ends_at)}. Datos consultados: {date(m.as_of)}. Se incluyen registros hasta {date(m.window.observed_until)}.</Text>}
  {quiet?<Text>{number(r.treatment?.returned_customers)} de {number(r.treatment?.members)} participantes registraron una compra. Ventas registradas: {money(r.treatment?.recorded_sales_q)}. Sin grupo de comparación: no estimamos ventas adicionales.</Text>:<>
   <Table.ScrollContainer minWidth={500} type="native" tabIndex={0} role="region" aria-label="Comparación de resultados de campaña"><Table captionSide="bottom"><Table.Caption>Todos los clientes asignados cuentan, también quienes no compraron. Los puntos pendientes de una compra no la excluyen.</Table.Caption><Table.Thead><Table.Tr><Table.Th>Medida</Table.Th><Table.Th>Con oferta</Table.Th><Table.Th>Sin oferta</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
    {[["Clientes asignados","members",number],["Clientes que compraron","returned_customers",number],["Tasa de regreso","return_rate_pct",pct],["Ventas registradas","recorded_sales_q",money],["Ventas por cliente asignado","average_sales_per_member_q",money]].map(([label,key,format])=><Table.Tr key={key}><Table.Th scope="row">{label}</Table.Th><Table.Td>{format(r.treatment?.[key])}</Table.Td><Table.Td>{format(r.control?.[key])}</Table.Td></Table.Tr>)}
    <Table.Tr><Table.Th scope="row">Intervalo del 95% de regreso</Table.Th><Table.Td>{rateInterval(r.treatment)}</Table.Td><Table.Td>{rateInterval(r.control)}</Table.Td></Table.Tr>
   </Table.Tbody></Table></Table.ScrollContainer>
   {difference&&<div><Text fw={600}>Diferencia de regreso: {number(difference.estimate_pp)} puntos porcentuales.</Text><Text size="sm">Intervalo de confianza del 95%: {number(difference.lower_pp)} a {number(difference.upper_pp)} puntos porcentuales. {difference.lower_pp<=0&&difference.upper_pp>=0?'Incluye cero; no permite distinguir una mejora con claridad.':'El intervalo expresa la incertidumbre de la comparación.'}</Text></div>}
   <Text>Diferencia descriptiva de ventas: <strong>{money(r.estimated_incremental_sales_q)}</strong>. <Text component="span" size="sm">Es la diferencia de ventas por cliente, multiplicada por los clientes con oferta. No es ingreso adicional demostrado ni ganancia.</Text></Text>
  </>}
  <Text>Puntos extra otorgados: <strong>{number(r.bonus_points_issued)}</strong> · Costo estimado: <strong>{r.estimated_incentive_cost_q==null?'Sin costo configurado':money(r.estimated_incentive_cost_q)}</strong>.</Text>
  {m?.data_readiness&&<Text size="sm">{m.data_readiness.summary} {m.data_readiness.state==='blocked'&&<Anchor href="#conectar-caja">Revisar conexión de caja</Anchor>} {m.unavailable_members>0&&`${number(m.unavailable_members)} clientes asignados ya no tienen una cuenta disponible; su seguimiento puede estar incompleto.`}</Text>}
  {m?.messages&&<Text size="sm">Mensajes aceptados por el proveedor: {number(m.messages.accepted)}. Estos estados no prueban entrega ni lectura; tampoco prueban que el cliente vio la oferta.</Text>}
  {!quiet&&<><section aria-labelledby="growth-saved-plan"><Title order={4} id="growth-saved-plan" mb="sm">Supuestos de la medición</Title>{r.planning?<PlanningSummary planning={r.planning}/>:<Text size="sm">Esta campaña no tiene un plan de muestra guardado. No se han supuesto metas ni plazos retrospectivamente.</Text>}</section><MeasurementDiagnostics diagnostics={r.diagnostics} treatment={r.treatment} control={r.control}/><CampaignFollowup followup={r.followup} offer={r.offer_period}/><CampaignContribution contribution={r.contribution}/></>}
  <details><summary>Cómo leer esta comparación</summary><Stack gap="xs" mt="sm">
   <Text size="sm">{quiet?'Esta oferta no tiene grupo de comparación.':'La asignación aleatoria se conserva durante toda la campaña. Comparamos a todos los asignados, sin seleccionar solo quienes recibieron mensajes, compraron o canjearon.'}</Text>
   {!quiet&&<Text size="sm">Los intervalos usan Wilson para cada grupo y Newcombe para la diferencia. Suponen observaciones independientes y una ventana fija. Consultar la pantalla repetidamente no equivale a una prueba secuencial; tampoco corrige promociones simultáneas ni datos ausentes.</Text>}
   <Text size="sm">La ventana usa la fecha de compra informada por la fuente cuando supera las comprobaciones de fecha. Si no existe una fecha confiable, usa la fecha de registro en PF y lo señala en el diagnóstico. Una sincronización tardía puede cambiar un corte anterior. Los totales excluyen compras revertidas y descuentan devoluciones parciales conciliadas; las pendientes pueden afectar la lectura.</Text>
   <Text size="sm">El costo por punto es una estimación separada de los costos directos declarados por el negocio. La contribución combina la diferencia descriptiva de ventas, el margen supuesto y esos costos. No atribuye automáticamente canjes de puntos a esta campaña y no equivale a utilidad contable.</Text>
  </Stack></details>
 </Stack></section>;
}
const knownNumber=value=>value==null?'Desconocido':number(value);
const knownMoney=value=>value==null?'Sin estimación':money(value);
function MeasurementDiagnostics({diagnostics:d,treatment:assignedTreatment,control:assignedControl}) {
 if(!d)return null;
 const coverage=d.receipt_coverage,baseline=d.baseline;
 const treatment=assignedTreatment??d.treatment??baseline?.treatment,control=assignedControl??d.control??baseline?.control;
 return <section aria-labelledby="growth-diagnostics"><Stack gap="sm"><Title order={4} id="growth-diagnostics">Calidad y comparabilidad de los datos</Title>
 <Text size="sm">Asignaciones: {d.assignment_counts_match===true?'los conteos coinciden':d.assignment_counts_match===false?'hay diferencias por revisar':'sin comprobación disponible'}. Captura de compras: {{unknown:'cobertura desconocida',complete:'completa según la fuente disponible',incomplete:'incompleta'}[d.capture_state]??'cobertura desconocida'}.</Text>
 <Table.ScrollContainer minWidth={0} type="native" tabIndex={0} role="region" aria-label="Diagnóstico de datos de la campaña"><Table><Table.Tbody>{[
 ['Compras registradas tarde',d.late_purchases],['Compras con fecha informada sin verificar',d.untrusted_time_purchases],['Compras importadas sin fecha original',d.missing_purchase_dates],['Compras con fecha de registro heredada',d.legacy_time_purchases],['Devoluciones pendientes de conciliar',d.pending_refunds],['Clientes en campañas simultáneas',d.overlap_members],['Clientes sin datos del período previo',d.missing_preperiod_members],
 ].map(([label,value])=><Table.Tr key={label}><Table.Th scope="row">{label}</Table.Th><Table.Td>{knownNumber(value)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
 <Text size="sm">Las importaciones sin fecha original y los registros heredados usan la fecha de registro en PF; no acreditan cuándo ocurrió la compra.</Text>
 {coverage&&<Text size="sm">Comprobantes en la fuente: {knownNumber(coverage.total)}; vinculados a clientes: {knownNumber(coverage.linked)}; sin vínculo: {knownNumber(coverage.unmatched)}; rechazados: {knownNumber(coverage.rejected)}. La proporción vinculada describe esos comprobantes y no acredita todas las ventas del negocio.</Text>}
 {(treatment||control)&&<Text size="sm">Compraron en el período previo: {treatment?.baseline_purchase_rate_pct==null?'desconocido':pct(treatment.baseline_purchase_rate_pct)} del grupo con oferta y {control?.baseline_purchase_rate_pct==null?'desconocido':pct(control.baseline_purchase_rate_pct)} del grupo sin oferta.</Text>}
 {d.baseline_imbalance===true&&<Alert color="yellow" title="Los grupos diferían antes de la oferta">La actividad previa muestra un desequilibrio. Revisa el contexto; no ajustes la selección de participantes después de ver el resultado.</Alert>}
 <Text size="sm" c="dimmed">Una cobertura desconocida, datos faltantes o promociones simultáneas limitan la interpretación, aunque el intervalo de regreso excluya cero.</Text>
 </Stack></section>;
}
function CampaignFollowup({followup:f,offer}) {
 if(!f)return null;
 if(f.available===false)return <section aria-labelledby="growth-followup"><Title order={4} id="growth-followup" mb="sm">Regreso después de la oferta</Title><Text size="sm">Esta campaña no tiene un período de seguimiento posterior definido. No se infiere una mejora sostenida a partir de las compras durante la oferta.</Text></section>;
 const state={waiting:'El seguimiento sigue abierto',reconciling:'Seguimiento cerrado; conciliación pendiente',complete:'El plazo de seguimiento y conciliación terminó'}[f.state]??'Seguimiento pendiente';
 return <section aria-labelledby="growth-followup"><Stack gap="sm"><Title order={4} id="growth-followup">Regreso después de la oferta</Title><Text fw={600}>{state}</Text>
 {offer&&<Text size="sm">Durante la vigencia de la oferta ({date(offer.starts_at)} a {date(offer.ends_at)}), compraron {knownNumber(offer.treatment?.returned_customers)} de {knownNumber(offer.treatment?.members)} clientes con oferta y {knownNumber(offer.control?.returned_customers)} de {knownNumber(offer.control?.members)} sin oferta.</Text>}
 <Text size="sm">Compras desde el fin de la oferta, {date(f.starts_at)}, hasta {date(f.ends_at)}. Conciliación hasta {date(f.reconciliation_ends_at)}.</Text>
 <Table.ScrollContainer minWidth={480} type="native" tabIndex={0} role="region" aria-label="Seguimiento después de la oferta"><Table captionSide="bottom"><Table.Caption>Se conserva a todos los asignados. Este seguimiento describe regreso posterior; no demuestra un hábito duradero.</Table.Caption><Table.Thead><Table.Tr><Table.Th>Medida posterior</Table.Th><Table.Th>Con oferta</Table.Th><Table.Th>Sin oferta</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[['Clientes asignados','members',number],['Clientes que compraron','returned_customers',number],['Tasa de regreso','return_rate_pct',pct],['Ventas registradas','recorded_sales_q',money]].map(([label,key,format])=><Table.Tr key={key}><Table.Th scope="row">{label}</Table.Th><Table.Td>{f.treatment?.[key]==null?'Sin datos':format(f.treatment[key])}</Table.Td><Table.Td>{f.control?.[key]==null?'Sin datos':format(f.control[key])}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
 {f.return_difference&&<Text size="sm">Diferencia posterior: {number(f.return_difference.estimate_pp)} puntos porcentuales; intervalo del 95% de {number(f.return_difference.lower_pp)} a {number(f.return_difference.upper_pp)}.</Text>}
 </Stack></section>;
}
const costNames={gross_margin_pct:'margen bruto',fulfillment_cost_q:'incentivos cumplidos',messaging_cost_q:'mensajes',other_cost_q:'otros costos directos',outstanding_reward_cost_q:'incentivos pendientes',treatment_sales:'ventas del grupo con oferta',control_sales:'ventas del grupo sin oferta'};
function CampaignContribution({contribution:c}) {
 if(!c)return null;
 return <section aria-labelledby="growth-contribution"><Stack gap="sm"><Title order={4} id="growth-contribution">Contribución estimada de la campaña</Title>
 {c.missing_inputs?.length>0&&<Alert color="yellow" title="Faltan supuestos de costo">Completa lo que conozcas: {c.missing_inputs.map(key=>costNames[key]??key).join(', ')}. Los campos vacíos no se tratan como cero.</Alert>}
 <Table.ScrollContainer minWidth={0} type="native" tabIndex={0} role="region" aria-label="Estimación de contribución de la campaña"><Table><Table.Tbody>{[
 ['Diferencia de ventas por cliente',c.sales_difference_per_member_q],['Diferencia de ventas del grupo con oferta',c.incremental_recorded_sales_q],['Contribución bruta según el margen supuesto',c.incremental_gross_contribution_q],['Costos directos declarados',c.incurred_cost_q],['Contribución incremental estimada',c.estimated_incremental_contribution_q],['Costo supuesto de incentivos pendientes',c.outstanding_reward_cost_q],['Escenario incluyendo incentivos pendientes',c.scenario_including_outstanding_q],
 ].map(([label,value])=><Table.Tr key={label}><Table.Th scope="row">{label}</Table.Th><Table.Td>{knownMoney(value)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
 <Text size="sm">Esta estimación usa una diferencia descriptiva de ventas y costos declarados por el negocio. No demuestra ingreso adicional ni utilidad contable. El escenario pendiente no equivale a un gasto confirmado.</Text>
 </Stack></section>;
}
