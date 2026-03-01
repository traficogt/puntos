import type { Page } from "@playwright/test";

export function apiGet(page: Page, url: string, opts?: { headers?: Record<string, string> }): Promise<{
  status: number;
  ok: boolean;
  body: any;
}>;

export function apiPost(page: Page, url: string, data: any, opts?: { csrf?: boolean; headers?: Record<string, string> }): Promise<{
  status: number;
  ok: boolean;
  body: any;
}>;

export function apiPatch(page: Page, url: string, data: any, opts?: { csrf?: boolean; headers?: Record<string, string> }): Promise<{
  status: number;
  ok: boolean;
  body: any;
}>;

export function apiPut(page: Page, url: string, data: any, opts?: { csrf?: boolean; headers?: Record<string, string> }): Promise<{
  status: number;
  ok: boolean;
  body: any;
}>;

export function apiDelete(page: Page, url: string, opts?: { csrf?: boolean; headers?: Record<string, string> }): Promise<{
  status: number;
  ok: boolean;
  body: any;
}>;

export function expectOk(result: { ok: boolean; status: number; body: any }, hint?: string): void;
