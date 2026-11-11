import { Alert, Anchor, Stack, Table, Text, Title } from '@mantine/core';
import { money, number } from './ui.jsx';
import { regionalDate as date } from './region.js';
const interpretation = {
 not_started:['La prueba aún no empieza','Los resultados estarán disponibles después de activar la oferta.'],
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
 const [heading,description]=interpretation[state]||['Interpretación no disponible','Los totales están disponibles. Actualiza esta vista para consultar la ventana y la calidad de los datos.'];
 return <section aria-labelledby="growth-results"><Stack gap="md">
  <Title order={3} id="growth-results">Qué sabemos de esta campaña</Title>
  <Alert color={['incomplete_data','interrupted','insufficient_sample'].includes(state)?'yellow':'blue'} title={heading}>{description}</Alert>
  {m?.window&&<Text size="sm" c="dimmed">Ventana: {date(m.window.starts_at)} a {date(m.window.ends_at)}. Datos consultados: {date(m.as_of)}. Se incluyen registros hasta {date(m.window.observed_until)}.</Text>}
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
  <details><summary>Cómo leer esta comparación</summary><Stack gap="xs" mt="sm">
   <Text size="sm">{quiet?'Esta oferta no tiene grupo de comparación.':'La asignación aleatoria se conserva durante toda la campaña. Comparamos a todos los asignados, sin seleccionar solo quienes recibieron mensajes, compraron o canjearon.'}</Text>
   {!quiet&&<Text size="sm">Los intervalos usan Wilson para cada grupo y Newcombe para la diferencia. Suponen observaciones independientes y una ventana fija. Consultar la pantalla repetidamente no equivale a una prueba secuencial; tampoco corrige promociones simultáneas ni datos ausentes.</Text>}
   <Text size="sm">La ventana usa la fecha de registro de la compra en PF. Una compra sincronizada tarde puede quedar fuera, aunque haya ocurrido durante la oferta. Los totales excluyen compras revertidas; devoluciones parciales aún pendientes de conciliar pueden afectar las ventas registradas.</Text>
   <Text size="sm">El costo usa la estimación por punto guardada con la campaña. Excluye mensajes, operación, puntos normales y otros incentivos. Ningún total equivale a utilidad contable.</Text>
  </Stack></details>
 </Stack></section>;
}
