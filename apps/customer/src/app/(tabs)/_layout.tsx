import React from "react";
import { useWindowDimensions } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../../context";
import { fonts } from "../../theme";
import { Status } from "../../components";
export default function CustomerTabs() {
  const { colors } = useApp();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Status />
      <Tabs
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStatusBarHeight: 0,
          headerTitleStyle: { fontFamily: fonts.brand, fontSize: 19 },
          headerTintColor: colors.ink,
          tabBarActiveTintColor: width >= 768 ? colors.onPrimary : colors.primary,
          tabBarActiveBackgroundColor: width >= 768 ? colors.primary : undefined,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.line,
            ...(width >= 768
              ? { width: 210 }
              : {
                  height: 72 + insets.bottom,
                  paddingTop: 8,
                  paddingBottom: Math.max(10, insets.bottom),
                }),
          },
          tabBarPosition: width >= 768 ? "left" : "bottom",
          tabBarLabelStyle: {
            fontFamily: fonts.medium,
            fontSize: 12,
            lineHeight: 16,
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name={
                (
                  {
                    card: "wallet-outline",
                    rewards: "gift-outline",
                    activity: "time-outline",
                    account: "person-circle-outline",
                  } as const
                )[route.name as "card"]
              }
              size={size}
              color={color}
            />
          ),
        })}
      >
        <Tabs.Screen name="card" options={{ title: "Mi tarjeta" }} />
        <Tabs.Screen name="rewards" options={{ title: "Recompensas" }} />
        <Tabs.Screen name="activity" options={{ title: "Actividad" }} />
        <Tabs.Screen name="account" options={{ title: "Cuenta" }} />
      </Tabs>
    </SafeAreaView>
  );
}
