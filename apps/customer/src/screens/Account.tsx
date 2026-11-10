import React, { useState } from "react";
import { Linking, View } from "react-native";
import { useApp } from "../context";
import { Button, Copy, Divider, Heading, Notice, Screen } from "../components";
import { fonts } from "../theme";
import { NotificationSettings } from "../NotificationSettings";
export function Account() {
  const { state, colors, controller, appearance, setAppearance } = useApp();
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    <Screen>
      <Heading>Tu cuenta.</Heading>
      <Copy style={{ fontFamily: fonts.brand, fontSize: 24, marginTop: 12 }}>
        {state.snapshot?.customer.name || "Tu tarjeta de cliente"}
      </Copy>
      {state.snapshot?.customer.phone && (
        <Copy style={{ color: colors.muted, marginTop: 6 }}>
          {state.snapshot.customer.phone}
        </Copy>
      )}
      <Notice>
        {state.snapshot?.business.name}. Los puntos y recompensas corresponden a
        este negocio.
      </Notice>
      <Divider />
      <Copy style={{ fontFamily: fonts.brand, fontSize: 22, marginBottom: 16 }}>
        A tu manera.
      </Copy>
      <View style={{ gap: 10 }}>
        {(["system", "light", "dark"] as const).map((value) => (
          <Button
            key={value}
            label={`${appearance === value ? "Seleccionado: " : ""}${{ system: "Usar tema del teléfono", light: "Tema claro", dark: "Tema oscuro" }[value]}`}
            secondary={appearance !== value}
            onPress={() => setAppearance(value)}
          />
        ))}
      </View>
      <NotificationSettings />
      <Divider />
      <Button
        label="Ayuda y soporte"
        secondary
        icon="help-circle-outline"
        onPress={() => void Linking.openURL("https://puntosfieles.com/soporte")}
      />
      <View style={{ marginTop: 12 }}>
        <Button
          label="Aviso de privacidad"
          secondary
          onPress={() =>
            void Linking.openURL("https://puntosfieles.com/privacidad.html")
          }
        />
      </View>
      <Divider />
      <Button
        label={
          state.demo
            ? "Salir del ejemplo"
            : "Cerrar sesión y cambiar de negocio"
        }
        secondary
        icon="log-out-outline"
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
      <Notice>
        {state.demo
          ? "Este recorrido no creó una cuenta ni cambió puntos."
          : "Al salir se borran los datos guardados de esta cuenta en el dispositivo."}
      </Notice>
      {!state.demo && (
        <View style={{ marginTop: 20 }}>
          {confirm ? (
            <>
              <Copy style={{ fontFamily: fonts.bold }}>
                ¿Eliminar tu cuenta de este negocio?
              </Copy>
              <Notice>
                Perderás el acceso a tu tarjeta y a los puntos de este programa.
                Esta acción no se puede deshacer desde la app.
              </Notice>
              <Button
                label="Confirmar eliminación de mi cuenta"
                loading={busy}
                disabled={state.offline}
                onPress={() => void remove()}
              />
              <View style={{ marginTop: 10 }}>
                <Button
                  label="Cancelar"
                  secondary
                  disabled={busy}
                  onPress={() => setConfirm(false)}
                />
              </View>
            </>
          ) : (
            <Button
              label="Eliminar mi cuenta de este negocio"
              secondary
              disabled={state.offline}
              onPress={() => setConfirm(true)}
            />
          )}
        </View>
      )}
      {error && <Notice error>{error}</Notice>}
      <Copy
        style={{
          fontFamily: fonts.brand,
          fontSize: 18,
          textAlign: "center",
          marginTop: 40,
        }}
      >
        PuntosFieles.
      </Copy>
      <Copy
        style={{
          color: colors.muted,
          fontSize: 12,
          textAlign: "center",
          marginTop: 8,
        }}
      >
        Versión de desarrollo 0.1.0 · Viasolvia
      </Copy>
    </Screen>
  );
}
