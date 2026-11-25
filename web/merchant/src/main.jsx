import "./uuid-fallback.js";
import {staffLoginHref} from "../../../public/staff-return-path.js";
import {startDemoAnalytics,trackDemoEvent} from './demo-analytics.js';
import ActivationSetup from './ActivationSetup.jsx';
import { useMediaQuery } from '@mantine/hooks';
import React, { useEffect, useRef, useState, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import {
  MantineProvider,
  createTheme,
  AppShell,
  Alert,
  Anchor,
  Button,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
  useComputedColorScheme,
  localStorageColorSchemeManager,
} from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "./styles.css";
import { api, isDemo, useResource, sessionEvent, stored, logout, trialLockedEvent } from "./api.js";
import { pageFromHash, hashForPage } from "./navigation.js";
import MerchantNavigation from "./MerchantNavigation.jsx";
import DemoGuide, { DemoWelcome } from "./DemoGuide.jsx";
import { demoView, demoLocation } from "./demo-guide.js";
import { demoThemeOptions, demoThemeKey } from "./demo-catalog.js";
import { Loading, Failure, BusinessLink } from "./ui.jsx";
import TrialBanner from "./TrialBanner.tsx";
import { normalizeTrial, planDisplayName, trialPhase } from "./trial-model.ts";
import { parseBillingReturn } from "./billing-model.ts";
import { setMerchantRegion } from './region.js';
const OwnerCustomers = lazy(() => import('./OwnerCustomers.tsx'));
const OwnerTeam = lazy(() => import('./OwnerTeam.tsx'));
const OwnerBranches = lazy(() => import('./OwnerBranches.tsx'));
const OwnerSettings = lazy(() => import('./OwnerSettings.tsx'));
const OwnerBranding = lazy(() => import('./OwnerBranding.tsx'));
const OwnerTiers = lazy(() => import('./OwnerTiers.tsx'));
const OwnerGamification = lazy(() => import('./OwnerGamification.tsx'));
const OwnerGiftCards = lazy(() => import('./OwnerGiftCards.tsx'));
const OwnerReports = lazy(() => import('./OwnerReports.tsx'));
const OwnerProgramLimits = lazy(() => import('./OwnerProgramLimits.tsx'));
const OwnerOnboarding = lazy(() => import('./OwnerOnboarding.tsx'));
const OwnerProgress = lazy(() => import('./OwnerProgress.tsx'));
// self-serve trial (docs/product/2026-11-25-self-serve-trial.md §7.3)
const OwnerTrialLocked = lazy(() => import('./OwnerTrialLocked.tsx'));
const UpgradeRequest = lazy(() => import('./UpgradeRequest.tsx'));
// Plan y facturación: card checkout through Recurrente (wave 2, design §4.4)
const OwnerPlan = lazy(() => import('./OwnerPlan.tsx'));
// operations (wave 15b)
const OwnerJobs = lazy(() => import('./OwnerJobs.tsx'));
const OwnerAlerts = lazy(() => import('./OwnerAlerts.tsx'));
const OwnerLedger = lazy(() => import('./OwnerLedger.tsx'));
const OwnerAudit = lazy(() => import('./OwnerAudit.tsx'));
// analytics (wave 15a)
const OwnerAnalytics = lazy(() => import('./OwnerAnalytics.tsx'));
const OwnerRewardRedemptions = lazy(() => import('./OwnerRewardRedemptions.tsx'));
const RewardsWorkspace = lazy(() => import('./RewardsWorkspace.jsx'));
const Fulfillment = lazy(() => import('./Fulfillment.jsx'));
const RegionSettings = lazy(() => import('./RegionSettings.jsx'));
const RewardPromises = lazy(() => import('./RewardPromises.jsx'));
const Hospitality = lazy(() => import('./Hospitality.jsx'));
const DemandNotebook=lazy(()=>import('./DemandNotebook.jsx').then(m=>({default:m.DemandNotebook})));
const SupplierFunding=lazy(()=>import('./SupplierFunding.jsx').then(m=>({default:m.SupplierFunding})));
const Decisions = lazy(() => import("./Decisions.jsx"));
const ServiceCases = lazy(() => import("./ServiceCases.jsx"));
const StaffAuthority = lazy(() => import("./StaffAuthority.jsx"));
const TransactionHistory = lazy(() => import("./TransactionHistory.jsx"));
const CustomerMigration = lazy(() => import("./CustomerMigration.jsx"));
const Audiences = lazy(() => import("./Audiences.jsx"));
const Automations = lazy(() => import("./Automations.jsx"));
const Acquisition = lazy(() => import("./Acquisition.jsx"));
const Economics = lazy(() => import("./Economics.jsx"));
const Operations = lazy(() => import("./Operations.jsx"));
const Pilot = lazy(() => import("./Pilot.jsx"));
const Overview = lazy(() => import("./Overview.jsx"));
const Launch = lazy(() => import("./Launch.jsx"));
const Referrals = lazy(() => import("./Referrals.jsx"));
const PosConnect = lazy(() => import("./PosConnect.jsx"));
const Recovery = lazy(() => import("./Recovery.jsx"));
const GrowthCampaigns = lazy(() => import("./GrowthCampaigns.jsx"));
const BrandedQr = lazy(() => import("./BrandedQr.jsx"));
const Campaigns = lazy(() => import("./Campaigns.jsx"));
const theme = createTheme({
  primaryColor: "terra",
  autoContrast: true,
  primaryShade: { light: 7, dark: 7 },
  defaultRadius: "md",
  fontFamily: "Inter, sans-serif",
  headings: {
    fontFamily: "Bricolage Grotesque, sans-serif",
    fontWeight: "600",
  },
  colors: {
    terra: [
      "#fff2ed",
      "#ffded1",
      "#f8b9a2",
      "#ef9678",
      "#df7654",
      "#cb5e3c",
      "#b94d2f",
      "#a43d28",
      "#8d3322",
      "#752b1f",
    ],
    dark: [
      "#f7f5ef",
      "#dbd4ca",
      "#b9b0a5",
      "#8a7f73",
      "#62584e",
      "#453c34",
      "#332d27",
      "#251f1b",
      "#1d1915",
      "#15120f",
    ],
  },
});
/** @extends {React.Component<{ children?: React.ReactNode }, { failed: boolean }>} */
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Stack p="xl">
        <Title order={1}>El panel no pudo abrirse</Title>
        <Text>
          Recarga la página. Si el problema continúa, el escáner del equipo sigue disponible.
        </Text>
        <Button onClick={() => location.reload()}>Recargar</Button>
        <BusinessLink href="/equipo/escaner/">
          Abrir escáner
        </BusinessLink>
      </Stack>
    ) : (
      this.props.children
    );
  }
}
function Access({ pending = false, staff = null }) {
  const manager = staff?.role === "MANAGER";
  const signedIn = !!staff;
  const loginHref = staffLoginHref(location.pathname + location.hash);
  const [error, setError] = useState("");
  async function finish() {
    try {
      setError("");
      await logout();
    } catch {
      setError(
        "No se pudo cerrar la sesión en el servidor. Reconecta y vuelve a intentarlo.",
      );
    }
  }
  useEffect(() => {
    if (!pending) return;
    const online = () => void finish();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [pending]);
  return (
    <Stack maw={560} mx="auto" p="xl" mt="10vh">
      <img src="/icon.svg?v=4" alt="PuntosFieles" width="48" height="48" />
      <Title order={1}>{signedIn ? "Este panel es para propietarios" : "Ingresa a tu negocio"}</Title>
      <Text>
        {signedIn ? manager ? "Tu sesión de gerente está activa. Puedes registrar compras, canjes y tarjetas de regalo desde el escáner." : "Tu sesión de equipo está activa. Puedes registrar compras y canjes desde el escáner." : "Inicia sesión con una cuenta de propietario para consultar resultados y administrar tu programa."}
      </Text>
      {error && (
        <Text c="red" role="alert">
          {error}
        </Text>
      )}
      {pending && (
        <Button variant="outline" onClick={finish}>
          Completar cierre de sesión
        </Button>
      )}
      {signedIn && <Button component="a" href="/equipo/escaner/">Abrir escáner</Button>}
      <Button component="a" href={loginHref} variant={signedIn ? "outline" : "filled"}>
        {signedIn ? "Ingresar con otra cuenta" : "Iniciar sesión"}
      </Button>
    </Stack>
  );
}
startDemoAnalytics();
function App() {
  const [invalid, setInvalid] = useState(
    stored("pf_staff_logout_pending") === "1",
  );
  const [attempt, setAttempt] = useState(0);
  const session = useResource(invalid ? null : "/api/staff/me", attempt);
  useEffect(() => {
    const invalidate = () => setInvalid(true);
    window.addEventListener(sessionEvent, invalidate);
    return () => window.removeEventListener(sessionEvent, invalidate);
  }, []);
  if (invalid)
    return <Access pending={stored("pf_staff_logout_pending") === "1"} />;
  if (session.loading)
    return (
      <Stack p="xl">
        <Loading />
      </Stack>
    );
  if (session.error)
    return (
      <Stack p="xl">
        <Failure error={session.error} retry={() => setAttempt((v) => v + 1)} />
        <BusinessLink href={staffLoginHref(location.pathname + location.hash)}>Iniciar sesión</BusinessLink>
      </Stack>
    );
  if (session.data?.staff?.role !== "OWNER") return <Access staff={session.data?.staff} />;
  return <Merchant staff={session.data.staff} />;
}
function Merchant({ staff }) {
  const compactNavigation = useMediaQuery("(max-width: 760px)");
  const [navigationOpen,setNavigationOpen] = useState(false);
  const navigationToggle = useRef(null);
  const content = useRef(null);
  const [page, setPage] = useState(pageFromHash(location.hash) || "overview");
  const [demoMode, setDemoMode] = useState(() => isDemo ? demoView(new URL(location.href)) : null);
  const focusAfterNavigation = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [focusSection,setFocusSection]=useState(null);
  // Billing changes (payment confirmed, plan changed or canceled) re-read plan and trial under
  // their own key and keep the last plan snapshot, so the open page stays mounted (no Loading gate).
  const [billingRevision, setBillingRevision] = useState(0);
  const plan = useResource("/api/admin/plan", `${refresh}:${billingRevision}`);
  const planCache = useRef(null);
  if (plan.data) planCache.current = plan.data;
  const planData = plan.data || (billingRevision > 0 ? planCache.current : null);
  const region = useResource("/api/admin/region", refresh);
  if (region.data) setMerchantRegion(region.data.region);
  const enrollment = useResource("/api/admin/customer-enrollment");
  // Trial state: GET /api/admin/trial, or the additive trial/billing fields on /api/admin/plan.
  // A 404 (feature not deployed) or a legacy business yields null and nothing is shown.
  const trialResource = useResource("/api/admin/trial", `${refresh}:${billingRevision}`);
  const [lockedBy, setLockedBy] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Recurrente returns to `#plan?checkout=<id>&resultado=…`; read it before the hash is normalised.
  const [billingReturn] = useState(() => parseBillingReturn(location.hash));
  useEffect(() => {
    const onLock = (event) => setLockedBy(event.detail || {});
    window.addEventListener(trialLockedEvent, onLock);
    return () => window.removeEventListener(trialLockedEvent, onLock);
  }, []);
  const trialState = normalizeTrial(trialResource.data) || normalizeTrial(planData);
  const trialLocked = trialPhase(trialState) === "locked" || lockedBy !== null;
  const planLabel = trialState?.plan_name || planDisplayName(planData?.plan);
  // With card checkout available, every "Mejorar plan" leads to #plan; otherwise the request form.
  const upgradeAvailable = !!trialState?.upgrade_available;
  const openUpgrade = () => {
    if (upgradeAvailable) navigate("plan");
    else setUpgradeOpen(true);
  };
  const billingChanged = () => {
    setLockedBy(null);
    setBillingRevision((v) => v + 1);
  };
  const { toggleColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  useEffect(() => {
    const currentLocation = () => isDemo ? demoLocation(new URL(location.href), page, demoMode) : hashForPage(page);
    history.replaceState(null, "", currentLocation());
    let handled = location.href;
    const handler = () => {
      if (handled === location.href) return;
      handled = location.href;
      const value = pageFromHash(location.hash);
      if (!value) return;
      const mode = isDemo ? demoView(new URL(location.href)) : null;
      const leavesForm = value !== page || mode === "inicio";
      if (leavesForm && dirty && !confirm("Tienes cambios sin guardar. ¿Quieres descartarlos?")) {
        history.replaceState(null, "", currentLocation());
        handled = location.href;
        return;
      }
      if (leavesForm) setDirty(false);
      setPage(value);
      setDemoMode(mode);
      history.replaceState(null, "", isDemo ? demoLocation(new URL(location.href), value, mode) : hashForPage(value));
      handled = location.href;
    };
    window.addEventListener("hashchange", handler);
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("hashchange", handler);
      window.removeEventListener("popstate", handler);
    };
  }, [dirty, page, demoMode]);
  useEffect(() => {
    if (focusAfterNavigation.current) {
      content.current?.focus({ preventScroll: true });
      content.current?.scrollIntoView({ block: "start" });
      focusAfterNavigation.current = false;
    }
  }, [page, demoMode]);
  useEffect(() => {
    const before = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  function navigate(next, nextMode = isDemo ? "libre" : null) {
    if (next === page && nextMode === demoMode) {
      setNavigationOpen(false);
      if (compactNavigation) content.current?.focus({ preventScroll: true });
      return;
    }
    const leavesForm = next !== page || nextMode === "inicio";
    if (leavesForm && dirty && !confirm("Tienes cambios sin guardar. ¿Quieres descartarlos?")) return;
    if (leavesForm) setDirty(false);
    focusAfterNavigation.current = compactNavigation || nextMode === "guia" || demoMode === "inicio";
    setPage(next);
    setDemoMode(nextMode);
    setNavigationOpen(false);
    history.pushState(null, "", isDemo ? demoLocation(new URL(location.href), next, nextMode) : hashForPage(next));
  }
  async function signOut() {
    if (
      dirty &&
      !confirm("Tienes cambios sin guardar. ¿Cerrar sesión y descartarlos?")
    )
      return;
    try {
      await logout();
    } catch {
      /* Access offers retry and clears the private view immediately. */
    }
  }
  const business = enrollment.data?.business;
  const name = business?.id === staff.business_id ? business.name : null;
  return (
    <AppShell header={{ height: 80 }} padding={0}>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <AppShell.Header>
        <div className="topbar">
          <Anchor
            href={isDemo ? "/demostracion/" : "/negocio/"}
            className="brand"
            underline="never"
          >
            <img src="/icon.svg?v=4" width="34" height="34" alt="" />
            <span>PuntosFieles</span>
          </Anchor>
          <Group gap="xs">
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={toggleColorScheme}
            >
              {colorScheme === "dark" ? "Tema claro" : "Tema oscuro"}
            </Button>
            <Button variant="default" size="compact-sm" onClick={signOut}>
              {isDemo ? "Salir de la demo" : "Salir"}
            </Button>
          </Group>
        </div>
      </AppShell.Header>
      <AppShell.Main component="div">
        <div className="workspace">
          <aside className="sidebar" onKeyDown={event => {
            if (compactNavigation && navigationOpen && event.key === "Escape") {
              setNavigationOpen(false);
              navigationToggle.current?.focus();
            }
          }}>
            <Text className="business-name" fw={600}>
              {name || "Mi negocio"}
            </Text>
            {compactNavigation && <Button ref={navigationToggle} variant="outline" fullWidth aria-expanded={navigationOpen} aria-controls="merchant-navigation" onClick={() => setNavigationOpen(v => !v)}>{navigationOpen ? "Cerrar menú del negocio" : "Cambiar sección del negocio"}</Button>}
            <div id="merchant-navigation" hidden={compactNavigation && !navigationOpen}>
            <MerchantNavigation page={page} visible={!compactNavigation || navigationOpen} onNavigate={navigate} features={planData?.features} />
            <div className="sidebar-secondary">
              {planData?.features?.analytics && (
                <Anchor component="button" type="button" onClick={() => navigate("analytics")}>
                  Informes detallados
                </Anchor>
              )}
              <BusinessLink href="/equipo/escaner/">Abrir escáner</BusinessLink>
            </div>
            <Text size="xs" c="dimmed" className="plan-name">
              {planLabel ? `Plan ${planLabel}` : "Administración del negocio"}
            </Text>
            </div>
          </aside>
          <main ref={content} id="contenido" tabIndex={-1} className="content">
            {isDemo && (
              <Alert
                mb="xl"
                color="yellow"
                title="Vista previa · datos de ejemplo"
              >
                <Text size="sm">
                  Todo lo que ves es ficticio. Puedes probar las herramientas sin iniciar sesión;
                  los cambios se descartan al recargar y no afectan a ningún negocio real.
                  <a className="demo-contact-link" href="https://puntosfieles.com/#contacto" onClick={()=>trackDemoEvent('demo_contact_open')}>Hablar con nosotros</a>
                </Text>
                <Text size="sm" mt="xs"><strong>Funciones según el plan</strong>. La demo incluye herramientas de distintos planes. Recuperación, campañas y costos: desde Negocio. <Anchor href="/precios">Comparar planes</Anchor></Text>
                <Group gap="xs" mt="md" align="flex-end">
                  <NativeSelect
                    size="xs"
                    label="Ver la demo para otro tipo de negocio"
                    data={demoThemeOptions}
                    value={demoThemeKey()}
                    onChange={event => { const url = new URL(location.href); url.searchParams.set("ejemplo", event.currentTarget.value); location.assign(url.pathname + url.search + url.hash); }}
                  />
                </Group>
              </Alert>
            )}
            {isDemo && <DemoGuide page={page} mode={demoMode} onNavigate={navigate} />}
            {!trialLocked && <TrialBanner state={trialState} onUpgrade={openUpgrade} />}
            {trialLocked && page !== "overview" && page !== "plan" && (
              <Suspense fallback={null}>
                <OwnerTrialLocked compact state={trialState} onUpgrade={openUpgrade} />
              </Suspense>
            )}
            <Modal opened={upgradeOpen} onClose={() => setUpgradeOpen(false)} title="Mejorar plan" size="lg" closeButtonProps={{ "aria-label": "Cerrar ventana" }}>
              <Suspense fallback={<Loading label="Preparando la solicitud…" />}>
                <UpgradeRequest request={api} currentPlan={trialState?.plan || planData?.plan || null} onDone={() => setUpgradeOpen(false)} upgradeAvailable={upgradeAvailable} onOpenPlan={() => { setUpgradeOpen(false); navigate("plan"); }} />
              </Suspense>
            </Modal>
            {isDemo && demoMode === "inicio" ? <DemoWelcome onNavigate={navigate} /> : (plan.loading && !planData) || region.loading ? (
              <Loading />
            ) : plan.error || region.error ? (
              <Failure
                error={plan.error || region.error}
                retry={() => setRefresh((v) => v + 1)}
              />
            ) : (
              <Suspense fallback={<Loading />}>
                {trialLocked && page === "overview" ? (
                  <OwnerTrialLocked state={trialState} onUpgrade={openUpgrade} onNavigate={navigate} />
                ) : page === "overview" ? (
                  <><ActivationSetup region={region.data} features={planData?.features||{}} onNavigate={navigate} onConfigure={section=>{setFocusSection(section);navigate('automations');}}/>
                  <Overview features={planData?.features || {}} onNavigate={navigate}/></>
                ) : page === "progress" ? (
                  <OwnerProgress staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "customers" ? (
                  <OwnerCustomers staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "team" ? (
                  <OwnerTeam staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "branches" ? (
                  <OwnerBranches staff={staff} features={planData?.features || {}} limits={planData?.limits || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "settings" ? (
                  <OwnerSettings staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "plan" ? (
                  <OwnerPlan staff={staff} features={planData?.features || {}} onNavigate={navigate} trialState={trialState} checkoutReturn={billingReturn} onBillingChanged={billingChanged} />
                ) : page === "branding" ? (
                  <OwnerBranding staff={staff} features={planData?.features || {}} plan={planData?.plan} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "tiers" ? (
                  <OwnerTiers staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "gamification" ? (
                  <OwnerGamification staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "giftcards" ? (
                  <OwnerGiftCards staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "reports" ? (
                  <OwnerReports staff={staff} features={planData?.features || {}} limits={planData?.limits || {}} usage={planData?.usage} onNavigate={navigate} />
                ) : page === "limits" ? (
                  <OwnerProgramLimits staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "onboarding" ? (
                  <OwnerOnboarding staff={staff} features={planData?.features || {}} onNavigate={navigate} />
                ) : page === "analytics" ? (
                  <OwnerAnalytics staff={staff} features={planData?.features || {}} onNavigate={navigate} />
                ) : page === "redemptions" ? (
                  <OwnerRewardRedemptions staff={staff} features={planData?.features || {}} onNavigate={navigate} />
                ) : page === "decisions" ? (
                  <Decisions />
                ) : page === "cases" ? (
                  <ServiceCases />
                ) : page === "demand" ? (
                  <DemandNotebook/>
                ) : page === "funding" ? (
                  <SupplierFunding/>
                ) : page === "authority" ? (
                  <StaffAuthority />
                ) : page === "hospitality" ? (
                  <Hospitality />
                ) : page === "promises" ? (
                  <RewardPromises />
                ) : page === "region" ? (
                  <RegionSettings onDirty={setDirty} onSaved={() => setRefresh(v => v + 1)} />
                ) : page === "transactions" ? (
                  <TransactionHistory />
                ) : page === "migration" ? (
                  <CustomerMigration onDirty={setDirty} />
                ) : page === "audiences" ? (
                  <Audiences features={planData?.features || {}} onDirty={setDirty} />
                ) : page === "automations" ? (
                  <Automations features={planData?.features || {}} onDirty={setDirty} focusSection={focusSection} />
                ) : page === "acquisition" ? (
                  <Acquisition features={planData?.features || {}} staff={staff} onDirty={setDirty} />
                ) : page === "rewards" ? (
                  <RewardsWorkspace onDirty={setDirty} />
                ) : page === "fulfillment" ? (
                  <Fulfillment />
                ) : page === "economics" ? (
                  <Economics features={planData?.features || {}} />
                ) : page === "operations" ? (
                  <Operations />
                ) : page === "pilot" ? (
                  <Pilot features={planData?.features || {}} onDirty={setDirty} />
                ) : page === "launch" ? (
                  <Launch staff={staff} features={planData?.features || {}} onDirty={setDirty} />
                ) : page === "growth" ? (
                  <GrowthCampaigns features={planData?.features || {}} onDirty={setDirty} />
                ) : page === "brand" ? (
                  <BrandedQr features={planData?.features || {}} staff={staff} />
                ) : page === "referrals" ? (
                  <Referrals features={planData?.features || {}} staff={staff} onDirty={setDirty} />
                ) : page === "pos" ? (
                  <PosConnect features={planData?.features || {}} onDirty={setDirty} />
                ) : page === "recovery" ? (
                  <Recovery
                    features={planData?.features || {}}
                    onDirty={setDirty}
                  />
                ) : /* operations (wave 15b) */ page === "jobs" ? (
                  <OwnerJobs staff={staff} features={planData?.features || {}} onNavigate={navigate} />
                ) : page === "alerts" ? (
                  <OwnerAlerts staff={staff} features={planData?.features || {}} onNavigate={navigate} />
                ) : page === "ledger" ? (
                  <OwnerLedger staff={staff} features={planData?.features || {}} onDirty={setDirty} onNavigate={navigate} />
                ) : page === "audit" ? (
                  <OwnerAudit staff={staff} features={planData?.features || {}} onNavigate={navigate} />
                ) : (
                  <Campaigns
                    features={planData?.features || {}}
                    onDirty={setDirty}
                  />
                )}
              </Suspense>
            )}
            <footer>
              ¿Necesitas ayuda?{" "}
              <Anchor href="/ayuda/negocio/" target="_blank" rel="noopener noreferrer">Ayuda para tu negocio</Anchor>
              {" · "}<Anchor href="/soporte" target="_blank" rel="noopener noreferrer">Contactar soporte</Anchor>
              {" · "}<Anchor href="https://traficogt.github.io/puntos-estado/" target="_blank" rel="noopener noreferrer">Estado del servicio</Anchor>
            </footer>
          </main>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
createRoot(document.getElementById("root")).render(
  <MantineProvider
    getStyleNonce={() =>
      /** @type {HTMLMetaElement | null} */ (document.querySelector('meta[name="pf-style-nonce"]'))?.content
    }
    theme={theme}
    defaultColorScheme="auto"
    colorSchemeManager={localStorageColorSchemeManager({ key: "pf-theme" })}
  >
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </MantineProvider>,
);
