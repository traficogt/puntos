import type {OwnerGoal, OwnerGoalKey, OwnerLaunch, OwnerLaunchStep, OwnerMilestone, OwnerMomentum, OwnerProgressResponse} from './types/api';
import {merchantRegion} from './region.js';

// Client-side rules for "Tu progreso" (docs/product/2026-11-23-owner-progress.md, v2). The server owns every
// count; this module only derives the list of alternative goals from the documented priority order and
// formats what the server sent. Wording stays factual: "N de M", never a composite score.
export type GoalState = Pick<OwnerProgressResponse, 'launch' | 'milestones'> & {goal?: OwnerGoal | null};
export interface OwnerGoalDefinition {
  key: OwnerGoalKey;
  label: string;
  /** Merchant page the goal points to. Used by the demo fixture; the real server sends its own href. */
  page: string;
  /** Noun after "N de M" when the server sends progress for this goal. */
  progressNoun?: string;
  available: (state: GoalState) => boolean;
}
export const milestoneReached = (milestones: OwnerMilestone[], key: string) => milestones.some(milestone => milestone.key === key && !!milestone.reached_at);
const reached = (state: GoalState, key: string) => milestoneReached(state.milestones, key);

/** Priority order from the design doc. The server suggests one at a time; the owner may switch to any other. */
export const ownerGoalCatalog: readonly OwnerGoalDefinition[] = [
  {key: 'launch', label: 'Terminar la puesta en marcha', page: 'launch', available: state => !state.launch.complete},
  {key: 'first_customer', label: 'Primer cliente participando', page: 'brand', available: state => !reached(state, 'first_customer')},
  {key: 'redemption_comfort', label: 'Equipo cómodo con el canje: primera recompensa entregada', page: 'fulfillment', available: state => reached(state, 'first_customer') && !reached(state, 'primera_recompensa')},
  {key: 'returning_5', label: 'Cinco clientes con una visita posterior registrada', page: 'customers', progressNoun: 'clientes con una visita posterior registrada', available: state => !reached(state, 'ya_estan_volviendo')},
  {key: 'reward_speed_review', label: 'Revisar si la primera recompensa tarda demasiado', page: 'rewards', available: state => reached(state, 'first_customer') && !reached(state, 'primera_recompensa')},
  {key: 'monthly_review', label: 'Revisar un mes de resultados', page: 'reports', available: state => state.launch.complete},
];
/** Goals the owner can switch to right now, in priority order, without the one already suggested. */
export function availableGoals(state: GoalState, exclude: string | null = state.goal?.key ?? null): OwnerGoalDefinition[] {
  return ownerGoalCatalog.filter(goal => goal.key !== exclude && goal.available(state));
}
export const goalDefinition = (key: string): OwnerGoalDefinition | null => ownerGoalCatalog.find(goal => goal.key === key) ?? null;

const count = (value: number) => new Intl.NumberFormat(merchantRegion().locale, {maximumFractionDigits: 0}).format(value);
const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : null;
};
function validProgress(goal: OwnerGoal) {
  const progress = goal.progress;
  return progress && Number.isFinite(progress.current) && Number.isFinite(progress.target) && progress.target > 0 ? progress : null;
}
export function goalProgressText(goal: OwnerGoal): string | null {
  const progress = validProgress(goal);
  if (!progress) return null;
  const noun = goalDefinition(goal.key)?.progressNoun;
  return `${count(progress.current)} de ${count(progress.target)}${noun ? ` ${noun}` : ''}`;
}
export function goalProgressPct(goal: OwnerGoal): number | null {
  const progress = validProgress(goal);
  return progress ? clamp((progress.current / progress.target) * 100) : null;
}
export const launchStepsText = (launch: OwnerLaunch) => `${count(launch.done_count)} de ${count(launch.total)} pasos`;
export const launchPct = (launch: OwnerLaunch) => (launch.total > 0 ? clamp((launch.done_count / launch.total) * 100) : 0);
export const nextLaunchStep = (launch: OwnerLaunch): OwnerLaunchStep | null => launch.steps.find(step => !step.done) ?? null;
export const reachedMilestones = (milestones: OwnerMilestone[]) => milestones.filter(milestone => time(milestone.reached_at) != null).sort((a, b) => (time(b.reached_at) ?? 0) - (time(a.reached_at) ?? 0));
export const pendingMilestones = (milestones: OwnerMilestone[]) => milestones.filter(milestone => time(milestone.reached_at) == null);
export const latestMilestone = (milestones: OwnerMilestone[]): OwnerMilestone | null => reachedMilestones(milestones)[0] ?? null;
export const newMilestoneLabels = (data: Pick<OwnerProgressResponse, 'milestones'>, keys: readonly string[]) => keys.map(key => data.milestones.find(milestone => milestone.key === key)?.label ?? key);
/** Secondary text. Weekly cadence only; a week with nothing to do counts; one freeze per eight weeks. */
export function momentumText(momentum: OwnerMomentum): string {
  const weeks = Math.max(0, Math.floor(Number(momentum.weeks) || 0)), freezes = Math.max(0, Math.floor(Number(momentum.freezes_available) || 0));
  const run = weeks === 0 ? 'Impulso: todavía sin semanas seguidas con actividad' : `Impulso: ${count(weeks)} ${weeks === 1 ? 'semana seguida' : 'semanas seguidas'} con actividad`;
  const week = momentum.current_week_active ? 'esta semana ya cuenta' : 'esta semana aún sin actividad';
  const pause = `${count(freezes)} ${freezes === 1 ? 'pausa disponible' : 'pausas disponibles'}`;
  return `${run} · ${week} · ${pause}`;
}
export function progressDate(value: string | null | undefined): string | null {
  const stamp = time(value);
  if (stamp == null) return null;
  return new Intl.DateTimeFormat(merchantRegion().locale, {dateStyle: 'medium', timeZone: merchantRegion().timezone}).format(new Date(stamp));
}
/** Checklist mode and holdout businesses see the launch path only. */
export const showsFullProgress = (data: Pick<OwnerProgressResponse, 'mode' | 'variant'>) => data.mode === 'full' && data.variant !== 'holdout';
