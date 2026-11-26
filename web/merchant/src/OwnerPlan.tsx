import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  OwnerError,
  OwnerLoading,
  OwnerRestricted,
  request,
  useOwnerMutation,
  useOwnerResource,
} from "./owner-workspace";
import type { OwnerFailure, OwnerPageProps } from "./owner-workspace";
import UpgradeRequest from "./UpgradeRequest";
import { formatTrialDate, type TrialState } from "./trial-model";
import {
  BILLING_UNAVAILABLE_MESSAGE,
  FEL_NOTE,
  IVA_NOTE,
  POLL_INTERVAL_MS,
  advancePolling,
  billingErrorMessage,
  billingStatusCopy,
  canCancel,
  canChangePlan,
  canStartCheckout,
  cancelCopy,
  catalogPricingNote,
  checkoutUrl,
  formatBillingDate,
  formatMinor,
  invoiceStatusLabel,
  isBillingUnavailable,
  normalizeBilling,
  normalizeCheckoutStatus,
  normalizeInvoices,
  planChangeCopy,
  pollingCopy,
  quoteLine,
  quotePlans,
  responsePlanName,
  showsInvoices,
  startPolling,
  type BillingReturn,
  type BillingTone,
  type BillingView,
  type PlanQuote,
  type PollState,
} from "./billing-model";

interface OwnerPlanProps extends OwnerPageProps {
  /** Trial state the shell already holds; shown while GET /api/admin/billing is unavailable. */
  trialState?: TrialState | null;
  /** `#plan?checkout=<id>&resultado=exito|cancelado`, parsed by the shell before the hash is normalised. */
  checkoutReturn?: BillingReturn | null;
  /** The plan changed (payment confirmed, plan changed or canceled): the shell re-reads plan and trial. */
  onBillingChanged?: () => void;
}
interface Notice {
  tone: BillingTone;
  title: string;
  body: string;
}

function BillingNotice({ notice, testId }: { notice: Notice; testId: string }) {
  return (
    <Alert
      color={notice.tone}
      title={notice.title}
      role="status"
      data-testid={testId}
      data-tone={notice.tone}
    >
      <Text size="sm">{notice.body}</Text>
    </Alert>
  );
}

function MutationFailure({ error }: { error: OwnerFailure }) {
  const message = billingErrorMessage(error);
  if (!message) return <OwnerError error={error} />;
  return (
    <Alert color="red" title="No pudimos completar la operación" role="alert">
      <Text size="sm">{message}</Text>
    </Alert>
  );
}

/** Trial-only status card for servers without the billing API (or while it is unavailable). */
function TrialStatusCard({ state }: { state: TrialState }) {
  const locked = state.billing.status === "locked";
  const name = state.plan_name ?? "Conecta";
  const left = state.trial.days_left;
  const ends = formatTrialDate(state.trial.ends_at);
  const body = locked
    ? "El panel está en modo de lectura hasta que elijas un plan."
    : `${left === null ? "" : left <= 0 ? "Termina hoy. " : left === 1 ? "Te queda 1 día. " : `Te quedan ${left} días. `}${ends ? `La prueba termina el ${ends}. ` : ""}Sin cobro hasta que elijas un plan.`;
  return (
    <Card
      withBorder
      padding="lg"
      data-testid="plan-status"
      data-status={locked ? "locked" : "trial"}
    >
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={2} size="h3">
            {locked ? "Tu prueba terminó" : `Prueba gratis de ${name}`}
          </Title>
          <Text size="sm" mt="xs">
            {body}
          </Text>
        </div>
        <Badge color={locked ? "red" : "blue"} variant="dot">
          {locked ? "Prueba terminada" : "En prueba"}
        </Badge>
      </Group>
    </Card>
  );
}

