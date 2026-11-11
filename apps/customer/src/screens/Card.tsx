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
import { Copy, Notice } from "../components";
import {
  NativeButton,
  NativeScreen,
  SectionTitle,
  SettingsGroup,
  SettingsRow,
} from "../native-components";
import { fonts } from "../theme";
import { rewardState, safeGoogleUrl, validQr } from "../model";

export function Card() {
  const { state, colors, controller } = useApp();
  const nav = useRouter();
  const now = useClock(30000);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");
  const data = state.snapshot;
  if (!data)
    return (
      <NativeScreen>
        <Notice error={!!state.error}>
          {state.error || "Estamos cargando tus puntos y recompensas."}
        </Notice>
        <NativeButton
          label="Volver a cargar"
          loading={state.loading}
          onPress={() => void controller.refresh()}
        />
      </NativeScreen>
    );

  const { customer, business } = data;
  const title =
    business.customer_branding?.customer_program_name || business.name;
  const rewards =
    business.features?.rewards === false
      ? []
      : data.rewards
          .filter(
            (reward) =>
              (reward.stock == null || Number(reward.stock) > 0) &&
              (!reward.valid_until || Date.parse(reward.valid_until) > now),
          )
          .sort((a, b) => a.points_cost - b.points_cost);
  const next =
    rewards.find((reward) => reward.points_cost > customer.points) ||
    rewards[0];
  const progress = next
    ? Math.min(1, Math.max(0, customer.points / Math.max(1, next.points_cost)))
    : 0;
  const availability = next
    ? rewardState(next, customer.points, state.offline || !state.fresh, now)
    : null;
  const hasAppleWallet =
    data.wallet.providers.apple &&
    (Platform.OS === "ios" || Platform.OS === "web");
  const hasGoogleWallet = data.wallet.providers.google;

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
    <NativeScreen refresh>
      <View
        style={{ backgroundColor: colors.card, borderRadius: 16, padding: 22 }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 16 }}
        >
          <Copy
            accessibilityRole="header"
            style={{
              fontFamily: fonts.brand,
              fontSize: 22,
              lineHeight: 27,
              color: colors.onCard,
              flex: 1,
            }}
          >
            {title}
          </Copy>
          <Copy
            style={{
              fontFamily: fonts.brand,
              fontSize: 21,
              color: colors.onCard,
            }}
          >
            PF.
          </Copy>
        </View>
        <Copy
          style={{
            fontFamily: fonts.bold,
            fontSize: 52,
            lineHeight: 62,
            color: colors.onCard,
            marginTop: 24,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Number(customer.points).toLocaleString("es-GT")}
        </Copy>
        <Copy style={{ color: colors.onCard, fontSize: 15, lineHeight: 23 }}>
          {state.demo
            ? "puntos de ejemplo"
            : state.offline || !state.fresh
            ? "puntos guardados"
            : "puntos disponibles"}
        </Copy>
        <View
          style={{
            borderTopWidth: 1,
            borderColor: colors.dark ? "#B8A16E" : "#695B4E",
            marginTop: 20,
            paddingTop: 14,
          }}
        >
          <Copy style={{ color: colors.onCard, fontSize: 14, lineHeight: 21 }}>
            {customer.name || "Tu tarjeta de lealtad"}
          </Copy>
        </View>
      </View>
      <View style={{ marginTop: 12 }}>
        <NativeButton
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
      {next && availability && (
        <>
          <SectionTitle>
            {availability.available
              ? "Recompensa disponible"
              : "Tu próxima recompensa"}
          </SectionTitle>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver mis recompensas. ${next.name}. ${availability.label}`}
            onPress={() => nav.push("/(tabs)/rewards")}
            style={({ pressed }) => ({
              paddingVertical: 4,
              minHeight: 72,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View style={{ flex: 1 }}>
                <Copy
                  style={{
                    fontFamily: fonts.medium,
                    fontSize: 16,
                    lineHeight: 23,
                  }}
                >
                  {next.name}
                </Copy>
                <Copy
                  style={{
                    color: colors.muted,
                    fontSize: 13,
                    lineHeight: 20,
                    marginTop: 3,
                  }}
                >
                  {next.points_cost.toLocaleString("es-GT")} puntos
                </Copy>
              </View>
              <Ionicons name="chevron-forward" size={21} color={colors.muted} />
            </View>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Progreso hacia tu recompensa"
              accessibilityValue={{
                min: 0,
                max: next.points_cost,
                now: Math.min(Math.max(0, customer.points), next.points_cost),
              }}
              style={{
                height: 6,
                backgroundColor: colors.line,
                borderRadius: 3,
                marginTop: 14,
                marginBottom: 10,
              }}
            >
              <View
                style={{
                  height: 6,
                  width: `${progress * 100}%`,
                  backgroundColor: colors.primary,
                  borderRadius: 3,
                }}
              />
            </View>
            <Copy
              style={{
                color: availability.available ? colors.success : colors.muted,
                fontSize: 14,
                lineHeight: 21,
              }}
            >
              {availability.label}
            </Copy>
          </Pressable>
        </>
      )}
      {(hasAppleWallet || hasGoogleWallet) && (
        <>
          <SectionTitle>Guardar tarjeta</SectionTitle>
          <SettingsGroup>
            {hasAppleWallet && (
              <SettingsRow
                label="Apple Wallet"
                detail="Abrir tarjeta web"
                icon="logo-apple"
                external
                disabled={state.offline || walletBusy}
                last={!hasGoogleWallet}
                onPress={() => void wallet("apple")}
              />
            )}
            {hasGoogleWallet && (
              <SettingsRow
                label="Billetera de Google"
                detail="Agregar tarjeta"
                icon="logo-google"
                external
                disabled={state.offline || walletBusy}
                last
                onPress={() => void wallet("google")}
              />
            )}
          </SettingsGroup>
          <Copy
            style={{
              color: colors.muted,
              fontSize: 13,
              lineHeight: 20,
              marginTop: 10,
            }}
          >
            La tarjeta guardada en Wallet está disponible sin conexión.
          </Copy>
          {hasGoogleWallet && (
            <Notice>
              La Billetera de Google está en pruebas para cuentas autorizadas.
            </Notice>
          )}
        </>
      )}
      {walletBusy && (
        <ActivityIndicator
          accessibilityLabel="Abriendo billetera"
          color={colors.primary}
          style={{ marginTop: 12 }}
        />
      )}
      {!!walletMessage && <Notice>{walletMessage}</Notice>}
      {state.error && <Notice error>{state.error}</Notice>}
      {!state.demo && state.syncedAt && (
        <Copy
          style={{
            fontSize: 12,
            lineHeight: 18,
            color: colors.muted,
            marginTop: 20,
          }}
        >
          Actualizado a las{" "}
          {new Date(state.syncedAt).toLocaleTimeString("es-GT", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          . Desliza para actualizar.
        </Copy>
      )}
    </NativeScreen>
  );
}

export function QrScreen() {
  const { width } = useWindowDimensions();
  const { state, controller, colors } = useApp();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    <NativeScreen style={{ maxWidth: 520 }}>
      <Copy
        accessibilityRole="header"
        style={{
          fontFamily: fonts.brand,
          fontSize: 24,
          lineHeight: 30,
          textAlign: "center",
          marginTop: 16,
        }}
      >
        Muestra este QR en caja
      </Copy>
      <Copy style={{ textAlign: "center", color: colors.muted, marginTop: 8 }}>
        {state.snapshot?.business.name}
      </Copy>
      <View
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          minHeight: 292,
          backgroundColor: colors.surface,
          borderRadius: 16,
          marginTop: 28,
          marginBottom: 16,
        }}
      >
        {state.demo ? (
          <>
            <Ionicons name="qr-code-outline" size={88} color={colors.muted} />
            <Copy
              style={{
                textAlign: "center",
                marginTop: 20,
                fontFamily: fonts.medium,
              }}
            >
              El QR se activa con tu cuenta.
            </Copy>
            <Copy
              style={{
                textAlign: "center",
                color: colors.muted,
                fontSize: 14,
                lineHeight: 21,
                marginTop: 8,
              }}
            >
              Vista de ejemplo · No se puede escanear.
            </Copy>
          </>
        ) : visible ? (
          <View
            accessible
            accessibilityLabel="QR de cliente vigente"
            style={{ padding: 20, backgroundColor: "#FFFFFF", borderRadius: 8 }}
          >
            <QRCode
              value={state.qr!.token}
              size={Math.min(240, width - 120)}
              quietZone={0}
            />
          </View>
        ) : busy ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Copy
              style={{
                textAlign: "center",
                color: colors.muted,
                marginTop: 16,
              }}
            >
              Preparando tu QR…
            </Copy>
          </>
        ) : (
          <>
            <Ionicons
              name={state.offline ? "cloud-offline-outline" : "refresh-outline"}
              size={44}
              color={colors.muted}
            />
            <Copy style={{ textAlign: "center", marginTop: 16 }}>
              {state.offline
                ? "Conéctate para mostrar tu QR."
                : "Necesitas un QR vigente."}
            </Copy>
          </>
        )}
      </View>
      {visible && !state.demo && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: 6,
            marginBottom: 20,
          }}
        >
          <Ionicons name="time-outline" size={17} color={colors.muted} />
          <Copy
            style={{
              color: colors.muted,
              fontSize: 14,
              lineHeight: 21,
              flexShrink: 1,
            }}
          >
            Válido por{" "}
            {Math.max(0, Math.ceil((state.qr!.exp * 1000 - now) / 1000))}{" "}
            segundos.
          </Copy>
        </View>
      )}
      <Copy style={{ textAlign: "center", fontSize: 15, lineHeight: 23 }}>
        El equipo del negocio lo escanea para sumar puntos o canjear una
        recompensa.
      </Copy>
      {!state.demo && (
        <View style={{ marginTop: 24 }}>
          <NativeButton
            label="Actualizar QR"
            icon="refresh-outline"
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
    </NativeScreen>
  );
}
