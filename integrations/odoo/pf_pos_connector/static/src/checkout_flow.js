/** @odoo-module **/

// Each awaited RPC is a separate server transaction. Do not combine prepare
// with authorize/cancel: the durable local identity must precede remote I/O.
export async function prepareAndAuthorize(actions, selection) {
    await actions.sync();
    const intent = await actions.prepare(selection);
    try {
        return await actions.authorize(intent.requestId);
    } finally {
        await actions.reload();
    }
}

export async function prepareAndCancel(actions, requestId, reason) {
    await actions.prepareCancel(requestId, reason);
    try {
        return await actions.cancel(requestId);
    } finally {
        await actions.reload();
    }
}

export function isConfirmedCheckout(value) {
    return ["paid", "done", "invoiced"].includes(value?.orderState)
        && Array.isArray(value.intents)
        && value.intents.every((intent) => ["recorded", "cancelled"].includes(intent.state));
}

// Odoo represents an empty fields.Json value as false on RPC reads.
export function checkoutIntents(order) {
    return Array.isArray(order?.pf_checkout_summary) ? order.pf_checkout_summary : [];
}
