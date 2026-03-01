export interface SmokeHealthResponse {
  service?: string;
  database?: string;
}

export interface SmokeReadyResponse {
  ready?: boolean;
}

export interface SmokeLiveResponse {
  alive?: boolean;
}

export interface SmokeInfoResponse {
  version?: string;
}

export interface SmokeOpenApiResponse {
  openapi?: string;
}

export interface LoadTarget {
  label: string;
  url: URL;
  init?: RequestInit;
  validate(response: Response): boolean;
}

export interface LoadRecord {
  durations: number[];
  failures: number;
  total: number;
}
