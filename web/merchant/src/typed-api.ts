import { api, useResource } from './api.js';
import { createMerchantApi } from './api-contracts';
import type { MerchantReadResponses, ResourceState } from './types/api';

/**
 * Transport boundary for endpoints whose caller supplies a reviewed response
 * contract. Types describe the server protocol; they do not validate JSON.
 * There is no default response type: an omitted contract yields unknown.
 */
export const request: <Response>(path: string, options?: RequestInit) => Promise<Response> = api;
export const merchantApi = createMerchantApi(api);

// Retain the existing cancellation, refresh and session behavior of the hook.
export const useMerchantResource: <Path extends keyof MerchantReadResponses>(
  path: Path | null,
  refresh?: string | number,
) => ResourceState<MerchantReadResponses[Path]> = useResource;
