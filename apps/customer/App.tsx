import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  AppState,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  ThemeProvider,
  DefaultTheme,
  DarkTheme,
} from "expo-router/react-navigation";
import { Stack, router } from "expo-router";

import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiClient } from "./src/api";
import { SessionController } from "./src/session";
import { secureStorage, snapshotStorage } from "./src/storage";
import { AppContext, type Appearance } from "./src/context";
import { palette, fonts } from "./src/theme";
import { PushController, notificationRoute } from "./src/push";
import { pushNative, listenForPush } from "./src/push-platform";

const api = new ApiClient(
  process.env.EXPO_PUBLIC_API_ORIGIN || "https://app.puntosfieles.com",
);
const controller = new SessionController(api, secureStorage, snapshotStorage);
const push = new PushController({
  native: pushNative,
  storage: secureStorage,
  request: (path, options) => {
    if (path === "/customer/push-device/revoke")
      return api.request(path, options);
    if (options?.token !== controller.getState().session?.token)
      throw new Error("Account changed");
    return controller.authenticated(path, options, {
      invalidateSnapshotOnFailure: false,
    });
  },
});

export default function App() {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const system = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [restored, setRestored] = useState(false);
  const [loaded, fontError] = useFonts({
    Inter_400Regular: require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
    Inter_500Medium: require("@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
    Fraunces_400Regular: require("@expo-google-fonts/fraunces/400Regular/Fraunces_400Regular.ttf"),
    BricolageGrotesque_600SemiBold: require("@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf"),
  });
  const colors = palette(
    appearance === "dark" || (appearance === "system" && system === "dark"),
    state.snapshot?.business.customer_branding?.primary_color,
  );
  useEffect(() => {
    let ready = false;
    let previous = "";
    const syncPush = () => {
      if (!ready) return;
      const current = controller.getState();
      const fingerprint = JSON.stringify([
        current.session?.token,
        current.offline,
        current.demo,
      ]);
      if (fingerprint === previous) return;
      previous = fingerprint;
      void push.sync(current.demo ? null : current.session, current.offline);
    };
    const unsubscribePush = controller.subscribe(syncPush);
    void controller.restore().finally(() => {
      ready = true;
      syncPush();
      setRestored(true);
    });
    void AsyncStorage.getItem("pf.appearance")
      .then((value) => {
        if (["system", "light", "dark"].includes(value || ""))
          setAppearanceState(value as Appearance);
      })
      .catch(() => {});
    const net = NetInfo.addEventListener((info) => {
      const offline =
        info.isConnected === false || info.isInternetReachable === false;
      controller.setOffline(offline);
      if (!offline) void controller.refresh();
    });
    const active = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void controller.refresh();
        if (ready) void push.reconcile();
      }
    });
    return () => {
      unsubscribePush();
      net();
      active.remove();
    };
  }, []);
  useEffect(() => {
    if (!restored || !loaded) return;
    const routeFor = (data: unknown) => {
      const current = controller.getState();
      return current.demo ? null : notificationRoute(data, current.session);
    };
    return listenForPush({
      matches: (data) => !!routeFor(data) && push.getState().enabled,
      token: (token) => {
        void push.tokenChanged(token);
      },
      received: (data) => {
        if (routeFor(data)) void controller.refresh();
      },
      opened: (data) => {
        const route = routeFor(data);
        if (route) {
          router.navigate(route);
          void controller.refresh();
        }
      },
    });
  }, [restored, loaded]);
  const setAppearance = (value: Appearance) => {
    setAppearanceState(value);
    void AsyncStorage.setItem("pf.appearance", value).catch(() => {});
  };
  const theme = {
    ...(colors.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(colors.dark ? DarkTheme : DefaultTheme).colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.ink,
      border: colors.line,
    },
  };
  if (fontError)
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 30,
            backgroundColor: colors.background,
          }}
        >
          <Text style={{ color: colors.ink, fontSize: 18 }}>
            No pudimos cargar la app. Ciérrala y vuelve a intentarlo.
          </Text>
        </View>
      </SafeAreaProvider>
    );
  if (!loaded || !restored)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator
          accessibilityLabel="Cargando PuntosFieles"
          color={colors.primary}
        />
      </View>
    );
  return (
    <SafeAreaProvider>
      <AppContext.Provider
        value={{
          api,
          controller,
          push,
          state,
          colors,
          appearance,
          setAppearance,
        }}
      >
        <StatusBar style={colors.dark ? "light" : "dark"} />
        <ThemeProvider value={theme}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.ink,
              headerTitleStyle: { fontFamily: fonts.brand },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Protected guard={!!state.session || state.demo}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="qr"
                options={{ title: "Mi QR", presentation: "modal" }}
              />
            </Stack.Protected>
            <Stack.Protected guard={!state.session && !state.demo}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Screen
              name="negocio/[slug]"
              options={{ title: "Cambiar de negocio" }}
            />
          </Stack>
        </ThemeProvider>
      </AppContext.Provider>
    </SafeAreaProvider>
  );
}
