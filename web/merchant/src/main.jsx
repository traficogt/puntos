import {staffLoginHref} from "../../../public/staff-return-path.js";
import {startDemoAnalytics,trackDemoEvent} from './demo-analytics.js';
import ActivationSetup from './ActivationSetup.jsx';
import { useMediaQuery } from '@mantine/hooks';
import React, { useEffect, useState, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import {
  MantineProvider,
  createTheme,
  AppShell,
  Alert,
  Anchor,
  Button,
  Group,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
  localStorageColorSchemeManager,
} from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "./styles.css";
import { isDemo, useResource, sessionEvent, stored, logout } from "./api.js";
import { pageFromHash, hashForPage } from "./navigation.js";
import { Loading, Failure, BusinessLink } from "./ui.jsx";
import { setMerchantRegion } from './region.js';
const RewardsWorkspace = lazy(() => import('./RewardsWorkspace.jsx'));
const Fulfillment = lazy(() => import('./Fulfillment.jsx'));
const RegionSettings = lazy(() => import('./RegionSettings.jsx'));
const RewardPromises = lazy(() => import('./RewardPromises.jsx'));
const Hospitality = lazy(() => import('./Hospitality.jsx'));
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
          Recarga la página. Puedes seguir trabajando en administración.
        </Text>
        <Button onClick={() => location.reload()}>Recargar</Button>
        <BusinessLink href="/administracion/">
          Abrir administración
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
        {signedIn ? manager ? "Tu sesión de gerente está activa. Puedes administrar el negocio desde tu área." : "Tu sesión de equipo está activa. Puedes registrar compras y canjes desde el escáner." : "Inicia sesión con una cuenta de propietario para consultar resultados y administrar tu programa."}
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
      {signedIn && <Button component="a" href={manager ? "/administracion/" : "/equipo/escaner/"}>{manager ? "Abrir administración" : "Abrir escáner"}</Button>}
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
  const [page, setPage] = useState(pageFromHash(location.hash) || "overview");
  const [dirty, setDirty] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [focusSection,setFocusSection]=useState(null);
  const plan = useResource("/api/admin/plan", refresh);
  const region = useResource("/api/admin/region", refresh);
  if (region.data) setMerchantRegion(region.data.region);
  const enrollment = useResource("/api/admin/customer-enrollment");
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  useEffect(() => {
    history.replaceState(null, "", hashForPage(page));
    const handler = () => {
      const value = pageFromHash(location.hash);
      if (!value) return;
      if (value === page) {
        history.replaceState(null, "", hashForPage(page));
        return;
      }
      if (
        dirty &&
        !confirm("Tienes cambios sin guardar. ¿Quieres descartarlos?")
      ) {
        history.replaceState(null, "", hashForPage(page));
        return;
      }
      setDirty(false);
      setPage(value);
      history.replaceState(null, "", hashForPage(value));
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [dirty, page]);
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
  function navigate(next) {
    if (next === page) return;
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Quieres descartarlos?"))
      return;
    setDirty(false);
    setPage(next);
    setNavigationOpen(false);
    history.pushState(null, "", hashForPage(next));
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
          <aside className="sidebar">
            <Text className="business-name" fw={600}>
              {name || "Mi negocio"}
            </Text>
            {compactNavigation && <Button variant="outline" fullWidth aria-expanded={navigationOpen} aria-controls="merchant-navigation" onClick={() => setNavigationOpen(v => !v)}>{navigationOpen ? "Cerrar menú del negocio" : "Cambiar sección del negocio"}</Button>}
            <div id="merchant-navigation" hidden={compactNavigation && !navigationOpen}>
            <nav aria-label="Tu negocio">
              <Stack gap={4}>
                {[
                  ["overview", "Resumen"],
                  ["decisions", "Decisiones"],
                  ["cases", "Atención al cliente"],
                  ["authority", "Equipo y permisos"],
                  ["hospitality", "Cortesías del equipo"],
                  ["promises", "Promesas de recompensa"],
                  ["rewards", "Recompensas y catálogo"],
                  ["transactions", "Movimientos"],
                  ["launch", "Preparar mi programa"],
                  ["migration", "Importar clientes"],
                  ["audiences", "Audiencias"],
                  ["campaigns", "Reglas de puntos"],
                  ["growth", "Campañas dirigidas"],
                  ["brand", "Marca y QR"],
                  ["acquisition", "Origen de clientes"],
                  ["economics", "Costos y margen"],
                  ["automations", "Automatizaciones"],
                  ["recovery", "Recuperar clientes"],
                  ["referrals", "Recomendaciones"],
                  ["pos", "Conectar caja"],
                  ["fulfillment", "Canjes y caja"],
                  ["operations", "Estado de la operación"],
                  ["pilot", "Mi piloto"],
                  ["region", "Región del negocio"],
                ].map(([key, label]) => (
                  <Button
                    key={key}
                    justify="start"
                    styles={{root:{height:"auto",minHeight:36,paddingBlock:8},label:{whiteSpace:"normal",textAlign:"left",lineHeight:1.35}}}
                    variant={page === key ? "light" : "subtle"}
                    color={page === key ? "terra" : "gray"}
                    aria-current={page === key ? "page" : undefined}
                    onClick={() => navigate(key)}
                  >
                    {label}
                  </Button>
                ))}
              </Stack>
            </nav>
            <div className="sidebar-secondary">
              <BusinessLink href="/administracion/?seccion=clientes">
                Clientes
              </BusinessLink>
              <BusinessLink href="/administracion/?seccion=analisis">
                Informes detallados
              </BusinessLink>
              <BusinessLink href="/administracion/">Configuración</BusinessLink>
              <BusinessLink href="/equipo/escaner/">Abrir escáner</BusinessLink>
            </div>
            <Text size="xs" c="dimmed" className="plan-name">
              {plan.data?.plan
                ? `Plan ${plan.data.plan}`
                : "Administración del negocio"}
            </Text>
            </div>
          </aside>
          <main id="contenido" tabIndex={-1} className="content">
            {isDemo && (
              <Alert
                mb="xl"
                color="yellow"
                title="Vista previa · datos de ejemplo"
              >
                <Text size="sm">
                  Explora resultados, recomendaciones, recuperación de clientes y
                  conexión de caja sin iniciar sesión. Los cambios se guardan solo en esta pestaña y
                  no afectan a ningún negocio real.
                  <a className="demo-contact-link" href="https://puntosfieles.com/#contacto" onClick={()=>trackDemoEvent('demo_contact_open')}>Hablar con nosotros</a>
                </Text>
              </Alert>
            )}
            {plan.loading || region.loading ? (
              <Loading />
            ) : plan.error || region.error ? (
              <Failure
                error={plan.error || region.error}
                retry={() => setRefresh((v) => v + 1)}
              />
            ) : (
              <Suspense fallback={<Loading />}>
                {page === "overview" ? (
                  <><ActivationSetup region={region.data} features={plan.data?.features||{}} onNavigate={navigate} onConfigure={section=>{setFocusSection(section);navigate('automations');}}/>
                  <Overview features={plan.data?.features || {}} onNavigate={navigate}/></>
                ) : page === "decisions" ? (
                  <Decisions />
                ) : page === "cases" ? (
                  <ServiceCases />
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
                  <Audiences features={plan.data?.features || {}} onDirty={setDirty} />
                ) : page === "automations" ? (
                  <Automations features={plan.data?.features || {}} onDirty={setDirty} focusSection={focusSection} />
                ) : page === "acquisition" ? (
                  <Acquisition features={plan.data?.features || {}} staff={staff} onDirty={setDirty} />
                ) : page === "rewards" ? (
                  <RewardsWorkspace onDirty={setDirty} />
                ) : page === "fulfillment" ? (
                  <Fulfillment />
                ) : page === "economics" ? (
                  <Economics features={plan.data?.features || {}} />
                ) : page === "operations" ? (
                  <Operations />
                ) : page === "pilot" ? (
                  <Pilot features={plan.data?.features || {}} onDirty={setDirty} />
                ) : page === "launch" ? (
                  <Launch staff={staff} features={plan.data?.features || {}} onDirty={setDirty} />
                ) : page === "growth" ? (
                  <GrowthCampaigns features={plan.data?.features || {}} onDirty={setDirty} />
                ) : page === "brand" ? (
                  <BrandedQr features={plan.data?.features || {}} staff={staff} />
                ) : page === "referrals" ? (
                  <Referrals features={plan.data?.features || {}} staff={staff} onDirty={setDirty} />
                ) : page === "pos" ? (
                  <PosConnect features={plan.data?.features || {}} onDirty={setDirty} />
                ) : page === "recovery" ? (
                  <Recovery
                    features={plan.data?.features || {}}
                    onDirty={setDirty}
                  />
                ) : (
                  <Campaigns
                    features={plan.data?.features || {}}
                    onDirty={setDirty}
                  />
                )}
              </Suspense>
            )}
            <footer>
              ¿Necesitas ayuda?{" "}
              <Anchor href="/soporte">Centro de soporte</Anchor>
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
      document.querySelector('meta[name="pf-style-nonce"]')?.content
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
