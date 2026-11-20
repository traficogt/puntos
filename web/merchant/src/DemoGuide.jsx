import { Button, Group, Text, Title } from '@mantine/core';
import { guideSteps } from './demo-guide.js';

export function DemoWelcome({ onNavigate }) {
  return <section className="demo-welcome">
    <Title order={1}>Conoce PF con un ejemplo</Title>
    <Text className="intro">Encuentra clientes a quienes dar seguimiento, prepara una oferta y revisa sus costos. O entra directamente a las herramientas que te interesan.</Text>
    <ol className="demo-outline">
      <li>Identifica clientes</li><li>Prepara una oferta</li><li>Revisa los costos</li>
    </ol>
    <Group mt="xl" gap="md">
      <Button mih={44} onClick={() => onNavigate('recovery', 'guia')}>Ver un ejemplo</Button>
      <Button mih={44} variant="default" onClick={() => onNavigate('overview', 'libre')}>Explorar el panel</Button>
    </Group>
    <Text size="sm" c="dimmed" mt="lg">Sin registro. Puedes salir del recorrido en cualquier momento.</Text>
  </section>;
}

export default function DemoGuide({ page, mode, onNavigate }) {
  const index = guideSteps.findIndex(step => step.page === page);
  const step = guideSteps[index];
  if (mode !== 'guia' || !step) return mode === 'inicio' ? null :
    <Button mb="lg" mih={44} variant="default" onClick={() => onNavigate('recovery', 'guia')}>Ver el recorrido</Button>;
  return <section className="demo-guide" aria-label="Recorrido de ejemplo">
    <div className="demo-guide-heading">
      <Title order={2}>{step.title}</Title>
      <Text size="sm" c="dimmed">Paso {index + 1} de {guideSteps.length}</Text>
    </div>
    <Text size="sm" mt="sm">{step.description}</Text>
    <Group justify="space-between" mt="lg" gap="sm">
      <Group gap="sm">
        {index > 0 && <Button variant="default" mih={44} onClick={() => onNavigate(guideSteps[index - 1].page, 'guia')}>Paso anterior</Button>}
        {index < guideSteps.length - 1
          ? <Button mih={44} onClick={() => onNavigate(guideSteps[index + 1].page, 'guia')}>Siguiente: {step.next}</Button>
          : <Button mih={44} onClick={() => onNavigate('overview', 'libre')}>Terminar y explorar</Button>}
      </Group>
      <Button variant="subtle" mih={44} onClick={() => onNavigate(page, 'libre')}>Explorar libremente</Button>
    </Group>
  </section>;
}
