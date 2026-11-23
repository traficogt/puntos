import {useState} from 'react';
import {Alert, Badge, Button, Group, List, Progress, SimpleGrid, Stack, Text, Title} from '@mantine/core';
import {request, useOwnerResource, OwnerLoading, OwnerRestricted} from './owner-workspace';
import type {Branch, OwnerPageProps, TeamMember} from './owner-workspace';
import type {ProgramResponse} from './OwnerProgramLimits';

// Activation checklist built from the same reads the owner already uses (program, rewards, team,
// branches) plus printable opening/closing/training guides. Nothing here changes configuration.
interface ChecklistItem {key: string; label: string; detail: string; required: boolean; done: boolean | null; page: string; action: string}
const pointsPrograms = ['SPEND', 'VISIT', 'ITEM'];
export function programConfigured(program: ProgramResponse | null | undefined) {
  if (!program) return null;
  const config = program.program_json ?? {};
  switch (program.program_type) {
    case 'SPEND': return Number(config.points_per_q || 0) > 0;
    case 'VISIT': return Number(config.points_per_visit || 0) > 0;
    case 'ITEM': return Number(config.points_per_item || 0) > 0;
    case 'DISCOUNT': return Number(config.percent_off || 0) > 0;
    case 'STAMP': return Number(config.stamps_required || 0) > 0;
    case 'CASHBACK': return Number(config.cashback_percent || 0) > 0;
    case 'GIFT_CARD': return true;
    default: return false;
  }
}
export const guides = {
  apertura: ['GUÍA DE APERTURA - PUNTOSFIELES', '', '1) Iniciar sesión en el escáner del equipo', '2) Escanear un QR interno de prueba', '3) Confirmar la regla de puntos', '4) Revisar recompensas activas y su disponibilidad', '5) Revisar alertas pendientes'],
  cierre: ['GUÍA DE CIERRE - PUNTOSFIELES', '', '1) Revisar transacciones marcadas del día', '2) Validar canjes y tarjetas de regalo emitidas', '3) Exportar el reporte del día si corresponde', '4) Revisar trabajos en segundo plano con error', '5) Cerrar sesión en las terminales'],
  entrenamiento: ['GUÍA RÁPIDA PARA EL EQUIPO - PUNTOSFIELES', '', '1) Buscar al cliente por QR o teléfono', '2) Otorgar puntos solo con comprobante', '3) Validar el costo antes de canjear', '4) Reportar cualquier alerta al encargado', '5) Nunca compartir credenciales'],
};
export type GuideKey = keyof typeof guides;
export function printGuide(key: GuideKey, open: typeof window.open = (...args) => window.open(...args)) {
  const popup = open('', '_blank');
  if (!popup) return false;
  const doc = popup.document;
  doc.title = 'Guía PuntosFieles';
  const pre = doc.createElement('pre');
  pre.textContent = guides[key].join('\n');
  doc.body.replaceChildren(pre);
  popup.focus();
  popup.print();
  return true;
}

