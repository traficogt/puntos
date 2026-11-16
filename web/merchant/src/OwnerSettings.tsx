import {Button, Divider, Group, Stack, Text, Title} from '@mantine/core';
import type {OwnerPageProps} from './owner-workspace';
import {OwnerRestricted} from './owner-workspace';
import {BusinessLink} from './ui.jsx';
const sections=[
 {title:'Personas y operación',items:[{page:'team',title:'Equipo',description:'Cuentas, contraseñas, roles y acceso a tarjetas de regalo.',feature:'staff_management'},{page:'branches',title:'Sucursales',description:'Ubicaciones y nuevas sucursales según tu plan.',feature:'multi_branch'},{page:'authority',title:'Autorizaciones y turnos',description:'Límites de acción y avisos para el equipo.'},{page:'pos',title:'Conectar caja',description:'Integración de ventas y conciliación.'}]},
 {title:'Tu programa',items:[{page:'brand',title:'Marca y QR',description:'Identidad del programa y enlace de registro.'},{page:'region',title:'Región del negocio',description:'País, moneda, horario y ubicaciones de la tarjeta.'},{page:'rewards',title:'Recompensas',description:'Catálogo, puntos necesarios y disponibilidad.'},{page:'automations',title:'Automatizaciones',description:'Reglas y comunicaciones del programa.'}]},
];
export default function OwnerSettings({staff,features,onNavigate}:OwnerPageProps) {
 if(staff.role!=='OWNER')return <OwnerRestricted title="Configuración" owner={false}/>;
 return <Stack gap="xl" maw={940}><div><Title order={1}>Configuración</Title><Text c="dimmed" mt="sm">Los ajustes del negocio, reunidos en un solo lugar.</Text></div>{sections.map(section=><section key={section.title} aria-label={section.title}><Title order={2} mb="md">{section.title}</Title><Stack gap={0}>{section.items.map(item=><div key={item.page}><Group justify="space-between" align="center" py="md" wrap="wrap"><div style={{flex:'1 1 230px'}}><Text fw={600}>{item.title}</Text><Text size="sm" c="dimmed">{item.description}</Text>{item.feature&&!features[item.feature]&&<Text size="sm">Disponible en un plan que incluya esta función.</Text>}</div><Button variant="default" onClick={()=>onNavigate?.(item.page)} aria-label={`Abrir ${item.title.toLowerCase()}`}>Abrir</Button></Group><Divider/></div>)}</Stack></section>)}<Stack gap="xs"><Text size="sm" c="dimmed">Los ajustes adicionales del negocio siguen disponibles en la administración avanzada.</Text><BusinessLink href="/administracion/">Abrir administración avanzada</BusinessLink></Stack></Stack>;
}
