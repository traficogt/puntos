import type { MerchantPutPayloads, MerchantReadResponses } from './types/api';

export type MerchantTransport = (path: string, options?: RequestInit) => Promise<unknown>;
type ReadOptions = Omit<RequestInit, 'method' | 'body'>;
type WriteOptions = Omit<RequestInit, 'method' | 'body'>;

/** Typed routes share the existing session/CSRF transport and JSON protocol. */
export function createMerchantApi(transport: MerchantTransport) {
  return {
    async get<Path extends keyof MerchantReadResponses>(path: Path, options?: ReadOptions): Promise<MerchantReadResponses[Path]> {
      // JSON enters as unknown. This assertion documents the reviewed server
      // contract; the server remains responsible for runtime validation.
      return await transport(path, options) as MerchantReadResponses[Path];
    },
    async put<Path extends keyof MerchantPutPayloads>(path: Path, payload: MerchantPutPayloads[Path], options?: WriteOptions): Promise<MerchantReadResponses[Path]> {
      return await transport(path, { ...options, method: 'PUT', body: JSON.stringify(payload) }) as MerchantReadResponses[Path];
    },
  };
}
