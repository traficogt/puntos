export type AlertMode = "presence" | "evaluate";
export type AlertScope = "api" | "worker" | "all";
export type MetricLabels = Record<string, string>;

export interface MetricSample {
  name: string;
  labels: MetricLabels;
  value: number;
}

export type MetricSamples = Map<string, MetricSample>;
export type MetricRequirement = readonly [name: string, labels?: MetricLabels];

export interface AlertCheck {
  name: string;
  value: number;
  ok(value: number): boolean;
}
