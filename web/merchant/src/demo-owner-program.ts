import type {CustomerBranding} from './OwnerBranding';
import type {Tier} from './OwnerTiers';
import type {Achievement, Challenge} from './OwnerGamification';
import type {GiftCard, GiftCardTransaction} from './OwnerGiftCards';
import type {ProgramConfig, SuspiciousAward} from './OwnerProgramLimits';

// Synthetic, browser-only preview for the owner configuration screens (identity, tiers, achievements,
// challenges, gift cards, limits). No request here reaches a PF API; edits last until reload.
const uuid = (value: number) => `66666666-6666-4666-8666-${String(value).padStart(12, '0')}`;
const branchId = '22222222-2222-4222-8222-222222222222';
type Body = Record<string, unknown>;
const fail = (message: string, status: number) => Object.assign(new Error(message), {status});
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const whole = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback);

export function createOwnerProgramDemoApi(now = () => new Date('2026-11-10T18:00:00Z')) {
  let sequence = 300;
  let branding: CustomerBranding = {branding_mode: 'endorsed_brand', customer_program_name: 'Club Jacaranda', neutral_theme: 'warm', powered_by_visible: true, primary_color: '#6D3524', accent_color: '#D7A554', wallet_headline: 'Tu café de siempre, con premios', join_headline: 'Únete al Club Jacaranda'};
  const tiers: Tier[] = [
    // Mirrors GET /api/admin/tiers: the full rule next to the membership statistics.
    {id: uuid(1), name: 'Bronce', tier_level: 1, min_points: 0, min_spend: null, min_visits: null, points_multiplier: 1, perks: ['Acceso al programa'], color: '#CD7F32', icon_url: '🥉', active: true, customer_count: 142, avg_points: 310.5, total_points: 44091},
    {id: uuid(2), name: 'Plata', tier_level: 2, min_points: 1500, min_spend: null, min_visits: null, points_multiplier: 1.25, perks: ['Puntos ×1.25', 'Un postre al mes'], color: '#C0C0C0', icon_url: '🥈', active: true, customer_count: 31, avg_points: 2140, total_points: 66340},
    {id: uuid(3), name: 'Oro', tier_level: 3, min_points: 5000, min_spend: null, min_visits: null, points_multiplier: 1.5, perks: ['Puntos ×1.5', 'Invitación a catas'], color: '#D4AF37', icon_url: '🥇', active: true, customer_count: 0, avg_points: null, total_points: null},
  ];
  const achievements: Achievement[] = [
    {id: uuid(11), name: 'Primera visita', description: 'Registra tu primera compra.', icon_url: '☕', requirement_type: 'visits', requirement_value: 1, points_reward: 20, active: true},
    {id: uuid(12), name: 'Cliente frecuente', description: 'Veinte visitas registradas.', icon_url: '🏆', requirement_type: 'visits', requirement_value: 20, points_reward: 150, active: false},
  ];
  const challenges: Challenge[] = [
    {id: uuid(21), name: 'Fin de semana activo', description: 'Visítanos tres veces este mes.', challenge_type: 'limited_time', requirement_type: 'visits', requirement_value: 3, reward_points: 100, start_date: '2026-11-01T06:00:00.000Z', end_date: '2026-11-30T06:00:00.000Z', recurrence: null, active: true},
  ];
  const cards: GiftCard[] = [
    {id: uuid(31), code: 'GC-DEMO-0001', qr_token: 'demo-token-0001', balance_q: 35, initial_amount_q: 50, status: 'ACTIVE', created_at: '2026-11-03T15:20:00Z', issued_to_name: 'Ana López', issued_to_phone: null},
    {id: uuid(32), code: 'GC-DEMO-0002', qr_token: 'demo-token-0002', balance_q: 100, initial_amount_q: 100, status: 'ACTIVE', created_at: '2026-11-08T17:05:00Z', issued_to_name: null, issued_to_phone: '55554444'},
  ];
  const transactions: Record<string, GiftCardTransaction[]> = {
    [uuid(31)]: [{id: uuid(41), tx_type: 'REDEEM', amount_q: 15, balance_after_q: 35, created_at: '2026-11-06T13:10:00Z'}, {id: uuid(40), tx_type: 'ISSUE', amount_q: 50, balance_after_q: 50, created_at: '2026-11-03T15:20:00Z'}],
    [uuid(32)]: [{id: uuid(42), tx_type: 'ISSUE', amount_q: 100, balance_after_q: 100, created_at: '2026-11-08T17:05:00Z'}],
  };
  const suspicious: SuspiciousAward[] = [
    {id: uuid(51), created_at: '2026-11-09T20:40:00Z', branch_id: branchId, branch_name: 'Zona 4 · demo', customer_name: 'Carlos Méndez', customer_phone: '55551234', staff_name: 'Lucía Pérez', amount_q: 1850, points: 185, guard: {reasons: ['suspicious_amount']}},
  ];
  let program: {program_type: string; program_json: ProgramConfig} = {program_type: 'SPEND', program_json: {points_per_q: 0.1, round: 'ceil', pending_points_hold_days: 0, points_expiration_days: 365, award_guard: {max_amount_q: 2000, max_points_per_tx: 500, max_visits: 1, max_items: 20, suspicious_points_threshold: 150, suspicious_amount_q_threshold: 1500}, redemption_guard: {max_redemptions_per_day: 3, max_reward_redemptions_per_day: 1, reward_cooldown_hours: 2}, balance_policy: {allow_negative_balance_on_refund: false}, tier_policy: {mode: 'lifetime', rolling_days: 365, grace_days: 0}}};

  const ledger = (card: GiftCard) => {
    const rows = transactions[card.id] ?? [];
    const issued = rows.filter(tx => tx.tx_type === 'ISSUE').reduce((sum, tx) => sum + Number(tx.amount_q), 0);
    const redeemed = rows.filter(tx => tx.tx_type === 'REDEEM').reduce((sum, tx) => sum + Number(tx.amount_q), 0);
    const expected = Math.round((issued - redeemed) * 100) / 100, stored = Number(card.balance_q);
    return {ok: true, card, ledger: {stored_balance_q: stored, expected_balance_q: expected, issue_total_q: issued, redeem_total_q: redeemed, delta_q: Math.round((expected - stored) * 100) / 100, mismatch: Math.abs(expected - stored) >= 0.005}, transactions: rows};
  };

  return (url: URL, options: RequestInit = {}): unknown => {
    const path = url.pathname, method = options.method || 'GET';
    const body: Body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    if (path === '/api/admin/branding') {
      if (method === 'PUT') {
        if (body.qr_logo_enabled === true) throw fail('QR premium requiere plan EMPRESA', 403);
        branding = {...body} as CustomerBranding;
      }
      return {ok: true, customer_branding: branding};
    }
    if (path === '/api/admin/tiers') {
      if (method === 'POST') {
        const level = whole(body.tier_level);
        if (tiers.some(tier => Number(tier.tier_level) === level)) throw fail('Ya existe un nivel con ese orden.', 400);
        const tier: Tier = {id: uuid(++sequence), name: text(body.name), tier_level: level, min_points: whole(body.min_points), min_spend: null, min_visits: null, points_multiplier: Number(body.points_multiplier ?? 1), perks: Array.isArray(body.perks) ? body.perks.map(String) : [], color: text(body.color, '') || null, icon_url: text(body.icon_url, '') || null, active: true, customer_count: 0, avg_points: null, total_points: null};
        tiers.push(tier); tiers.sort((a, b) => Number(a.tier_level) - Number(b.tier_level));
        return {ok: true, tier};
      }
      return {ok: true, tiers};
    }
    const tierMatch = path.match(/^\/api\/admin\/tiers\/([^/]+)$/);
    if (tierMatch) {
      const index = tiers.findIndex(tier => tier.id === tierMatch[1]);
      if (index < 0) throw fail('Nivel no encontrado', 404);
      if (method === 'DELETE') {
        if (Number(tiers[index].customer_count) > 0) throw fail('No se puede eliminar un nivel con clientes activos. Desactívalo en su lugar.', 400);
        tiers.splice(index, 1);
        return {ok: true};
      }
      if (method === 'PUT') {
        const current = tiers[index];
        const updated: Tier = {...current, ...(body.name !== undefined ? {name: text(body.name)} : {}), ...(body.min_points !== undefined ? {min_points: whole(body.min_points)} : {}), ...(body.points_multiplier !== undefined ? {points_multiplier: Number(body.points_multiplier)} : {}), ...(Array.isArray(body.perks) ? {perks: body.perks.map(String)} : {}), ...(body.color !== undefined ? {color: text(body.color, '') || null} : {}), ...(body.icon_url !== undefined ? {icon_url: text(body.icon_url, '') || null} : {})};
        tiers[index] = updated;
        return {ok: true, tier: updated};
      }
    }
    if (path === '/api/admin/achievements') {
      if (method === 'POST') {
        const achievement: Achievement = {id: uuid(++sequence), name: text(body.name), description: text(body.description, '') || null, icon_url: text(body.icon_url, '🏆'), requirement_type: text(body.requirement_type, 'visits'), requirement_value: whole(body.requirement_value, 1), points_reward: whole(body.points_reward), active: body.active !== false};
        achievements.push(achievement);
        return {ok: true, achievement};
      }
      return {ok: true, achievements};
    }
    const achievementMatch = path.match(/^\/api\/admin\/achievements\/([^/]+)$/);
    if (achievementMatch) {
      const index = achievements.findIndex(row => row.id === achievementMatch[1]);
      if (index < 0) throw fail('No encontrado', 404);
      if (method === 'DELETE') {achievements.splice(index, 1); return {ok: true};}
      if (method === 'PUT') {achievements[index] = {...achievements[index], ...(typeof body.active === 'boolean' ? {active: body.active} : {}), ...(body.name !== undefined ? {name: text(body.name)} : {})}; return {ok: true, achievement: achievements[index]};}
    }
    if (path === '/api/admin/challenges') {
      if (method === 'POST') {
        const challenge: Challenge = {id: uuid(++sequence), name: text(body.name), description: text(body.description, '') || null, challenge_type: text(body.challenge_type, 'limited_time'), requirement_type: text(body.requirement_type, 'visits'), requirement_value: whole(body.requirement_value, 1), reward_points: whole(body.reward_points), start_date: text(body.start_date, now().toISOString()), end_date: text(body.end_date, '') || null, recurrence: text(body.recurrence, '') || null, active: body.active !== false};
        challenges.push(challenge);
        return {ok: true, challenge};
      }
      // The real list shows only challenges that are active and currently running.
      const today = now().getTime();
      return {ok: true, challenges: challenges.filter(row => row.active && new Date(row.start_date).getTime() <= today && (!row.end_date || new Date(row.end_date).getTime() >= today))};
    }
    const challengeMatch = path.match(/^\/api\/admin\/challenges\/([^/]+)$/);
    if (challengeMatch) {
      const index = challenges.findIndex(row => row.id === challengeMatch[1]);
      if (index < 0) throw fail('No encontrado', 404);
      if (method === 'DELETE') {challenges.splice(index, 1); return {ok: true};}
      if (method === 'PUT') {challenges[index] = {...challenges[index], ...(typeof body.active === 'boolean' ? {active: body.active} : {})}; return {ok: true, challenge: challenges[index]};}
    }
    if (path === '/api/admin/gift-cards') {
      if (method === 'POST') {
        const value = Number(body.amount_q);
        if (!Number.isFinite(value) || value <= 0) throw fail('Indica un monto mayor que cero.', 400);
        const existing = typeof body.requestId === 'string' ? cards.find(card => card.id === `request:${body.requestId}`) : undefined;
        if (existing) return {ok: true, gift_card: existing};
        const number = String(++sequence).padStart(4, '0');
        const card: GiftCard = {id: typeof body.requestId === 'string' ? `request:${body.requestId}` : uuid(sequence), code: `GC-DEMO-${number}`, qr_token: `demo-token-${number}`, balance_q: value, initial_amount_q: value, status: 'ACTIVE', created_at: now().toISOString(), issued_to_name: text(body.issued_to_name, '') || null, issued_to_phone: text(body.issued_to_phone, '') || null};
        cards.unshift(card);
        transactions[card.id] = [{id: uuid(++sequence), tx_type: 'ISSUE', amount_q: value, balance_after_q: value, created_at: card.created_at}];
        return {ok: true, gift_card: card};
      }
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
      return {ok: true, gift_cards: cards.slice(0, limit)};
    }
    const ledgerMatch = path.match(/^\/api\/admin\/gift-cards\/([^/]+)\/ledger$/);
    if (ledgerMatch && method === 'GET') {
      const key = decodeURIComponent(ledgerMatch[1]);
      const card = cards.find(row => row.code === key || row.qr_token === key);
      if (!card) throw fail('Gift card no encontrada', 400);
      return ledger(card);
    }
    if (path === '/api/admin/awards/suspicious' && method === 'GET') return {ok: true, awards: suspicious};
    if (path === '/api/admin/program') {
      if (method === 'POST') {
        const next = (body.program_json && typeof body.program_json === 'object' ? body.program_json : {}) as ProgramConfig;
        program = {program_type: text(body.program_type, program.program_type), program_json: {...next}};
        return {ok: true, business: {program_type: program.program_type, program_json: program.program_json}};
      }
      return {ok: true, program_type: program.program_type, program_json: program.program_json};
    }
    return undefined;
  };
}
const ownerProgramDemo = createOwnerProgramDemoApi();
export function demoOwnerProgram(url: URL, options: RequestInit = {}) {return ownerProgramDemo(url, options);}
