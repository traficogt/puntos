import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "./context";
import { fonts } from "./theme";
export function Copy({ style, ...props }: TextProps) {
  const { colors } = useApp();
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: fonts.body,
          fontSize: 16,
          lineHeight: 25,
          color: colors.ink,
        },
        style,
      ]}
    />
  );
}
export function Heading({ children }: React.PropsWithChildren) {
  return (
    <Copy
      accessibilityRole="header"
      style={{
        fontFamily: fonts.display,
        fontSize: 34,
        lineHeight: 40,
        marginBottom: 12,
      }}
    >
      {children}
    </Copy>
  );
}
export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  secondary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondary?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingVertical: 13,
        paddingHorizontal: 20,
        borderRadius: 12,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 10,
        backgroundColor: secondary ? colors.surface : colors.primary,
        borderWidth: secondary ? 1 : 0,
        borderColor: colors.line,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? colors.ink : colors.onPrimary} />
      ) : icon ? (
        <Ionicons
          name={icon}
          size={21}
          color={secondary ? colors.ink : colors.onPrimary}
        />
      ) : null}
      <Copy
        style={{
          fontFamily: fonts.bold,
          color: secondary ? colors.ink : colors.onPrimary,
          textAlign: "center",
        }}
      >
        {label}
      </Copy>
    </Pressable>
  );
}
export function Screen({
  children,
  refresh = false,
  style,
}: {
  children: React.ReactNode;
  refresh?: boolean;
  style?: ViewStyle;
}) {
  const { colors, state, controller } = useApp();
  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          {
            padding: 24,
            paddingTop: 18,
            paddingBottom: 40,
            width: "100%",
            maxWidth: 720,
            alignSelf: "center",
            flexGrow: 1,
          },
          style,
        ]}
        refreshControl={
          refresh ? (
            <RefreshControl
              refreshing={state.loading}
              onRefresh={() => void controller.refresh()}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  const { colors } = useApp();
  return (
    <Copy
      accessibilityRole={error ? "alert" : undefined}
      style={{
        color: error ? colors.error : colors.muted,
        fontSize: 14,
        lineHeight: 21,
        marginVertical: 12,
      }}
    >
      {children}
    </Copy>
  );
}
export function Status() {
  const { state, colors, controller } = useApp();
  if (state.demo)
    return (
      <View
        style={{
          backgroundColor: colors.surface,
          paddingVertical: 10,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Copy
          style={{
            fontSize: 12,
            lineHeight: 18,
            color: colors.muted,
            textAlign: "center",
          }}
        >
          Vista de ejemplo · Puntos y movimientos ilustrativos
        </Copy>
      </View>
    );
  if (state.offline || (!state.fresh && state.snapshot))
    return (
      <View style={{ backgroundColor: colors.surface, padding: 12 }}>
        <Copy
          accessibilityRole="alert"
          style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}
        >
          {state.offline ? "Sin conexión. " : "Actualización pendiente. "}
          {state.syncedAt
            ? `Última actualización: ${new Date(state.syncedAt).toLocaleString("es-GT")}.`
            : "Conéctate para cargar tu tarjeta."}
        </Copy>
        {!state.offline && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void controller.refresh()}
            disabled={state.loading}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Copy style={{ color: colors.primary, fontFamily: fonts.bold }}>
              {state.loading ? "Actualizando…" : "Actualizar mi tarjeta"}
            </Copy>
          </Pressable>
        )}
      </View>
    );
  return null;
}
export function Divider() {
  const { colors } = useApp();
  return (
    <View
      style={{ height: 1, backgroundColor: colors.line, marginVertical: 22 }}
    />
  );
}
export const layout = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  grow: { flex: 1 },
  stack: { gap: 12 },
});
