import {Alert, Anchor, Button, Group, List, Stack, Text, Title} from '@mantine/core';
import {formatTrialDate, type TrialState} from './trial-model';

interface OwnerTrialLockedProps {
  state: TrialState | null;
  /** Compact: an alert above a page that still reads; otherwise the full explanation screen. */
  compact?: boolean;
  onUpgrade: () => void;
  onNavigate?: (page: string) => void;
}

/**
 * Soft lock at day 14 (design §4.3, §7.3): what happened, what still works, what customers see,
 * when the data is deleted, and the way out. Reads keep working, so navigation stays visible.
 */
export default function OwnerTrialLocked({state, compact = false, onUpgrade, onNavigate}: OwnerTrialLockedProps) {
  const ends = formatTrialDate(state?.trial.ends_at ?? null);
  const purge = formatTrialDate(state?.billing.purge_after ?? null);
  const retention = purge
    ? `Conservamos clientes, puntos y configuración hasta el ${purge}. Después se eliminan de forma definitiva.`
    : 'Conservamos clientes, puntos y configuración durante 30 días después del bloqueo. Después se eliminan de forma definitiva.';
  if (compact)
    return (
      <Alert mb="xl" color="orange" title="Tu prueba terminó: el panel está en modo de lectura" role="status" data-testid="trial-lock-alert">
        <Text size="sm">Puedes consultar y exportar tu información; no se registran puntos, canjes ni cambios hasta que elijas un plan. {retention}</Text>
        <Group gap="sm" mt="sm">
          <Button size="compact-sm" onClick={onUpgrade}>Mejorar plan</Button>
          <Anchor href="/precios" size="sm" target="_blank" rel="noopener noreferrer">Ver planes y precios</Anchor>
        </Group>
      </Alert>
    );
  return (
    <Stack gap="lg" maw={760} data-testid="trial-lock-screen">
      <div>
        <Title order={1}>Tu prueba terminó</Title>
        <Text mt="sm">
          {ends ? `Los 14 días de prueba terminaron el ${ends}. ` : ''}
          El panel quedó en modo de lectura: puedes ver clientes, reportes y movimientos y exportar tus datos, pero no registrar puntos ni canjes ni cambiar el programa.
        </Text>
      </div>
      <section aria-labelledby="trial-lock-customers">
        <Title order={2} id="trial-lock-customers" size="h4">Lo que ven tus clientes</Title>
        <List size="sm" mt="xs">
          <List.Item>Su tarjeta sigue visible con el saldo y el historial.</List.Item>
          <List.Item>No se suman puntos nuevos ni se entregan recompensas hasta que elijas un plan.</List.Item>
          <List.Item>No se envían mensajes automáticos ni campañas en nombre de tu negocio.</List.Item>
        </List>
      </section>
      <section aria-labelledby="trial-lock-data">
        <Title order={2} id="trial-lock-data" size="h4">Tus datos</Title>
        <Text size="sm" mt="xs">{retention} Puedes exportar tus clientes en cualquier momento desde Clientes.</Text>
      </section>
      <Group>
        <Button onClick={onUpgrade}>Mejorar plan</Button>
        {onNavigate && <Button variant="default" onClick={() => onNavigate('customers')}>Ver clientes</Button>}
        {onNavigate && <Button variant="default" onClick={() => onNavigate('reports')}>Ver reportes</Button>}
        <Anchor href="/precios" target="_blank" rel="noopener noreferrer">Comparar planes</Anchor>
      </Group>
    </Stack>
  );
}
