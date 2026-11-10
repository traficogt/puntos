import React from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../context";
import { Copy, Heading, Notice, Screen, layout } from "../components";
import { fonts } from "../theme";
export function Activity() {
  const { state, colors } = useApp();
  const transactions = state.snapshot?.transactions || [];
  return (
    <Screen refresh>
      <Heading>Cada visita cuenta.</Heading>
      <Copy style={{ color: colors.muted, marginBottom: 28 }}>
        Tus puntos ganados y recompensas disfrutadas, en un mismo lugar.
      </Copy>
      {!transactions.length ? (
        <View style={{ paddingVertical: 40 }}>
          <Ionicons name="receipt-outline" size={40} color={colors.muted} />
          <Copy
            style={{ fontFamily: fonts.brand, fontSize: 22, marginTop: 20 }}
          >
            Tu historia empieza aquí.
          </Copy>
          <Notice>
            Tu primer movimiento aparecerá después de una compra o un canje.
          </Notice>
        </View>
      ) : (
        transactions.map((tx) => {
          const points = Number(tx.points_delta);
          const date = new Date(tx.created_at);
          return (
            <View
              key={tx.id}
              style={[
                layout.row,
                {
                  paddingVertical: 22,
                  borderTopWidth: 1,
                  borderColor: colors.line,
                },
              ]}
            >
              <Ionicons
                name={points < 0 ? "gift-outline" : "add-circle-outline"}
                size={25}
                color={colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Copy style={{ fontFamily: fonts.medium }}>
                  {tx.reward_name ||
                    (points < 0 ? "Puntos utilizados" : "Puntos recibidos")}
                </Copy>
                <Copy
                  style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}
                >
                  {Number.isFinite(date.getTime())
                    ? date.toLocaleDateString("es-GT", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "Fecha no disponible"}
                </Copy>
              </View>
              <Copy
                style={{
                  fontFamily: fonts.bold,
                  fontVariant: ["tabular-nums"],
                  color: points < 0 ? colors.ink : colors.success,
                }}
              >
                {points > 0 ? "+" : ""}
                {points.toLocaleString("es-GT")}
              </Copy>
            </View>
          );
        })
      )}
      <Notice>Se muestran los últimos movimientos disponibles.</Notice>
      {state.error && <Notice error>{state.error}</Notice>}
    </Screen>
  );
}
