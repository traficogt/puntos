import { createHash } from 'node:crypto';

const MAX_RESPONSE_BYTES = 64 * 1024;
const REJECTED_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

// Error objects deliberately contain no upstream response, URL, recipient or key.
export class MessageProviderError extends Error {
  constructor(code, deliveryUncertain = false) {
    super(code);
    this.name = 'MessageProviderError';
    this.deliveryUncertain = deliveryUncertain;
  }
}

export function internationalPhoneDigits(phone) {
  const value = typeof phone === 'string' ? phone.trim() : '';
  return /^\+?[1-9]\d{7,14}$/.test(value) ? value.replace(/^\+/, '') : '';
}

export function providerUrl(baseUrl, route) {
  try {
    const url = new URL(String(baseUrl || ''));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return new URL(route, url).toString();
  } catch { return ''; }
}

export function providerTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(100, Math.min(30_000, Math.floor(parsed))) : 10_000;
}

export function providerReceipt(provider, messageId) {
  if (typeof messageId !== 'string' || !messageId.trim()) {
    throw new MessageProviderError('MESSAGE_DELIVERY_UNCERTAIN', true);
  }
  // WAHA receipts can include the recipient's chat ID. Store an opaque reference.
  return `${provider}:${createHash('sha256').update(messageId).digest('hex')}`;
}

async function readJson(response) {
  if (!response.body) throw new MessageProviderError('MESSAGE_DELIVERY_UNCERTAIN', true);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MessageProviderError('MESSAGE_DELIVERY_UNCERTAIN', true);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    reader.releaseLock();
  }
}

export async function sendProviderJson({ url, headers, payload, timeoutMs, fetchImpl, form = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), providerTimeoutMs(timeoutMs));
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json', ...headers },
      body: form ? new URLSearchParams(payload).toString() : JSON.stringify(payload),
      signal: controller.signal,
      // Never replay a POST or forward authentication to a redirect target.
      redirect: 'manual'
    });
    if (!response.ok) {
      await response.body?.cancel();
      const rejected = REJECTED_STATUSES.has(response.status);
      throw new MessageProviderError(rejected ? 'MESSAGE_PROVIDER_REJECTED' : 'MESSAGE_DELIVERY_UNCERTAIN', !rejected);
    }
    return await readJson(response);
  } catch (error) {
    if (error instanceof MessageProviderError) throw error;
    // A timed-out or disconnected request may already have reached WhatsApp.
    throw new MessageProviderError('MESSAGE_DELIVERY_UNCERTAIN', true);
  } finally {
    clearTimeout(timer);
  }
}
