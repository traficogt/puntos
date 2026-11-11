/** @odoo-module **/
import { Component, onMounted, useRef, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { useBarcodeReader } from "@point_of_sale/app/barcode/barcode_reader_hook";
import { uuidv4 } from "@point_of_sale/utils";
import { _t } from "@web/core/l10n/translation";
import { prepareAndAuthorize, prepareAndCancel, checkoutIntents } from "./checkout_flow";

export class PfCheckoutDialog extends Component {
    static template = "pf_pos_connector.CheckoutDialog";
    static components = { Dialog };
    static props = { close: Function, orderUuid: String };

    setup() {
        this.pos = usePos();
        this.state = useState({ token: "", customer: null, rewards: [], busy: false, error: "", notice: "", reason: "" });
        this.input = useRef("qrInput");
        onMounted(() => this.input.el?.focus());
        useBarcodeReader({ product: this.scanCard, client: this.scanCard }, true);
    }
    get order() { return this.pos.models["pos.order"].getBy("uuid", this.props.orderUuid); }
    get intent() { return checkoutIntents(this.order).find((item) => item.state !== "cancelled"); }
    async rpc(method, ...args) { return this.pos.data.call("pos.order", method, [[this.order.id], ...args]); }
    async sync() {
        await this.pos.syncAllOrders({ orders: [this.order], throw: true });
        if (typeof this.order.id !== "number") throw new Error(_t("Save this order online before redeeming."));
    }
    async reload() { await this.pos.loadServerOrders([["id", "=", this.order.id]]); }
    async perform(callback) {
        if (this.state.busy) return;
        this.state.busy = true;
        this.state.error = "";
        this.state.notice = "";
        try { await callback(); }
        catch (error) { this.state.error = error?.data?.message || error?.message || _t("Connection unavailable. Keep this order and retry the same PF operation."); }
        finally { this.state.busy = false; }
    }
    async lookup() {
        await this.perform(async () => {
            await this.sync();
            const result = await this.rpc("pf_checkout_options", this.state.token.trim());
            this.state.customer = result.customer;
            this.state.rewards = result.rewards;
        });
    }
    async scanCard(value) {
        if (this.state.busy || this.intent) return;
        this.state.token = value.code;
        await this.lookup();
    }
    async redeem(reward) {
        await this.perform(async () => {
            const selection = { requestId: uuidv4(), customerId: this.state.customer.id,
                customerQrToken: this.state.token.trim(), rewardId: reward.rewardId,
                mappingId: reward.mapping.id, mappingVersion: reward.mapping.version };
            const result = await prepareAndAuthorize({
                sync: () => this.sync(), prepare: (value) => this.rpc("pf_checkout_prepare", value),
                authorize: (id) => this.rpc("pf_checkout_authorize", id), reload: () => this.reload(),
            }, selection);
            this.showOutcome(result);
        });
    }
    showOutcome(result) {
        this.state.token = "";
        this.state.customer = null;
        this.state.rewards = [];
        this.state.notice = result.state === "authorized"
            ? _t("Reward added. Complete payment to confirm the receipt.")
            : result.state === "cancelled" ? _t("PF cancellation confirmed.")
            : _t("PF confirmation is pending. Retry this same request or cancel it explicitly.");
    }
    async retry() {
        await this.perform(async () => {
            const intent = this.intent;
            const result = await this.rpc(intent.state === "cancel_pending" ? "pf_checkout_cancel" : "pf_checkout_authorize", intent.requestId);
            await this.reload();
            this.showOutcome(result);
        });
    }
    async cancelReward() {
        await this.perform(async () => {
            const result = await prepareAndCancel({
                prepareCancel: (id, reason) => this.rpc("pf_checkout_prepare_cancel", id, reason),
                cancel: (id) => this.rpc("pf_checkout_cancel", id), reload: () => this.reload(),
            }, this.intent.requestId, this.state.reason.trim());
            this.showOutcome(result);
        });
    }
    availabilityLabel(reward) {
        const state = reward.availability.state;
        return state === "unavailable" ? _t("Unavailable") : state === "stale" ? _t("Stock update needed")
            : state === "unknown" ? _t("Stock not confirmed") : _t("Available");
    }
    canRedeem(reward) {
        return ["not_required", "available"].includes(reward.availability.state)
            && reward.pointsCost <= this.state.customer.points;
    }
}
