declare module "prom-client" {
  export class Registry {
    registerMetric(metric: any): void;
    metrics(): Promise<string>;
  }
  export function collectDefaultMetrics(opts?: any): void;
  export class Histogram<T extends string = string> {
    constructor(opts: { name: string; help: string; buckets?: number[]; labelNames?: T[] });
    labels(...values: string[]): this;
    observe(value: number): void;
    observe(labels: Record<T, string>, value: number): void;
  }
  export class Counter<T extends string = string> {
    constructor(opts: { name: string; help: string; labelNames?: T[] });
    labels(...values: string[]): this;
    inc(value?: number): void;
    inc(labels: Record<T, string>, value?: number): void;
  }
}
