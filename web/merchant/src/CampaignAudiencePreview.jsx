import { regionalDate } from "./region.js";
import { useEffect, useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { api } from './api.js';
import { Loading, number } from './ui.jsx';
import { audienceDescription } from './audience-model.js';

const date = value => regionalDate(value);
export default function CampaignAudiencePreview({ segment, limit, minimum = 10, maximum = 200, onCount }) {
  const [state, setState] = useState(null), [refresh, setRefresh] = useState(0);
  const definition = JSON.stringify(segment?.definition ?? null);
  const key = `${segment?.id}:${segment?.version}:${definition}:${refresh}`;
  useEffect(() => {
    if (!segment) return;
    const controller = new AbortController();
    api('/api/admin/audiences/preview', { method: 'POST', body: JSON.stringify({ definition: JSON.parse(definition), limit: 10 }), signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ key, data, error: false }); })
      .catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setState({ key, data: null, error: true }); });
    return () => controller.abort();
  }, [key]);
  const current = state?.key === key ? state : null;
  useEffect(() => {
    onCount?.({ segmentId: segment?.id, version: segment?.version, definition, total: current?.error ? null : current?.data?.total ?? null });
  }, [segment?.id, segment?.version, definition, current?.data?.total, current?.error, onCount]);
  if (!segment) return null;
  const boundedLimit = Number.isInteger(limit) && limit >= minimum && limit <= maximum;
  return <Stack gap="sm">
    <Group justify="space-between"><Text fw={600} style={{ overflowWrap: 'anywhere' }}>{segment.name} · Versión {segment.version}</Text>
      <Button variant="subtle" loading={!current} onClick={() => setRefresh(value => value + 1)}>Actualizar coincidencias</Button></Group>
    <Text size="sm">{audienceDescription(segment.definition)}</Text>
    {!current ? <Loading label="Consultando coincidencias…" /> : current.error
      ? <Alert color="yellow" role="alert"><Stack gap="sm"><Text size="sm">No se pudo consultar la audiencia. Revisa la conexión antes de crear la oferta.</Text><Button variant="default" w="fit-content" onClick={() => setRefresh(value => value + 1)}>Reintentar vista previa</Button></Stack></Alert>
      : <>
        <Text size="sm">{number(current.data.total)} clientes coinciden en esta consulta. {boundedLimit ? `Se guardarán hasta ${number(limit)} en esta campaña.` : `Indica un límite de entre ${minimum} y ${number(maximum)} clientes.`} {number(current.data.contactable_count)} de las coincidencias tienen consentimiento promocional y teléfono.</Text>
        <Text size="sm" c="dimmed">Consultado: {date(current.data.generated_at)}.</Text>
        {boundedLimit && current.data.total > limit && <Alert color="yellow">La audiencia supera el límite elegido. La campaña incluirá una selección estable de hasta {number(limit)} clientes; los demás quedarán fuera de esta oferta.</Alert>}
        {current.data.total < minimum && <Alert color="yellow">Necesitas al menos {number(minimum)} participantes para activar la oferta. Revisa las condiciones si quieres ampliar la audiencia.</Alert>}
      </>}
    <Text size="sm" c="dimmed">La lista se calcula de nuevo al guardar. La selección, las condiciones y su versión quedan guardadas con la campaña; futuras ediciones de la audiencia no cambian sus participantes. El consentimiento se comprueba de nuevo antes de enviar mensajes.</Text>
  </Stack>;
}
