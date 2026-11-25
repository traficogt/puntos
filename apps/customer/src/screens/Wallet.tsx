import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import { useApp } from "../context";
import { Copy, Notice } from "../components";
import {
  NativeButton,
  NativeScreen,
  SectionTitle,
  SnapshotPending,
} from "../native-components";
import { fonts } from "../theme";
import {
  buildGiftTransfer,
  formatQ,
  movementDetail,
  movementLabel,
  programCopy,
  programKind,
  programWallet,
  transferErrorMessage,
  transferSuccessMessage,
  walletHistory,
  type GiftCardTransferResult,
  type GiftTransferRequest,
} from "../model";

// One confirmed gift. The idempotency key lives with the attempt: retrying the
// same attempt after a failure resends the same requestId, so the server replays
// the first result instead of moving the balance twice. Editing the form drops it.
type Attempt = { request: GiftTransferRequest; phone: string };

export function Wallet() {
  const { state, colors, controller } = useApp();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const data = state.snapshot;
  if (!data)
    return (
      <NativeScreen refresh>
        <SnapshotPending />
      </NativeScreen>
    );
  const wallet = programWallet(data);
  const kind = programKind(data);
  const copy = programCopy(kind);
  const history = wallet ? walletHistory(data) : [];
  const mode = state.demo
    ? "demo"
    : state.offline || !state.fresh
      ? "cached"
      : "live";
  const rate = copy.rateLine(wallet);
  const giftCard = wallet?.kind === "GIFT_CARD";
  const inputStyle = {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
    backgroundColor: colors.surface,
  };

  function edit(next: { phone?: string; amount?: string }) {
    setAttempt(null);
    setError("");
    setSuccess("");
    if (next.phone !== undefined) setPhone(next.phone);
    if (next.amount !== undefined) setAmount(next.amount);
  }
  function prepare() {
    setError("");
    setSuccess("");
    try {
      const request = buildGiftTransfer({
        recipientPhone: phone,
        amount,
        requestId: Crypto.randomUUID(),
        available: wallet?.balance_q,
      });
      setAttempt({ request, phone: request.body.recipient_phone });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function confirm() {
    if (!attempt || !state.session || state.offline) return;
    const token = state.session.token;
    setBusy(true);
    setError("");
    try {
      const result = await controller.authenticated<GiftCardTransferResult>(
        attempt.request.path,
        { method: attempt.request.method, body: attempt.request.body },
      );
      if (controller.getState().session?.token !== token) return;
      setSuccess(transferSuccessMessage(result, attempt.phone));
      setAttempt(null);
      setPhone("");
      setAmount("");
      void controller.refresh();
    } catch (e) {
      setError(transferErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <NativeScreen refresh>
        {!wallet ? (
          <Notice>Este programa no maneja un saldo en quetzales.</Notice>
        ) : (
          <>
            <View
              accessible
              accessibilityRole="summary"
              accessibilityLabel={`${formatQ(wallet.balance_q)} ${copy.balanceLabel(mode)}`}
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 20,
              }}
            >
              <Copy
                style={{
                  fontFamily: fonts.bold,
                  fontSize: 40,
                  lineHeight: 48,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatQ(wallet.balance_q)}
              </Copy>
              <Copy style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>
                {copy.balanceLabel(mode)}
              </Copy>
              {rate && (
                <Copy style={{ fontSize: 14, lineHeight: 21, marginTop: 10 }}>
                  {rate}
                </Copy>
              )}
            </View>
            {giftCard && (
              <>
                <SectionTitle>Regalar saldo a otro miembro</SectionTitle>
                {state.demo ? (
                  <Notice>Ingresa a tu cuenta para regalar saldo real.</Notice>
                ) : wallet.balance_q <= 0 ? (
                  <Notice>
                    Cuando tengas saldo podrás regalar una parte a otro miembro
                    de este negocio.
                  </Notice>
                ) : attempt ? (
                  <View style={{ gap: 10 }}>
                    <Copy
                      accessibilityRole="header"
                      style={{ fontFamily: fonts.bold }}
                    >
                      Vas a regalar {formatQ(attempt.request.body.amount_q)} a{" "}
                      {attempt.phone}.
                    </Copy>
                    <Copy
                      style={{
                        color: colors.muted,
                        fontSize: 14,
                        lineHeight: 21,
                        marginBottom: 6,
                      }}
                    >
                      El saldo se descuenta de tu tarjeta y pasa a la tarjeta de
                      quien recibe. No se puede deshacer desde la app.
                    </Copy>
                    <NativeButton
                      label={error ? "Reintentar el regalo" : "Confirmar regalo"}
                      icon="gift-outline"
                      loading={busy}
                      disabled={state.offline}
                      onPress={() => void confirm()}
                    />
                    <NativeButton
                      label="Cambiar datos"
                      secondary
                      disabled={busy}
                      onPress={() => setAttempt(null)}
                    />
                  </View>
                ) : (
                  <>
                    <Copy style={{ marginBottom: 8 }}>Teléfono de quien recibe</Copy>
                    <TextInput
                      editable={!busy}
                      accessibilityLabel="Teléfono de quien recibe el saldo"
                      value={phone}
                      onChangeText={(value) => edit({ phone: value })}
                      keyboardType="phone-pad"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Ej. 5555 1234"
                      placeholderTextColor={colors.muted}
                      style={inputStyle}
                      maxLength={25}
                    />
                    <Copy style={{ marginBottom: 8, marginTop: 14 }}>
                      Monto a regalar
                    </Copy>
                    <TextInput
                      editable={!busy}
                      accessibilityLabel="Monto a regalar en quetzales"
                      value={amount}
                      onChangeText={(value) => edit({ amount: value })}
                      keyboardType="decimal-pad"
                      placeholder="Q 0.00"
                      placeholderTextColor={colors.muted}
                      style={inputStyle}
                      maxLength={12}
                      onSubmitEditing={prepare}
                    />
                    <Notice>
                      Disponible para regalar: {formatQ(wallet.balance_q)}. Quien
                      recibe debe ser cliente de este negocio.
                    </Notice>
                    <NativeButton
                      label="Continuar"
                      icon="gift-outline"
                      disabled={state.offline || !phone.trim() || !amount.trim()}
                      onPress={prepare}
                    />
                  </>
                )}
                {state.offline && !state.demo && (
                  <Notice>Conéctate para regalar saldo.</Notice>
                )}
                {!!success && (
                  <Copy
                    accessibilityRole="alert"
                    style={{
                      color: colors.success,
                      fontSize: 14,
                      lineHeight: 21,
                      marginVertical: 12,
                    }}
                  >
                    {success}
                  </Copy>
                )}
                {!!error && <Notice error>{error}</Notice>}
              </>
            )}
            <SectionTitle>Movimientos</SectionTitle>
            {!history.length ? (
              <Copy style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>
                {copy.activityEmpty}
              </Copy>
            ) : (
              history.map((row) => {
                const negative = row.amount_q < 0;
                const date = new Date(row.created_at);
                const detail = movementDetail(row);
                return (
                  <View
                    key={row.id}
                    accessible
                    accessibilityLabel={`${movementLabel(row.tx_type)}. ${negative ? "" : "más "}${formatQ(row.amount_q)}. Saldo ${formatQ(row.balance_after_q)}`}
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
                        {Number.isFinite(date.getTime())
                          ? date.toLocaleDateString("es-GT", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "Fecha no disponible"}
                        {" · Saldo "}
                        {formatQ(row.balance_after_q)}
                      </Copy>
                    </View>
                    <Copy
                      style={{
                        fontFamily: fonts.bold,
                        fontSize: 16,
                        lineHeight: 23,
                        fontVariant: ["tabular-nums"],
                        color: negative ? colors.ink : colors.success,
                      }}
                    >
                      {negative ? "" : "+"}
                      {formatQ(row.amount_q)}
                    </Copy>
                  </View>
                );
              })
            )}
            {history.length > 0 && (
              <Notice>Se muestran los últimos movimientos disponibles.</Notice>
            )}
          </>
        )}
        {state.error && <Notice error>{state.error}</Notice>}
      </NativeScreen>
    </KeyboardAvoidingView>
  );
}
