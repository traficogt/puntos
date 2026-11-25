import {useState} from 'react';
import {Alert, Button, SimpleGrid, Stack, Text, Title} from '@mantine/core';
import {automationTemplates, templateBudgetNotes, templateFormValues, templateSummary} from './automation-templates';
import type {AutomationFormValues, AutomationTemplate} from './automation-templates';

// "Plantillas" sub-section of the Automations editor. A template is loaded into the form; the owner then saves
// through the editor's own validation and PUT /api/admin/automations. PUT /api/admin/automations/template, which
// the vanilla dashboard used, is never called because it writes the template without the budget checks.
export default function AutomationTemplates({current, disabled = false, onApply}: {current: AutomationFormValues; disabled?: boolean; onApply: (values: AutomationFormValues) => void}) {
  const [loaded, setLoaded] = useState<AutomationTemplate | null>(null), [notes, setNotes] = useState<string[]>([]);
  const apply = (template: AutomationTemplate) => {
    const values = templateFormValues(current, template);
    onApply(values);
    setLoaded(template);
    setNotes(templateBudgetNotes(values));
  };
  return <section aria-labelledby="automation-templates-heading"><Stack gap="md">
    <div><Title order={3} id="automation-templates-heading">Plantillas</Title><Text size="sm" c="dimmed">Carga una configuración de partida en el formulario. Nada se guarda hasta que revises el presupuesto mensual de cada regla y pulses Guardar y aplicar; la validación es la misma que al editar a mano.</Text></div>
    <SimpleGrid cols={{base: 1, md: 3}} spacing="md">{automationTemplates.map(template => <Stack key={template.key} className="panel" p="md" gap="xs" justify="space-between"><div><Text fw={600}>{template.name}</Text><Text size="sm">{template.description}</Text><Text size="sm" c="dimmed">{templateSummary(template)}</Text></div><Button variant="default" disabled={disabled} aria-label={`Cargar plantilla ${template.name}`} onClick={() => apply(template)}>Cargar en el formulario</Button></Stack>)}</SimpleGrid>
    {loaded && <Alert color={notes.length ? 'yellow' : 'blue'} role="status" title={`Plantilla «${loaded.name}» cargada en el formulario`}><Text size="sm">{notes.length ? 'Antes de guardar, corrige el presupuesto:' : 'Revisa los presupuestos mensuales y guarda para aplicarla. Los presupuestos y la separación entre mensajes se conservan como estaban.'}</Text>{notes.map(note => <Text key={note} size="sm">{note}</Text>)}</Alert>}
    <Text size="xs" c="dimmed">La alerta diaria de compras sospechosas que estas plantillas incluían en la administración anterior no se cambia desde aquí.</Text>
  </Stack></section>;
}
