/** @odoo-module **/
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { ControlButtons } from "@point_of_sale/app/screens/product_screen/control_buttons/control_buttons";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";
import { PosOrder } from "@point_of_sale/app/models/pos_order";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { PfCheckoutDialog } from "./checkout_dialog";
import { isConfirmedCheckout, checkoutIntents } from "./checkout_flow";

function isRewardLine(line) {
    return checkoutIntents(line.order_id).some((intent) => intent.lineUuid === line.uuid && intent.state !== "cancelled");
}
function openCheckout(component) {
    component.dialog.add(PfCheckoutDialog, { orderUuid: component.pos.get_order().uuid });
}
patch(ControlButtons.prototype, { openPfCheckout() { openCheckout(this); } });
patch(PaymentScreen.prototype, {
    openPfCheckout() { openCheckout(this); },
    async afterOrderValidation(...args) {
        if (checkoutIntents(this.currentOrder).some((intent) => intent.state !== "cancelled")) {
            let confirmed = false;
            try {
                const result = await this.pos.data.call("pos.order", "pf_checkout_status", [[this.currentOrder.id]]);
                confirmed = isConfirmedCheckout(result);
            } catch { /* A lost response is an unknown outcome, never an automatic refund. */ }
            if (!confirmed) {
                this.dialog.add(AlertDialog, { title: _t("Receipt confirmation pending"),
                    body: _t("Keep this order. Reconnect and use Confirm PF receipt to verify the completed sale before delivering the reward. Points are not automatically refunded.") });
                return;
            }
        }
        return super.afterOrderValidation(...args);
    },
    async confirmPfReceipt() { return this.afterOrderValidation(); },
});
patch(PosOrderline.prototype, {
    can_be_merged_with(line) {
        return !isRewardLine(this) && !isRewardLine(line) && super.can_be_merged_with(...arguments);
    },
});
patch(PosOrder.prototype, {
    removeOrderline(line) {
        if (isRewardLine(line)) return false;
        return super.removeOrderline(...arguments);
    },
});
patch(PosStore.prototype, {
    async _onBeforeDeleteOrder(order) {
        if (checkoutIntents(order).some((intent) => intent.state !== "cancelled")) {
            this.dialog.add(PfCheckoutDialog, { orderUuid: order.uuid });
            return false;
        }
        return super._onBeforeDeleteOrder(...arguments);
    },
});
