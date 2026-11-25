import React from "react";
import { View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApp } from "../context";
import { Copy, Notice } from "../components";
import { NativeScreen, SnapshotPending } from "../native-components";
import { fonts } from "../theme";
import {
  formatQ,
  movementDetail,
  movementLabel,
  programCopy,
  programKind,
  programWallet,
  walletHistory,
} from "../model";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("es-GT", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Fecha no disponible";
}

export function Activity() {
  const { state, colors } = useApp();
  const { fontScale } = useWindowDimensions();
  const data = state.snapshot;
  if (!data) return <NativeScreen refresh><SnapshotPending /></NativeScreen>;
  const copy = programCopy(programKind(data));
  // Stored-value programs show the Q ledger; the rest show points movements.
  const wallet = programWallet(data);
  const movements = wallet ? walletHistory(data) : [];
  const transactions = wallet
    ? []
    : [...(data.transactions || [])].sort(
        (a, b) =>
          (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
      );
  const stacked = fontScale > 1.3;
  const rowStyle = {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderColor: colors.line,
  };
  const empty = (
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
        {copy.activityEmpty}
      </Copy>
    </View>
  );
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
      {wallet
        ? !movements.length
          ? empty
          : movements.map((row) => {
              const negative = row.amount_q < 0;
              const detail = movementDetail(row);
              return (
                <View key={row.id} style={rowStyle}>
                  <Ionicons
                    name={
                      row.tx_type === "TRANSFER_OUT" || row.tx_type === "TRANSFER_IN"
                        ? "gift-outline"
                        : negative
                          ? "remove-circle-outline"
                          : "add-circle-outline"
                    }
                    size={22}
                    color={negative ? colors.muted : colors.success}
                    style={{ marginTop: 2 }}
                  />
                  <View
                    style={{
                      flex: 1,
                      flexDirection: stacked ? "column" : "row",
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
                        {movementLabel(row.tx_type)}
                      </Copy>
                      {detail && (
                        <Copy
                          style={{
                            color: colors.muted,
                            fontSize: 13,
                            lineHeight: 19,
                            marginTop: 2,
                          }}
                        >
                          {detail}
                        </Copy>
                      )}
                      <Copy
                        style={{
                          color: colors.muted,
                          fontSize: 13,
                          lineHeight: 19,
                          marginTop: 4,
                        }}
                      >
                        {formatDate(row.created_at)} · Saldo{" "}
                        {formatQ(row.balance_after_q)}
                      </Copy>
                    </View>
                    <Copy
                      accessibilityLabel={`${negative ? "menos" : "más"} ${formatQ(Math.abs(row.amount_q))}`}
                      style={{
                        fontFamily: fonts.bold,
                        fontSize: 16,
                        lineHeight: 23,
                        fontVariant: ["tabular-nums"],
                        color: negative ? colors.ink : colors.success,
                        flexShrink: 1,
                      }}
                    >
                      {negative ? "" : "+"}
                      {formatQ(row.amount_q)}
                    </Copy>
                  </View>
                </View>
              );
            })
        : !transactions.length
          ? empty
          : transactions.map((tx) => {
              const points = Number(tx.points_delta);
              return (
                <View key={tx.id} style={rowStyle}>
                  <Ionicons
                    name={points < 0 ? "gift-outline" : "add-circle-outline"}
                    size={22}
                    color={points < 0 ? colors.muted : colors.success}
                    style={{ marginTop: 2 }}
                  />
                  <View
                    style={{
                      flex: 1,
                      flexDirection: stacked ? "column" : "row",
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
                        {tx.reward_name || copy.transactionLabel(points < 0)}
                      </Copy>
                      <Copy
                        style={{
                          color: colors.muted,
                          fontSize: 13,
                          lineHeight: 19,
                          marginTop: 4,
                        }}
                      >
                        {formatDate(tx.created_at)}
                      </Copy>
                    </View>
                    <Copy
                      accessibilityLabel={`${points > 0 ? "+" : ""}${points.toLocaleString("es-GT")} ${copy.unit}`}
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
            })}
      <Notice>Se muestran los últimos movimientos disponibles.</Notice>
      {state.error && <Notice error>{state.error}</Notice>}
    </NativeScreen>
  );
}
