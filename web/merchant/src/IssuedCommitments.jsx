import {useState} from 'react';
import {Alert,Button,Group,Stack,Table,Text,Title} from '@mantine/core';
import {useResource} from './api.js';
import {Failure,Loading,number} from './ui.jsx';
export default function IssuedCommitments(){
 const [revision,setRevision]=useState(0),resource=useResource('/api/admin/reward-economics/commitments',revision),data=resource.data;
 const format=(value,currency)=>currency==='unknown'?'Moneda sin registro':new Intl.NumberFormat(data.region.locale,{style:'currency',currency}).format(value);
 return <section className="operation-section" aria-labelledby="issued-commitments"><Stack gap="md"><Group justify="space-between"><Title order={2} id="issued-commitments">Beneficios emitidos pendientes</Title><Button mih={44} variant="subtle" onClick={()=>setRevision(n=>n+1)}>Actualizar compromisos</Button></Group><Text>Unidades, valor para el cliente y costo de entrega guardados al emitir. Los saldos de puntos se muestran por separado y no se suman a estos beneficios.</Text>
 {resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={()=>setRevision(n=>n+1)}/>:data&&<>
 {!data.groups.length?<Text>No hay beneficios emitidos pendientes en este momento.</Text>:<Table.ScrollContainer scrollAreaProps={{viewportProps:{tabIndex:0}}} minWidth={700}><Table><Table.Caption>Valores conocidos por tipo y moneda; las partes faltantes siguen desconocidas.</Table.Caption><Table.Thead><Table.Tr><Table.Th>Beneficio</Table.Th><Table.Th>Unidades</Table.Th><Table.Th>Valor de venta conocido</Table.Th><Table.Th>Costo conocido</Table.Th><Table.Th>Sin cobertura</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.groups.map(row=><Table.Tr key={`${row.kind}-${row.currency}`}><Table.Td>{({protected_reward:'Opciones de ciclo protegido',hospitality:'Cortesías',offer:'Bonos de ofertas'})[row.kind]}<Text size="xs">{row.currency==='unknown'?'Moneda histórica desconocida':row.currency}{row.kind==='offer'?' · costo estimado':''}</Text></Table.Td><Table.Td>{number(row.units)}</Table.Td><Table.Td>{format(row.known_retail_value,row.currency)}</Table.Td><Table.Td>{format(row.known_fulfillment_cost,row.currency)}</Table.Td><Table.Td>{row.unknown_retail_units} sin valor de venta · {row.unknown_cost_units} sin costo</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
 {data.groups.some(row=>row.unknown_cost_units||row.unknown_retail_units)&&<Alert color="yellow">El total monetario es desconocido mientras falten valores. Registrar precios hoy no completa beneficios históricos.</Alert>}
 {data.notes.map(note=><Text size="sm" c="dimmed" key={note}>{note}</Text>)}<Text size="sm">Consulta los aportes reservados, aprobados y pagados por proveedores en <a href="#funding">Financiamiento de proveedores</a>. No se descuentan como ingresos de este reporte.</Text>
 </>}
 </Stack></section>;
}
