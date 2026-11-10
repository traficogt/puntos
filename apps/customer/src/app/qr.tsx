import React from "react";
import { Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Copy } from "../components";
import { useApp } from "../context";
import { fonts } from "../theme";
import { QrScreen } from "../screens/Card";

export default function QrRoute() {
  const router = useRouter();
  const { colors } = useApp();
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar QR"
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace("/(tabs)/card")
              }
              style={({ pressed }) => ({
                minWidth: 48,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 8,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Copy
                style={{
                  color: colors.primary,
                  fontFamily: fonts.medium,
                  fontSize: 16,
                }}
              >
                Cerrar
              </Copy>
            </Pressable>
          ),
        }}
      />
      <QrScreen />
    </>
  );
}
