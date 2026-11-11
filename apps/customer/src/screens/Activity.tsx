import React from "react";
import { View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../context";
import { Copy, Notice } from "../components";
import { NativeScreen, SnapshotPending } from "../native-components";
import { fonts } from "../theme";

export function Activity() {
  const { state, colors } = useApp();
  const { fontScale } = useWindowDimensions();
  const transactions = [...(state.snapshot?.transactions || [])].sort(
    (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
  );
  if (!state.snapshot) return <NativeScreen refresh><SnapshotPending /></NativeScreen>;
  return (
    <NativeScreen refresh>
      <Copy
        style={{
          color: colors.muted,
          fontSize: 14,
          lineHeight: 21,
          marginBottom: 14,
        }}
      >
        Últimos movimientos
      </Copy>
      {!transactions.length ? (
        <View style={{ paddingVertical: 36, alignItems: "center" }}>
          <Ionicons name="receipt-outline" size={36} color={colors.muted} />
          <Copy
            accessibilityRole="header"
            style={{
              fontFamily: fonts.brand,
              fontSize: 22,
              lineHeight: 28,
              marginTop: 16,
              textAlign: "center",
            }}
          >
            Aún no tienes movimientos
          </Copy>
          <Copy
            style={{
              color: colors.muted,
              marginTop: 10,
              textAlign: "center",
              fontSize: 15,
              lineHeight: 23,
            }}
          >
            Tu primer movimiento aparecerá después de una compra o un canje.
          </Copy>
        </View>
      ) : (
        transactions.map((tx) => {
          const points = Number(tx.points_delta);
          const date = new Date(tx.created_at);
          return (
            <View
              key={tx.id}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 12,
                paddingVertical: 16,
                borderTopWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Ionicons
                name={points < 0 ? "gift-outline" : "add-circle-outline"}
                size={22}
                color={points < 0 ? colors.muted : colors.success}
                style={{ marginTop: 2 }}
              />
              <View
                style={{
                  flex: 1,
                  flexDirection: fontScale > 1.3 ? "column" : "row",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Copy
                    style={{
                      fontFamily: fonts.medium,
                      fontSize: 15,
                      lineHeight: 22,
                    }}
                  >
                    {tx.reward_name ||
                      (points < 0 ? "Puntos utilizados" : "Puntos recibidos")}
                  </Copy>
                  <Copy
                    style={{
                      color: colors.muted,
                      fontSize: 13,
                      lineHeight: 19,
                      marginTop: 4,
                    }}
                  >
                    {Number.isFinite(date.getTime())
                      ? date.toLocaleDateString("es-GT", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "Fecha no disponible"}
                  </Copy>
                </View>
                <Copy
                  accessibilityLabel={`${points > 0 ? "+" : ""}${points.toLocaleString("es-GT")} puntos`}
                  style={{
                    fontFamily: fonts.bold,
                    fontSize: 16,
                    lineHeight: 23,
                    fontVariant: ["tabular-nums"],
                    color: points < 0 ? colors.ink : colors.success,
                    flexShrink: 1,
                  }}
                >
                  {points > 0 ? "+" : ""}
                  {points.toLocaleString("es-GT")}
                </Copy>
              </View>
            </View>
          );
        })
      )}
      <Notice>Se muestran los últimos movimientos disponibles.</Notice>
      {state.error && <Notice error>{state.error}</Notice>}
    </NativeScreen>
  );
}
