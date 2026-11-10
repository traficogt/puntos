import React, { useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useApp } from "./context";
import { Button, Copy, Divider, Notice } from "./components";
import { fonts } from "./theme";
import { openNotificationSettings } from "./push-platform";
export function NotificationSettings() {
  const { push, state: account } = useApp();
  const state = useSyncExternalStore(
    push.subscribe,
    push.getState,
    push.getState,
  );
  const [settingsError, setSettingsError] = useState(false);
  if (!state.supported || account.demo || !account.session) return null;
  return (
    <>
      <Divider />
      <Copy style={{ fontFamily: fonts.brand, fontSize: 22 }}>
        Notificaciones.
      </Copy>
      <Notice>
        Recibe avisos cuando cambien tus puntos o puedas pedir una recompensa de
        este negocio. Puedes desactivarlos cuando quieras.
      </Notice>
      {state.consented ? (
        <View style={{ gap: 10 }}>
          <Copy style={{ fontFamily: fonts.bold, marginBottom: 6 }}>
            {state.enabled
              ? "Activadas en este iPhone"
              : "Estado pendiente de confirmar"}
          </Copy>
          {state.enabled && (
            <Button
              label="Enviar notificación de prueba"
              secondary
              icon="notifications-outline"
              loading={state.busy}
              disabled={account.offline}
              onPress={() => void push.test()}
            />
          )}
          <Button
            label="Desactivar notificaciones"
            secondary
            disabled={state.busy}
            onPress={() => void push.disable()}
          />
        </View>
      ) : state.permission === "denied" ? (
        <>
          <Notice>
            Las notificaciones están bloqueadas en iOS. Actívalas en
            Configuración y luego vuelve aquí para elegir los avisos de este
            negocio.
          </Notice>
          <Button
            label="Abrir Configuración de iPhone"
            secondary
            onPress={() =>
              void openNotificationSettings().catch(() =>
                setSettingsError(true),
              )
            }
          />
        </>
      ) : (
        <Button
          label="Activar notificaciones"
          icon="notifications-outline"
          loading={state.busy}
          disabled={account.offline || state.available !== true}
          onPress={() => void push.enable()}
        />
      )}
      {account.offline && (
        <Notice>Conéctate para activar o probar los avisos.</Notice>
      )}
      {state.pendingRevoke && (
        <Notice>
          La desactivación está pendiente. Se completará al recuperar la
          conexión; mientras tanto, aún podría llegar un aviso.
        </Notice>
      )}
      {state.available === false && (
        <Notice>
          Los avisos no están disponibles por ahora. Puedes consultar tus puntos
          y recompensas en la app.
        </Notice>
      )}
      {state.message && <Notice>{state.message}</Notice>}
      {(state.error || settingsError) && (
        <>
          <Notice error>
            {state.error ||
              "Abre Configuración de tu iPhone y busca PuntosFieles para cambiar los permisos."}
          </Notice>
          {state.error && (
            <Button
              label="Reintentar conexión"
              secondary
              disabled={state.busy || account.offline}
              onPress={() => void push.reconcile()}
            />
          )}
        </>
      )}
    </>
  );
}
