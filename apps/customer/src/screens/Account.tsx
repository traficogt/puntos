import React, { useState } from "react";
import { Linking, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
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
import { NotificationSettings } from "../NotificationSettings";

export function Account() {
  const { state, colors, controller, appearance, setAppearance } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await controller.deleteAccount();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <NativeScreen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingVertical: 8,
        }}
      >
        <Ionicons name="person-circle-outline" size={46} color={colors.muted} />
        <View style={{ flex: 1 }}>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.brand, fontSize: 23, lineHeight: 29 }}
          >
            {state.snapshot?.customer.name || "Tu tarjeta de cliente"}
          </Copy>
          {state.snapshot?.customer.phone && (
            <Copy
              style={{
                color: colors.muted,
                fontSize: 14,
                lineHeight: 21,
                marginTop: 4,
              }}
            >
              {state.snapshot.customer.phone}
            </Copy>
          )}
          <Copy
            style={{
              color: colors.muted,
              fontSize: 14,
              lineHeight: 21,
              marginTop: 4,
            }}
          >
            {state.snapshot?.business.name}
          </Copy>
        </View>
      </View>
      <Copy
        style={{
          color: colors.muted,
          fontSize: 13,
          lineHeight: 20,
          marginTop: 8,
        }}
      >
        Tus puntos y recompensas corresponden a este negocio.
      </Copy>

      <SectionTitle>Apariencia</SectionTitle>
      <SettingsGroup>
        {(["system", "light", "dark"] as const).map((value) => (
          <SettingsRow
            key={value}
            label={
              {
                system: "Usar tema del teléfono",
                light: "Tema claro",
                dark: "Tema oscuro",
              }[value]
            }
            icon={
              {
                system: "phone-portrait-outline",
                light: "sunny-outline",
                dark: "moon-outline",
              }[value] as
                | "phone-portrait-outline"
                | "sunny-outline"
                | "moon-outline"
            }
            role="radio"
            selected={appearance === value}
            last={value === "dark"}
            onPress={() => setAppearance(value)}
          />
        ))}
      </SettingsGroup>
      <NotificationSettings />
      <SectionTitle>Ayuda</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          label="Ayuda y soporte"
          icon="help-circle-outline"
          external
          onPress={() =>
            void Linking.openURL("https://puntosfieles.com/soporte")
          }
        />
        <SettingsRow
          label="Aviso de privacidad"
          icon="shield-checkmark-outline"
          external
          last
          onPress={() =>
            void Linking.openURL("https://puntosfieles.com/privacidad.html")
          }
        />
      </SettingsGroup>
      <SectionTitle>Sesión</SectionTitle>
      <SettingsGroup>
        <SettingsRow
          label={
            state.demo
              ? "Salir del ejemplo"
              : "Cerrar sesión y cambiar de negocio"
          }
          icon="log-out-outline"
          last
          disabled={busy}
          onPress={() =>
            void controller
              .signOut()
              .catch(() =>
                setError(
                  "No se pudo borrar el almacenamiento. Cierra la app e intenta de nuevo.",
                ),
              )
          }
        />
      </SettingsGroup>
      <Notice>
        {state.demo
          ? "Este recorrido no creó una cuenta ni cambió puntos."
          : "Al salir se borran los datos guardados de esta cuenta en el dispositivo."}
      </Notice>
      {!state.demo && (
        <View style={{ marginTop: 12 }}>
          {confirm ? (
            <View style={{ gap: 10 }}>
              <Copy
                accessibilityRole="header"
                style={{ fontFamily: fonts.bold }}
              >
                ¿Eliminar tu cuenta de este negocio?
              </Copy>
              <Copy
                style={{
                  color: colors.muted,
                  fontSize: 14,
                  lineHeight: 21,
                  marginBottom: 6,
                }}
              >
                Perderás el acceso a tu tarjeta y a los puntos de este programa.
                Esta acción no se puede deshacer desde la app.
              </Copy>
              <NativeButton
                label="Confirmar eliminación de mi cuenta"
                icon="trash-outline"
                destructive
                loading={busy}
                disabled={state.offline}
                onPress={() => void remove()}
              />
              <NativeButton
                label="Cancelar"
                secondary
                disabled={busy}
                onPress={() => setConfirm(false)}
              />
            </View>
          ) : (
            <SettingsGroup>
              <SettingsRow
                label="Eliminar mi cuenta de este negocio"
                icon="trash-outline"
                destructive
                last
                disabled={state.offline}
                onPress={() => setConfirm(true)}
              />
            </SettingsGroup>
          )}
        </View>
      )}
      {error && <Notice error>{error}</Notice>}
      <Copy
        style={{
          fontFamily: fonts.brand,
          color: colors.muted,
          fontSize: 16,
          lineHeight: 23,
          textAlign: "center",
          marginTop: 28,
        }}
      >
        PuntosFieles.
      </Copy>
      <Copy
        style={{
          color: colors.muted,
          fontSize: 12,
          lineHeight: 18,
          textAlign: "center",
          marginTop: 4,
        }}
      >
        Versión de desarrollo 0.1.0 · Viasolvia
      </Copy>
    </NativeScreen>
  );
}
