import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { useClock } from "../use-clock";
import { useApp } from "../context";
import {
  Button,
  Copy,
  Divider,
  Heading,
  Notice,
  Screen,
  layout,
} from "../components";
import { fonts } from "../theme";
import { rewardState, safeGoogleUrl, validQr } from "../model";
export function Card() {
  const { state, colors, controller } = useApp();
  const nav = useRouter();
  const now = useClock(30000);
  const [walletBusy, setWalletBusy] = useState(false),
    [walletMessage, setWalletMessage] = useState("");
  const data = state.snapshot;
  if (!data)
    return (
      <Screen>
        <Heading>Tu tarjeta</Heading>
        <Notice error={!!state.error}>
          {state.error || "Estamos cargando tus puntos y recompensas."}
        </Notice>
        <Button
          label="Volver a cargar"
          loading={state.loading}
          onPress={() => void controller.refresh()}
        />
      </Screen>
    );
  const { customer, business } = data;
  const title =
    business.customer_branding?.customer_program_name || business.name;
  const rewards = data.rewards
    .filter(
      (r) =>
        r.stock !== 0 && (!r.valid_until || Date.parse(r.valid_until) > now),
    )
    .sort((a, b) => a.points_cost - b.points_cost);
  const next =
    rewards.find((r) => r.points_cost > customer.points) || rewards[0];
  const progress = next
    ? Math.min(1, customer.points / Math.max(1, next.points_cost))
    : 0;
  async function wallet(provider: "apple" | "google") {
    if (state.demo) {
      setWalletMessage("Ingresa a tu cuenta para guardar tu tarjeta real.");
      return;
    }
    if (!state.session || state.offline) return;
    setWalletBusy(true);
    setWalletMessage("");
    const token = state.session.token;
    try {
      if (provider === "apple") {
        setWalletMessage(
          "Abre tu tarjeta de PF en Safari para guardarla. Si Safari no tiene tu sesión, te pedirá ingresar.",
        );
        await Linking.openURL(
          "https://app.puntosfieles.com/c#nativeWalletSection",
        );
      } else {
        const result = await controller.authenticated<{ url: string }>(
          "/customer/wallet/google",
          { method: "POST" },
        );
        if (controller.getState().session?.token !== token) return;
        await Linking.openURL(safeGoogleUrl(result.url));
      }
    } catch (e) {
      setWalletMessage((e as Error).message);
    } finally {
      setWalletBusy(false);
    }
  }
  return (
    <Screen refresh>
      <Heading>
        {customer.name
          ? `Hola, ${customer.name.split(" ")[0]}.`
          : "Qué gusto verte."}
      </Heading>
      <Copy style={{ color: colors.muted, marginBottom: 28 }}>
        Tu próxima visita ya tiene algo a favor.
      </Copy>
      <View
        style={{ backgroundColor: colors.card, borderRadius: 16, padding: 24 }}
      >
        <View style={layout.between}>
          <Copy
            style={{
              fontFamily: fonts.brand,
              fontSize: 22,
              color: colors.onCard,
              flex: 1,
            }}
          >
            {title}
          </Copy>
          <Ionicons name="sparkles-outline" color={colors.onCard} size={25} />
        </View>
        <Copy
          style={{
            color: colors.onCard,
            fontFamily: fonts.brand,
            fontSize: 64,
            lineHeight: 76,
            marginTop: 30,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Number(customer.points).toLocaleString("es-GT")}
        </Copy>
        <Copy style={{ color: colors.onCard, marginBottom: 30 }}>
          puntos para disfrutar
        </Copy>
        <View
          style={{
            borderTopWidth: 1,
            borderColor: colors.dark ? "#B8A16E" : "#695B4E",
            paddingTop: 18,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Copy style={{ color: colors.onCard, fontSize: 13 }}>
            Tu tarjeta de lealtad
          </Copy>
          <Copy
            style={{
              fontFamily: fonts.brand,
              color: colors.onCard,
              fontSize: 16,
            }}
          >
            PF.
          </Copy>
        </View>
      </View>
      <View style={{ marginTop: 16 }}>
        <Button
          label={state.demo ? "Conoce tu QR de cliente" : "Mostrar mi QR"}
          icon="qr-code-outline"
          disabled={state.offline}
          onPress={() => nav.push("/qr")}
        />
      </View>
      {Number(customer.pending_points) > 0 && (
        <Notice>
          {customer.pending_points} puntos pendientes de confirmación.
        </Notice>
      )}
      {next && (
        <View style={{ marginTop: 30 }}>
          <Copy
            style={{ fontFamily: fonts.brand, fontSize: 22, marginBottom: 8 }}
          >
            Un poco más cerca.
          </Copy>
          <View style={layout.between}>
            <Copy style={{ flex: 1 }}>{next.name}</Copy>
            <Copy style={{ fontFamily: fonts.bold, fontSize: 14 }}>
              {next.points_cost} pts
            </Copy>
          </View>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Progreso hacia tu recompensa"
            accessibilityValue={{
              min: 0,
              max: next.points_cost,
              now: Math.min(customer.points, next.points_cost),
            }}
            style={{
              height: 5,
              backgroundColor: colors.line,
              borderRadius: 3,
              marginVertical: 14,
            }}
          >
            <View
              style={{
                height: 5,
                width: `${progress * 100}%`,
                backgroundColor: colors.primary,
                borderRadius: 3,
              }}
            />
          </View>
          <Copy style={{ color: colors.muted, fontSize: 14 }}>
            {
              rewardState(
                next,
                customer.points,
                state.offline || !state.fresh,
                now,
              ).label
            }
          </Copy>
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.push("/(tabs)/rewards")}
            style={{ minHeight: 48, justifyContent: "center", marginTop: 8 }}
          >
            <Copy style={{ color: colors.primary, fontFamily: fonts.bold }}>
              Ver mis recompensas
            </Copy>
          </Pressable>
        </View>
      )}
      <Divider />
      <Copy style={{ fontFamily: fonts.brand, fontSize: 22, marginBottom: 8 }}>
        También en tu billetera.
      </Copy>
      <Copy style={{ color: colors.muted, fontSize: 14 }}>
        Tu tarjeta guardada está a mano incluso sin conexión.
      </Copy>
      <View style={{ marginTop: 16, gap: 12 }}>
        {data.wallet.providers.apple &&
          (Platform.OS === "ios" || Platform.OS === "web") && (
            <Button
              label="Apple Wallet · abrir tarjeta web"
              icon="wallet-outline"
              secondary
              disabled={state.offline || walletBusy}
              onPress={() => void wallet("apple")}
            />
          )}{" "}
        {data.wallet.providers.google && (
          <Button
            label="Agregar a la Billetera de Google"
            icon="wallet-outline"
            secondary
            disabled={state.offline || walletBusy}
            onPress={() => void wallet("google")}
          />
        )}
      </View>
      {data.wallet.providers.google && (
        <Notice>
          La Billetera de Google está en pruebas para cuentas autorizadas.
        </Notice>
      )}
      {walletBusy && <ActivityIndicator color={colors.primary} />}{" "}
      {!!walletMessage && <Notice>{walletMessage}</Notice>}
      {state.error && <Notice error>{state.error}</Notice>}
      {!state.demo && state.syncedAt && (
        <Copy style={{ fontSize: 12, color: colors.muted, marginTop: 16 }}>
          Actualizado a las{" "}
          {new Date(state.syncedAt).toLocaleTimeString("es-GT", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          . Desliza para actualizar.
        </Copy>
      )}
    </Screen>
  );
}
export function QrScreen() {
  const { width } = useWindowDimensions();
  const { state, controller, colors } = useApp();
  const [now, setNow] = useState(() => Date.now()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await controller.issueQr();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [controller]);
  useEffect(() => {
    if (!state.demo) queueMicrotask(() => void load());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [load, state.demo]);
  const visible = !state.offline && validQr(state.qr, now);
  return (
    <Screen>
      <Heading>Tu tarjeta, lista en caja.</Heading>
      <Notice>{state.snapshot?.business.name}</Notice>
      <View
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          minHeight: 280,
          backgroundColor: colors.surface,
          borderRadius: 16,
          marginVertical: 20,
        }}
      >
        {state.demo ? (
          <>
            <Ionicons name="qr-code-outline" size={88} color={colors.muted} />
            <Copy style={{ textAlign: "center", marginTop: 20 }}>
              El QR se activa con tu cuenta.
            </Copy>
            <Notice>Este ejemplo no se puede escanear.</Notice>
          </>
        ) : visible ? (
          <View
            style={{ padding: 18, backgroundColor: "#FFFFFF", borderRadius: 8 }}
          >
            <QRCode
              value={state.qr!.token}
              size={Math.min(216, width - 132)}
              quietZone={0}
            />
          </View>
        ) : (
          <>
            <Ionicons name="refresh-outline" size={44} color={colors.primary} />
            <Copy style={{ textAlign: "center", marginTop: 16 }}>
              {state.offline
                ? "Conéctate para mostrar tu QR."
                : "Necesitas un QR vigente."}
            </Copy>
          </>
        )}
      </View>
      {visible && (
        <Copy
          style={{ textAlign: "center", color: colors.muted, marginBottom: 24 }}
        >
          Válido por{" "}
          {Math.max(0, Math.ceil((state.qr!.exp * 1000 - now) / 1000))}{" "}
          segundos.
        </Copy>
      )}
      <Copy style={{ textAlign: "center" }}>
        Muéstralo al equipo del negocio para sumar puntos o canjear una
        recompensa.
      </Copy>
      {!state.demo && (
        <View style={{ marginTop: 24 }}>
          <Button
            label="Actualizar QR"
            loading={busy}
            disabled={state.offline}
            onPress={() => void load()}
          />
        </View>
      )}
      {error && <Notice error>{error}</Notice>}
      <Notice>
        El QR se renueva con conexión. Tu tarjeta guardada en Wallet sigue
        disponible sin conexión.
      </Notice>
    </Screen>
  );
}