export default function OwnerOnboarding({staff, features, onNavigate, request: send = request}: OwnerPageProps) {
  const [revision, setRevision] = useState(0), [printError, setPrintError] = useState('');
  const allowed = staff.role === 'OWNER';
  const program = useOwnerResource<ProgramResponse>(allowed && features.program_rules ? '/api/admin/program' : null, revision, send);
  const rewards = useOwnerResource<{rewards: {id: string; active?: boolean}[]}>(allowed && features.rewards ? '/api/admin/rewards' : null, revision, send);
  const team = useOwnerResource<{staff: TeamMember[]}>(allowed && features.staff_management ? '/api/admin/staff' : null, revision, send);
  const branches = useOwnerResource<{branches: Branch[]}>(allowed && features.multi_branch ? '/api/admin/branches' : null, revision, send);
  if (!allowed) return <OwnerRestricted title="Puesta en marcha" owner={false}/>;
  const loading = program.loading || rewards.loading || team.loading || branches.loading;
  const programType = program.data?.program_type ?? 'SPEND';
  const items: ChecklistItem[] = [
    {key: 'program', label: 'Regla del programa', detail: 'Elige cómo gana el cliente y guarda la regla.', required: true, done: program.error ? null : programConfigured(program.data), page: 'launch', action: 'Ir a la regla'},
    {key: 'rewards', label: 'Recompensas', detail: 'Crea al menos una recompensa para que el cliente vea valor rápido.', required: pointsPrograms.includes(programType), done: !features.rewards ? true : rewards.error ? null : (rewards.data?.rewards.length ?? 0) > 0, page: 'rewards', action: 'Ir a recompensas'},
    {key: 'team', label: 'Equipo', detail: 'Crea al menos una cuenta de cajero o encargado para operar la caja.', required: true, done: !features.staff_management ? true : team.error ? null : (team.data?.staff.length ?? 0) >= 2, page: 'team', action: 'Ir al equipo'},
    {key: 'branches', label: 'Sucursales', detail: 'Registra tus ubicaciones si operas más de una sucursal.', required: false, done: !features.multi_branch ? true : branches.error ? null : (branches.data?.branches.length ?? 0) > 0, page: 'branches', action: 'Ir a sucursales'},
    {key: 'reports', label: 'Reportes', detail: 'Revisa la participación y la capacidad de tu plan de vez en cuando.', required: false, done: true, page: features.analytics ? 'overview' : 'reports', action: 'Abrir reportes'},
  ];
  const required = items.filter(item => item.required), completed = required.filter(item => item.done === true).length;
  const pct = Math.round((completed / (required.length || 1)) * 100);
  const next = required.find(item => item.done !== true);
  return <Stack gap="xl">
    <Group justify="space-between" align="start"><div><Title order={1}>Puesta en marcha</Title><Text c="dimmed" mt="sm" maw={740}>Comprueba los pasos clave antes de abrir el programa a tus clientes y descarga las guías de operación diaria para tu equipo.</Text></div><Button variant="outline" onClick={() => setRevision(value => value + 1)} loading={loading}>Actualizar</Button></Group>
    <section aria-labelledby="owner-onboarding-checklist"><Stack gap="md">
      <Title order={2} id="owner-onboarding-checklist">Lista de activación</Title>
      {loading ? <OwnerLoading label="Revisando la configuración…"/> : <>
        <Progress value={Math.max(4, pct)} aria-label="Avance de la puesta en marcha"/>
        <Text size="sm">{completed} de {required.length} pasos clave listos ({pct}%).</Text>
        <Alert color={next ? 'blue' : 'green'} title={next ? 'Siguiente paso recomendado' : 'Puesta en marcha completa'}>{next ? <Group justify="space-between" align="center"><Text size="sm">{next.label}: {next.detail}</Text>{onNavigate && <Button size="compact-sm" onClick={() => onNavigate(next.page)}>{next.action}</Button>}</Group> : <Text size="sm">Ya cubriste los pasos clave. Ahora enfócate en la recurrencia y las recompensas.</Text>}</Alert>
        <Stack gap={0}>{items.map(item => <Group key={item.key} justify="space-between" align="center" py="sm" wrap="wrap" style={{borderBottom: '1px solid var(--mantine-color-default-border)'}}><Group gap="sm" style={{flex: '1 1 320px'}}><Badge variant="light" color={item.done === true ? 'green' : item.done === null ? 'yellow' : item.required ? 'red' : 'gray'} miw={92}>{item.done === true ? 'Listo' : item.done === null ? 'Sin consultar' : item.required ? 'Pendiente' : 'Opcional'}</Badge><div><Text fw={600}>{item.label}</Text><Text size="sm" c="dimmed">{item.detail}</Text></div></Group>{onNavigate && <Button variant="default" size="compact-sm" onClick={() => onNavigate(item.page)}>{item.action}</Button>}</Group>)}</Stack>
        <Text size="xs" c="dimmed">La lista consulta la configuración guardada en PF. No comprueba la experiencia real en caja ni las pruebas con clientes.</Text>
      </>}
    </Stack></section>
    <section aria-labelledby="owner-onboarding-guides"><Stack gap="md">
      <Title order={2} id="owner-onboarding-guides">Operación diaria</Title>
      {printError && <Alert color="yellow" role="alert">{printError}</Alert>}
      <SimpleGrid cols={{base: 1, md: 3}} spacing="lg">
        <Stack gap="sm" className="panel" p="md"><Title order={3}>Apertura</Title><List size="sm" spacing={4}><List.Item>Abrir el escáner del equipo y probar un escaneo interno.</List.Item><List.Item>Verificar que la regla de puntos esté correcta.</List.Item><List.Item>Confirmar recompensas activas y su disponibilidad.</List.Item><List.Item>Revisar alertas pendientes antes de abrir caja.</List.Item></List><Button variant="default" w="fit-content" onClick={() => setPrintError(printGuide('apertura') ? '' : 'No se pudo abrir la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.')}>Imprimir guía de apertura</Button></Stack>
        <Stack gap="sm" className="panel" p="md"><Title order={3}>Cierre</Title><List size="sm" spacing={4}><List.Item>Revisar las transacciones marcadas del día.</List.Item><List.Item>Validar canjes y tarjetas de regalo emitidas.</List.Item><List.Item>Exportar el reporte del día si corresponde.</List.Item><List.Item>Confirmar que no haya trabajos con error.</List.Item></List><Button variant="default" w="fit-content" onClick={() => setPrintError(printGuide('cierre') ? '' : 'No se pudo abrir la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.')}>Imprimir guía de cierre</Button></Stack>
        <Stack gap="sm" className="panel" p="md"><Title order={3}>Capacitación rápida</Title><Text size="sm">Guía de diez minutos para cajeros y encargados nuevos.</Text><Button variant="default" w="fit-content" onClick={() => setPrintError(printGuide('entrenamiento') ? '' : 'No se pudo abrir la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.')}>Imprimir guía de entrenamiento</Button></Stack>
      </SimpleGrid>
    </Stack></section>
    {onNavigate && <Group><Button variant="default" onClick={() => onNavigate('operations')}>Ver el estado de la operación</Button><Button variant="subtle" onClick={() => onNavigate('launch')}>Preparar mi programa</Button></Group>}
  </Stack>;
}