function StatusCard({ view }: { view: BillingView }) {
  const copy = billingStatusCopy(view);
  return (
    <Card withBorder padding="lg" data-testid="plan-status" data-status={view.billing.status}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div style={{ flex: "1 1 320px" }}>
          <Title order={2} size="h3">
            {copy.title}
          </Title>
          <Text size="sm" mt="xs">
            {copy.body}
          </Text>
          {view.billing.latest_tax_invoice_url && (
            <Anchor
              href={view.billing.latest_tax_invoice_url}
              size="sm"
              target="_blank"
              rel="noopener noreferrer"
              mt="xs"
              display="inline-block"
            >
              Ver el último comprobante de pago
            </Anchor>
          )}
        </div>
        <Badge color={copy.color} variant="dot">
          {copy.badge}
        </Badge>
      </Group>
    </Card>
  );
}

function InvoicesTable({
  path,
  revision,
  send,
}: {
  path: string;
  revision: number;
  send: typeof request;
}) {
  const resource = useOwnerResource<unknown>(path, revision, send);
  if (resource.loading) return <OwnerLoading label="Cargando comprobantes…" />;
  if (resource.error)
    return (
      <Text size="sm">No pudimos cargar los comprobantes. Vuelve a intentarlo más tarde.</Text>
    );
  const invoices = normalizeInvoices(resource.data);
  if (!invoices.length)
    return (
      <Text size="sm">
        Todavía no hay cobros registrados. El primer comprobante aparece después del primer pago.
      </Text>
    );
  return (
    <Table.ScrollContainer
      minWidth={520}
      type="native"
      tabIndex={0}
      role="region"
      aria-label="Cobros y comprobantes"
    >
      <Table verticalSpacing="sm" data-testid="invoices">
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Fecha</Table.Th>
            <Table.Th scope="col">Monto</Table.Th>
            <Table.Th scope="col">Estado</Table.Th>
            <Table.Th scope="col">Comprobante</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {invoices.map((invoice, index) => (
            <Table.Tr key={`${invoice.occurred_at ?? "sin-fecha"}-${index}`}>
              <Table.Td>{formatBillingDate(invoice.occurred_at) || "Sin fecha"}</Table.Td>
              <Table.Td>{formatMinor(invoice.amount_minor, invoice.currency)}</Table.Td>
              <Table.Td>{invoiceStatusLabel(invoice.status)}</Table.Td>
              <Table.Td>
                {invoice.tax_invoice_url ? (
                  <Anchor
                    href={invoice.tax_invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                  >
                    Ver comprobante
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    Pendiente de emisión
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/**
 * "Plan y facturación" (design §7.3, wave 2): current plan and status, the three tiers with
 * per-branch math, card checkout through Recurrente, the return-and-poll confirmation, plan
 * change, cancel at period end and the payment list. Without the billing API (404) or
 * provider (503 BILLING_UNAVAILABLE) the page keeps the wave-1 upgrade request form.
 */
export default function OwnerPlan({
  staff,
  trialState = null,
  checkoutReturn = null,
  onBillingChanged,
  request: send = request,
}: OwnerPlanProps) {
  const [revision, setRevision] = useState(0);
  const [poll, setPoll] = useState<PollState | null>(() =>
    checkoutReturn?.result === "exito" ? startPolling(checkoutReturn.checkoutId) : null,
  );
  const [paidPlan, setPaidPlan] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [changeTarget, setChangeTarget] = useState<PlanQuote | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const mutation = useOwnerMutation();
  const changed = useRef(onBillingChanged);
  changed.current = onBillingChanged;
  const resource = useOwnerResource<unknown>(
    staff.role === "OWNER" ? "/api/admin/billing" : null,
    revision,
    send,
  );
  const view = normalizeBilling(resource.data);

  useEffect(() => {
    if (!poll || poll.phase !== "polling") return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        send<unknown>(`/api/admin/billing/checkout/${encodeURIComponent(poll.checkoutId)}`, {
          signal: controller.signal,
        })
          .then((body) => {
            if (controller.signal.aborted) return;
            const status = normalizeCheckoutStatus(body);
            if (status === "completed") setPaidPlan(responsePlanName(body));
            setPoll((current) =>
              current && current.phase === "polling"
                ? advancePolling(
                    current,
                    status
                      ? { kind: "response", status }
                      : { kind: "error", error: new Error("Respuesta ilegible") },
                  )
                : current,
            );
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setPoll((current) =>
              current && current.phase === "polling"
                ? advancePolling(current, { kind: "error", error })
                : current,
            );
          });
      },
      poll.attempts === 0 ? 0 : POLL_INTERVAL_MS,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [poll, send]);
  useEffect(() => {
    if (poll?.phase !== "completed") return;
    setRevision((value) => value + 1);
    changed.current?.();
  }, [poll?.phase]);

  if (staff.role !== "OWNER") return <OwnerRestricted title="Plan y facturación" owner={false} />;

  const unavailable =
    (resource.error !== null && isBillingUnavailable(resource.error)) ||
    (resource.data !== null && view === null);
  const currentPlan = view?.billing.plan ?? trialState?.plan ?? null;
  const returnNotice: Notice | null = poll
    ? pollingCopy(poll, paidPlan ?? view?.billing.plan_name ?? null)
    : checkoutReturn?.result === "cancelado"
      ? pollingCopy(
          { checkoutId: checkoutReturn.checkoutId, phase: "canceled", attempts: 0, startedAt: 0 },
          null,
        )
      : null;

  function startCheckout(quote: PlanQuote) {
    if (!view) return;
    setNotice(null);
    mutation.run(
      () =>
        send<unknown>("/api/admin/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: quote.plan, currency: view.catalog.currency }),
        }),
      (body) => {
        const url = checkoutUrl(body);
        if (url) location.assign(url);
        else
          setNotice({
            tone: "red",
            title: "No pudimos abrir la página de pago",
            body: "Vuelve a intentarlo en unos minutos o escríbenos a soporte.",
          });
      },
    );
  }
  function confirmChange(quote: PlanQuote) {
    if (!view) return;
    const copy = planChangeCopy(view, quote);
    mutation.run(
      () =>
        send<unknown>("/api/admin/billing/change", {
          method: "POST",
          body: JSON.stringify({ plan: quote.plan }),
        }),
      (body) => {
        const name = responsePlanName(body) ?? quote.name;
        setChangeTarget(null);
        setNotice(
          copy.kind === "upgrade"
            ? {
                tone: "teal",
                title: `Tu plan ${name} está activo`,
                body: "La diferencia proporcional se cobró a tu tarjeta y las funciones del nuevo plan ya están disponibles.",
              }
            : {
                tone: "blue",
                title: `Cambio a ${name} programado`,
                body: `Sigues con tu plan actual hasta el final del período${view.billing.current_period_end ? ` (${formatBillingDate(view.billing.current_period_end)})` : ""}; después el cobro mensual será el de ${name}.`,
              },
        );
        setRevision((value) => value + 1);
        changed.current?.();
      },
    );
  }
  function confirmCancel() {
    if (!view) return;
    mutation.run(
      () =>
        send<unknown>("/api/admin/billing/cancel", {
          method: "POST",
          body: JSON.stringify({ at_period_end: true }),
        }),
      () => {
        setCancelOpen(false);
        const ends = formatBillingDate(view.billing.current_period_end);
        setNotice({
          tone: "gray",
          title: "Plan cancelado al final del período",
          body: `${ends ? `Tu plan sigue activo hasta el ${ends}. ` : ""}No habrá más cobros; después el panel pasa a modo de lectura.`,
        });
        setRevision((value) => value + 1);
        changed.current?.();
      },
    );
  }

  const quotes = view ? quotePlans(view) : [];
  const offersCheckout = view !== null && canStartCheckout(view);
  const offersChange = view !== null && canChangePlan(view);
  const manual = view?.billing.status === "manual";
  const showRequestForm =
    !manual && (unavailable || (view !== null && !view.billing.upgrade_available));

  return (
    <Stack gap="xl" maw={940}>
      <div>
        <Title order={1}>Plan y facturación</Title>
        <Text c="dimmed" mt="sm">
          Tu plan, el cobro mensual por sucursal, el pago con tarjeta y los comprobantes fiscales.
        </Text>
      </div>
      {returnNotice && <BillingNotice notice={returnNotice} testId="checkout-result" />}
      {notice && <BillingNotice notice={notice} testId="billing-notice" />}
      {mutation.error && <MutationFailure error={mutation.error} />}
      {resource.loading ? (
        <OwnerLoading label="Cargando tu plan…" />
      ) : resource.error && !unavailable ? (
        <OwnerError error={resource.error} retry={() => setRevision((value) => value + 1)} />
      ) : (
        <>
          {view ? (
            <StatusCard view={view} />
          ) : trialState ? (
            <TrialStatusCard state={trialState} />
          ) : null}
          {view?.billing.checkout_pending && poll?.phase !== "completed" && (
            <Alert
              color="yellow"
              title="Tienes un pago en curso"
              role="status"
              data-testid="checkout-pending"
            >
              <Text size="sm">
                Abriste la página de pago de Recurrente y todavía no se confirmó.
                {view.billing.checkout_pending.expires_at
                  ? ` Puedes retomarla hasta el ${formatBillingDate(view.billing.checkout_pending.expires_at)}.`
                  : ""}{" "}
                Si ya pagaste, el plan se activa solo en unos minutos.
              </Text>
              <Group gap="sm" mt="sm">
                <Button
                  size="compact-sm"
                  onClick={() => location.assign(view.billing.checkout_pending!.url)}
                >
                  Continuar el pago
                </Button>
                <Button
                  size="compact-sm"
                  variant="default"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Ya pagué, actualizar
                </Button>
              </Group>
            </Alert>
          )}
          {showRequestForm && (
            <section aria-labelledby="plan-request-heading" data-testid="billing-unavailable">
              <Alert color="blue" title={BILLING_UNAVAILABLE_MESSAGE} role="status" mb="md">
                <Text size="sm">
                  Mientras tanto, envíanos la solicitud: te contactamos para activar el plan y
                  confirmar el cobro.{" "}
                  <Anchor href="/precios" target="_blank" rel="noopener noreferrer">
                    Ver planes y precios
                  </Anchor>
                </Text>
              </Alert>
              <Title order={2} id="plan-request-heading" size="h4" mb="sm">
                Solicitar un plan
              </Title>
              <UpgradeRequest request={send} currentPlan={currentPlan} />
            </section>
          )}
          {view && !showRequestForm && (offersCheckout || offersChange) && quotes.length > 0 && (
            <section aria-labelledby="plan-picker-heading" data-testid="plan-picker">
              <Title order={2} id="plan-picker-heading" size="h4">
                {offersChange ? "Cambiar de plan" : "Elige tu plan"}
              </Title>
              <Text size="sm" c="dimmed" mt="xs">
                {catalogPricingNote(view)} {FEL_NOTE}
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mt="md">
                {quotes.map((quote) => {
                  const current =
                    quote.plan === view.billing.plan &&
                    view.billing.status !== "trial" &&
                    view.billing.status !== "none";
                  const trialPlan = quote.plan === view.billing.plan && !current;
                  return (
                    <Card
                      key={quote.plan}
                      withBorder
                      padding="lg"
                      data-testid={`plan-option-${quote.plan}`}
                      aria-label={`Plan ${quote.name}`}
                    >
                      <Stack gap="xs" h="100%">
                        <Group justify="space-between" align="flex-start">
                          <Title order={3} size="h4">
                            {quote.name}
                          </Title>
                          {current && <Badge variant="dot">Tu plan actual</Badge>}
                          {trialPlan && (
                            <Badge variant="dot" color="blue">
                              En prueba
                            </Badge>
                          )}
                        </Group>
                        <Text fw={600}>
                          {formatMinor(quote.unit_amount_minor, quote.currency)}{" "}
                          <Text span size="sm" fw={400}>
                            al mes por sucursal
                          </Text>
                        </Text>
                        <Text size="sm">{quoteLine(quote)}</Text>
                        {quote.single_branch && view.branches > 1 && (
                          <Text size="xs" c="dimmed">
                            Conecta incluye 1 sucursal.
                          </Text>
                        )}
                        <div style={{ marginTop: "auto" }}>
                          {offersCheckout && (
                            <Button
                              fullWidth
                              mt="sm"
                              loading={mutation.busy}
                              onClick={() => startCheckout(quote)}
                              aria-label={`Pagar con tarjeta el plan ${quote.name}`}
                            >
                              Pagar con tarjeta
                            </Button>
                          )}
                          {offersChange && !current && (
                            <Button
                              fullWidth
                              mt="sm"
                              variant="default"
                              disabled={mutation.busy}
                              onClick={() => setChangeTarget(quote)}
                            >
                              Cambiar a {quote.name}
                            </Button>
                          )}
                        </div>
                      </Stack>
                    </Card>
                  );
                })}
              </SimpleGrid>
              {offersCheckout && (
                <Text size="xs" c="dimmed" mt="sm">
                  Al pulsar "Pagar con tarjeta" vas a la página segura de Recurrente, que te pide la
                  tarjeta y tus datos de contacto. Vuelves aquí al terminar y el plan se activa
                  cuando el pago se confirma.
                </Text>
              )}
            </section>
          )}
          {view && canCancel(view) && (
            <Group>
              <Button
                variant="subtle"
                color="gray"
                disabled={mutation.busy}
                onClick={() => setCancelOpen(true)}
              >
                Cancelar al final del período
              </Button>
            </Group>
          )}
          {view && showsInvoices(view) && (
            <section aria-labelledby="plan-invoices-heading">
              <Title order={2} id="plan-invoices-heading" size="h4" mb="xs">
                Cobros y comprobantes
              </Title>
              <Text size="sm" c="dimmed" mb="sm">
                {IVA_NOTE} {FEL_NOTE} En el estado de cuenta de tu tarjeta el cargo aparece a nombre
                de Recurrente.
              </Text>
              <InvoicesTable path="/api/admin/billing/invoices" revision={revision} send={send} />
            </section>
          )}
        </>
      )}
      <Modal
        opened={changeTarget !== null}
        onClose={() => setChangeTarget(null)}
        title={changeTarget && view ? planChangeCopy(view, changeTarget).title : "Cambiar de plan"}
        closeButtonProps={{ "aria-label": "Cerrar ventana" }}
      >
        {changeTarget && view && (
          <Stack gap="sm">
            <Text size="sm">{planChangeCopy(view, changeTarget).body}</Text>
            {mutation.error && <MutationFailure error={mutation.error} />}
            <Group>
              <Button loading={mutation.busy} onClick={() => confirmChange(changeTarget)}>
                {planChangeCopy(view, changeTarget).confirm}
              </Button>
              <Button
                variant="default"
                disabled={mutation.busy}
                onClick={() => setChangeTarget(null)}
              >
                Volver
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={view ? cancelCopy(view).title : "Cancelar"}
        closeButtonProps={{ "aria-label": "Cerrar ventana" }}
      >
        {view && (
          <Stack gap="sm">
            <Text size="sm">{cancelCopy(view).body}</Text>
            {mutation.error && <MutationFailure error={mutation.error} />}
            <Group>
              <Button loading={mutation.busy} onClick={confirmCancel}>
                {cancelCopy(view).confirm}
              </Button>
              <Button
                variant="default"
                disabled={mutation.busy}
                onClick={() => setCancelOpen(false)}
              >
                Seguir con mi plan
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
