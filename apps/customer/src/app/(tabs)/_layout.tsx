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
import { Copy, Status } from "../../components";
export default function CustomerTabs() {
  const { colors } = useApp();
  const { width, fontScale } = useWindowDimensions();
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
          headerTitleStyle: { fontFamily: fonts.brand, fontSize: 22 },
          headerTitleAlign: "left",
          headerTintColor: colors.ink,
          tabBarActiveTintColor:
            width >= 768 ? colors.onPrimary : colors.primary,
          tabBarActiveBackgroundColor:
            width >= 768 ? colors.primary : undefined,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.line,
            ...(width >= 768
              ? { width: 210 }
              : {
                  height: 58 + Math.max(0, fontScale - 1) * 56 + insets.bottom,
                  paddingTop: 5,
                  paddingBottom: Math.max(5, insets.bottom),
                }),
          },
          tabBarPosition: width >= 768 ? "left" : "bottom",
          tabBarLabelPosition: width >= 768 ? "beside-icon" : "below-icon",
          tabBarLabel: ({ children, color }) => (
            <Copy
              style={{
                fontFamily: fonts.medium,
                color,
                fontSize: width >= 768 ? 14 : 11,
                lineHeight: width >= 768 ? 21 : 15,
                textAlign: width >= 768 ? "left" : "center",
                flexShrink: 1,
                maxWidth: "100%",
                marginLeft: width >= 768 ? 10 : 0,
              }}
            >
              {route.name === "rewards" ? "Premios" : children}
            </Copy>
          ),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={
                (
                  {
                    card: focused ? "wallet" : "wallet-outline",
                    rewards: focused ? "gift" : "gift-outline",
                    activity: focused ? "time" : "time-outline",
                    account: focused
                      ? "person-circle"
                      : "person-circle-outline",
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
        <Tabs.Screen name="rewards" options={{ title: "Recompensas", tabBarAccessibilityLabel: "Premios" }} />
        <Tabs.Screen name="activity" options={{ title: "Actividad" }} />
        <Tabs.Screen name="account" options={{ title: "Cuenta" }} />
      </Tabs>
    </SafeAreaView>
  );
}
