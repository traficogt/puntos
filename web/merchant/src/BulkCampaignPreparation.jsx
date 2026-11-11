import { Alert, Button, Group, Progress, Stack, Text } from '@mantine/core';
import { number } from './ui.jsx';
const labels = { queued:'En cola', preparing:'Preparando participantes', failed:'Preparación interrumpida', ready:'Participantes listos', cancelled:'Preparación cancelada' };
export default function BulkCampaignPreparation({ campaign, busy, onRefresh, onAction }) {
  if (campaign.audience_snapshot?.preparation !== 'background') return null;
  const state = campaign.preparation_status, total = campaign.audience_snapshot.selected_count ?? campaign.audience_snapshot.limit;
  const percentage = state === 'ready' ? 100 : total ? Math.min(100,campaign.prepared_count/total*100) : 0;
  return <Alert color={state === 'failed' ? 'yellow' : 'blue'} title={labels[state] || state}>
    <Stack gap="sm"><Text size="sm" role="status">{number(campaign.prepared_count)} de {number(total)} participantes procesados.</Text>
      <Progress value={percentage} aria-label="Progreso de preparación" />
      <Text size="sm">La selección se fija al comenzar el trabajo. Si se interrumpe, continúa desde el último bloque guardado. Preparar la lista no activa la oferta ni envía mensajes.</Text>
      {state === 'cancelled' && <Text size="sm">La preparación y sus participantes quedan guardados para consulta. Crea otra campaña para continuar.</Text>}
      <Group gap="sm"><Button variant="default" disabled={busy} onClick={onRefresh}>Actualizar preparación</Button>
        {state === 'failed' && <Button disabled={busy} onClick={()=>onAction('retry')}>Reintentar preparación</Button>}
        {['queued','preparing','failed'].includes(state) && <Button color="red" variant="subtle" disabled={busy} onClick={()=>{if(confirm('¿Cancelar esta preparación? Conservaremos el progreso, pero esta campaña no podrá activarse.'))onAction('cancel');}}>Cancelar preparación</Button>}
      </Group>
    </Stack>
  </Alert>;
}
