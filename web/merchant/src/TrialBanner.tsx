import {Alert, Anchor, Button, Group, Text} from '@mantine/core';
import {formatTrialDate, trialBannerCopy, type TrialState} from './trial-model';

interface TrialBannerProps {
  state: TrialState | null;
  onUpgrade: () => void;
}

/** "Prueba gratis · te quedan N días · Mejorar plan" while billing.status is trialing (design §7.3). */
export default function TrialBanner({state, onUpgrade}: TrialBannerProps) {
  const copy = trialBannerCopy(state);
  if (!state || !copy) return null;
  const ends = formatTrialDate(state.trial.ends_at);
  return (
    <Alert mb="xl" color={copy.color} title={copy.title} role="status" data-testid="trial-banner" data-tone={copy.color}>
      <Text size="sm">
        {copy.message}
        {ends ? ` Termina el ${ends}.` : ''} Sin tarjeta. Al terminar, el panel pasa a solo lectura y las tarjetas de tus clientes siguen visibles.
      </Text>
      <Group gap="sm" mt="sm">
        <Button size="compact-sm" onClick={onUpgrade}>Mejorar plan</Button>
        <Anchor href="/precios" size="sm" target="_blank" rel="noopener noreferrer">Ver planes y precios</Anchor>
      </Group>
    </Alert>
  );
}
