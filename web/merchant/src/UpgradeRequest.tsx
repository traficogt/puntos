import {useState} from 'react';
import {Alert, Button, Group, Select, Stack, Text, TextInput, Textarea} from '@mantine/core';
import {OwnerError, useOwnerMutation, type OwnerRequest} from './owner-workspace';
import {planDisplayName, suggestedUpgradePlan, upgradePlanOptions, upgradeRequestPayload} from './trial-model';

interface UpgradeRequestProps {
  request: OwnerRequest;
  currentPlan: string | null;
  initialPlan?: string | null;
  onDone?: () => void;
  /** Card checkout is offered (trial.upgrade_available): point to "Plan y facturación" instead of the form. */
  upgradeAvailable?: boolean;
  onOpenPlan?: () => void;
}

/**
 * Without a payment provider, "Mejorar plan" sends an upgrade request through the
 * owner-authenticated concierge mailer (POST /api/admin/concierge-request) and says that a card
 * payment option is coming. When the server reports `upgrade_available`, the card checkout on
 * the "Plan y facturación" page (OwnerPlan) replaces this form (design §4.4, wave 2).
 */
export default function UpgradeRequest({request, currentPlan, initialPlan, onDone, upgradeAvailable = false, onOpenPlan}: UpgradeRequestProps) {
  const [plan, setPlan] = useState(initialPlan ?? suggestedUpgradePlan(currentPlan));
  const [phone, setPhone] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [sent, setSent] = useState(false);
  const mutation = useOwnerMutation();
  if (upgradeAvailable && onOpenPlan)
    return (
      <Stack gap="sm" data-testid="upgrade-checkout-available">
        <Text size="sm">Ya puedes pagar con tarjeta desde el panel: elige Conecta, Impulsa o Expande, revisa el cobro mensual por sucursal y paga en la página segura del procesador indicado. El plan se activa en cuanto se confirma el pago.</Text>
        <Group>
          <Button onClick={onOpenPlan}>Ir a Plan y facturación</Button>
          {onDone && <Button variant="default" onClick={onDone}>Cerrar</Button>}
        </Group>
      </Stack>
    );
  if (sent)
    return (
      <Alert color="teal" title="Recibimos tu solicitud" role="status">
        <Text size="sm">Te contactamos para activar {planDisplayName(plan)} y acordar el cobro. Mientras tanto tu información sigue disponible en el panel.</Text>
        {onDone && <Button mt="sm" variant="default" onClick={onDone}>Cerrar</Button>}
      </Alert>
    );
  return (
    <form
      aria-label="Solicitud para mejorar plan"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (phone.trim().length < 7) {
          setFieldError('Escribe un teléfono o WhatsApp donde podamos contactarte.');
          return;
        }
        setFieldError('');
        mutation.run(
          () => request('/api/admin/concierge-request', {method: 'POST', body: JSON.stringify(upgradeRequestPayload({plan, phone, preferredTime, note, currentPlan}))}),
          () => setSent(true),
        );
      }}
    >
      <Stack gap="sm">
        <Alert color="blue" variant="light">
          <Text size="sm">Pronto podrás pagar con tarjeta desde aquí. Mientras tanto, envíanos la solicitud: te contactamos para activar el plan y confirmar el cobro.</Text>
        </Alert>
        {mutation.error && <OwnerError error={mutation.error} />}
        <Select label="Plan" data={upgradePlanOptions()} value={plan} onChange={(value) => setPlan(value || plan)} allowDeselect={false} disabled={mutation.busy} />
        <TextInput label="Teléfono o WhatsApp" required maxLength={25} value={phone} error={fieldError || undefined} onChange={(event) => setPhone(event.currentTarget.value)} disabled={mutation.busy} />
        <TextInput label="Horario preferido para contactarte (opcional)" maxLength={120} value={preferredTime} onChange={(event) => setPreferredTime(event.currentTarget.value)} disabled={mutation.busy} />
        <Textarea label="¿Algo que debamos saber? (opcional)" maxLength={600} autosize minRows={2} value={note} onChange={(event) => setNote(event.currentTarget.value)} disabled={mutation.busy} />
        <Group>
          <Button type="submit" loading={mutation.busy}>Enviar solicitud</Button>
          {onDone && <Button variant="default" onClick={onDone} disabled={mutation.busy}>Cancelar</Button>}
        </Group>
      </Stack>
    </form>
  );
}
