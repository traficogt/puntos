import type {OwnerGoal, OwnerGoalKey, OwnerLaunchStep, OwnerMilestone, OwnerMilestoneKey, OwnerProgressMode, OwnerProgressResponse} from './types/api';
import {availableGoals, goalDefinition} from './owner-progress-model.ts';
import {hashForPage} from './navigation.js';

// Synthetic, browser-only preview of "Tu progreso" for a café a few weeks after launch: the five launch steps
// are done, three of five customers have a later visit recorded, the "Programa en marcha" milestone is still
// unseen and momentum is at three weeks. No request here reaches a PF API; changes last until reload.
const fail = (message: string, status: number) => Object.assign(new Error(message), {status});
type Body = Record<string, unknown>;
const RETURNING = {current: 3, target: 5};
const milestoneOrder: OwnerMilestoneKey[] = ['programa_en_marcha', 'first_customer', 'ya_estan_volviendo', 'primera_recompensa', 'primera_revision', 'clientes_50', 'clientes_100', 'clientes_300', 'primera_automatizacion', 'primera_campana_medida', 'primer_pase_wallet', 'pos_conectado', 'momentum_4', 'pionero'];
const labels: Record<OwnerMilestoneKey, string> = {programa_en_marcha: 'Programa en marcha', first_customer: 'Primer cliente participando', ya_estan_volviendo: 'Ya están volviendo', primera_recompensa: 'Primera recompensa entregada', primera_revision: 'Primera revisión del programa', clientes_50: '50 clientes', clientes_100: '100 clientes', clientes_300: '300 clientes', primera_automatizacion: 'Primera automatización activa', primera_campana_medida: 'Primera campaña medida', primer_pase_wallet: 'Primer pase en Wallet', pos_conectado: 'Punto de venta conectado', momentum_4: 'Cuatro semanas de impulso', pionero: 'Comercio pionero'};
const isGoalKey = (value: unknown): value is OwnerGoalKey => typeof value === 'string' && goalDefinition(value) !== null;
const isMilestoneKey = (value: unknown): value is OwnerMilestoneKey => typeof value === 'string' && (milestoneOrder as string[]).includes(value);

export function createOwnerProgressDemoApi({now = () => new Date('2026-11-10T18:00:00Z'), mode = 'full'}: {now?: () => Date; mode?: OwnerProgressMode} = {}) {
  const steps: OwnerLaunchStep[] = [
    {key: 'rules', label: 'Reglas y recompensa listas', done: true, done_at: '2026-10-14T16:20:00Z', href: hashForPage('launch')},
    {key: 'card', label: 'Tarjeta e inscripción listas', done: true, done_at: '2026-10-14T16:45:00Z', href: hashForPage('brand')},
    {key: 'practice', label: 'Práctica de acumular y canjear', done: true, done_at: '2026-10-15T14:10:00Z', href: hashForPage('launch')},
    {key: 'team', label: 'Equipo preparado', done: true, done_at: '2026-11-09T15:30:00Z', href: hashForPage('team')},
    {key: 'live', label: 'Participación real iniciada', done: true, done_at: '2026-10-17T13:05:00Z', href: hashForPage('customers')},
  ];
  const reachedAt: Partial<Record<OwnerMilestoneKey, string>> = {pionero: '2026-10-13T18:00:00Z', first_customer: '2026-10-17T13:05:00Z', programa_en_marcha: '2026-11-09T15:30:00Z'};
  const acknowledgedAt: Partial<Record<OwnerMilestoneKey, string>> = {pionero: '2026-10-14T16:00:00Z', first_customer: '2026-10-18T15:00:00Z'};
  const milestones: OwnerMilestone[] = milestoneOrder.map(key => ({key, label: labels[key], reached_at: reachedAt[key] ?? null, acknowledged_at: acknowledgedAt[key] ?? null}));
  let newMilestones: OwnerMilestoneKey[] = ['programa_en_marcha'];
  let hidden = false;
  let goalKey: OwnerGoalKey | null = 'returning_5';
  const dismissed = new Set<string>();
  const momentum = {weeks: 3, current_week_active: true, freezes_available: 1};
  const launch = () => ({steps, done_count: steps.filter(step => step.done).length, total: steps.length, complete: steps.every(step => step.done)});
  const goal = (key: OwnerGoalKey): OwnerGoal => {
    const definition = goalDefinition(key);
    return {key, label: definition?.label ?? key, progress: key === 'returning_5' ? {...RETURNING} : null, href: hashForPage(definition?.page ?? 'overview')};
  };
  const state = (): OwnerProgressResponse => ({mode, variant: 'treatment', hidden, launch: launch(), goal: goalKey ? goal(goalKey) : null, milestones, momentum: {...momentum}, new_milestones: [...newMilestones]});
  const offered = () => availableGoals({launch: launch(), milestones, goal: null});
  const nextGoal = () => offered().find(definition => !dismissed.has(definition.key))?.key ?? null;

  return (url: URL, options: RequestInit = {}): unknown => {
    const path = url.pathname, method = options.method || 'GET';
    if (path !== '/api/admin/owner-progress' && !path.startsWith('/api/admin/owner-progress/')) return undefined;
    if (mode === 'off') throw fail('Tu progreso no está disponible para este negocio.', 404);
    const body: Body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    if (path === '/api/admin/owner-progress' && method === 'GET') return state();
    if (method !== 'POST') throw fail('Esta acción no está disponible en la demostración.', 405);
    if (path === '/api/admin/owner-progress/acknowledge') {
      const keys = Array.isArray(body.keys) ? body.keys.filter(isMilestoneKey) : [];
      if (!Array.isArray(body.keys) || keys.length !== body.keys.length) throw fail('Indica los hitos que ya viste.', 400);
      const at = now().toISOString();
      for (const milestone of milestones) if (keys.includes(milestone.key) && milestone.reached_at && !milestone.acknowledged_at) milestone.acknowledged_at = at;
      newMilestones = newMilestones.filter(key => !keys.includes(key));
      return {ok: true};
    }
    if (path === '/api/admin/owner-progress/goal') {
      const dismiss = body.dismiss;
      if (isGoalKey(dismiss)) {
        dismissed.add(dismiss);
        if (goalKey === dismiss) goalKey = nextGoal();
        return {ok: true};
      }
      const key = body.key;
      if (!isGoalKey(key)) throw fail('Esa meta no existe.', 400);
      if (!offered().some(definition => definition.key === key)) throw fail('Esa meta no está disponible por ahora.', 400);
      dismissed.delete(key);
      goalKey = key;
      return {ok: true};
    }
    if (path === '/api/admin/owner-progress/review') {
      if (body.decision !== 'keep' && body.decision !== 'adjust') throw fail('Indica si mantienes o ajustas el programa.', 400);
      if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) throw fail('La nota admite hasta 500 caracteres.', 400);
      const review = milestones.find(milestone => milestone.key === 'primera_revision');
      if (review && !review.reached_at) {review.reached_at = now().toISOString(); newMilestones = [...newMilestones, 'primera_revision'];}
      return {ok: true};
    }
    if (path === '/api/admin/owner-progress/visibility') {
      if (typeof body.hidden !== 'boolean') throw fail('Indica si quieres ocultar o mostrar Tu progreso.', 400);
      hidden = body.hidden;
      return {ok: true};
    }
    throw fail('Esta acción no está disponible en la demostración.', 404);
  };
}
const ownerProgressDemo = createOwnerProgressDemoApi();
export function demoOwnerProgress(url: URL, options: RequestInit = {}) {return ownerProgressDemo(url, options);}
