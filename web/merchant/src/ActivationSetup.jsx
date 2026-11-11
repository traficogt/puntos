import {Button,Group,Stack,Text} from '@mantine/core';
import {useResource} from './api.js';
export default function ActivationSetup({region,features,onNavigate,onConfigure}){
 const weeklyEnabled=Boolean(features.lifecycle_automation&&features.analytics),secondEnabled=Boolean(weeklyEnabled&&features.campaign_rules);
 const weekly=useResource(weeklyEnabled?'/api/admin/automations/owner-brief':null);
 const second=useResource(secondEnabled?'/api/admin/automations/second-visit':null);
 const line=(title,detail,label,fn)=><div className="activation-step"><Group justify="space-between" align="start"><div><Text fw={600}>{title}</Text><Text size="sm" c="dimmed">{detail}</Text></div><Button variant="outline" onClick={fn}>{label}</Button></Group></div>;
 return <details className="activation-setup" open={!region?.currency_confirmed}><summary>Configura lo que quieres activar</summary><Stack gap="md" mt="md">
  {line('La moneda de tu negocio',`${region?.region?.currency||'—'} · ${region?.region?.timezone||'—'}. ${region?.currency_confirmed?'Moneda revisada.':'Revísala antes de registrar movimientos o costos.'}`,'Revisar moneda',()=>onNavigate('region'))}
  {weeklyEnabled&&<>
   {line('Tu resumen semanal por correo',weekly.error?'Abre la configuración para revisar el estado.':weekly.data?.settings?.enabled?'Resumen activado. Puedes revisar el destinatario y el horario.':'Verifica tu correo, revisa un ejemplo y elige si quieres recibirlo.','Configurar resumen',()=>onConfigure('owner-brief'))}
   {secondEnabled&&line('Invitar a una segunda visita',second.error?'Abre la configuración para revisar el estado.':second.data?.settings?.enabled?'Regla activada. Revisa sus límites y el regreso observado.':'Revisa una propuesta con bono, vigencia y presupuesto antes de activarla.','Revisar propuesta',()=>onConfigure('second-visit'))}
  </>}{!weeklyEnabled&&<Text size="sm">El resumen semanal y las automatizaciones están disponibles en los planes que incluyen automatización. <a href="/precios">Comparar planes</a></Text>}
  <Text size="sm" c="dimmed">Tú decides qué activar. Revisar una propuesta no envía mensajes ni concede beneficios.</Text>
 </Stack></details>;
}
