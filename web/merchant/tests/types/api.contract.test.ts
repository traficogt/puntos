import { request } from '../../src/typed-api';
import { createMerchantApi } from '../../src/api-contracts';
import type { ProgramUpdate, RegionUpdate } from '../../src/types/api';
import type { RewardPayload } from '../../src/types/models';

const client = createMerchantApi(async () => ({}));
const region = await client.get('/api/admin/region');
// @ts-expect-error The region endpoint does not return a program.
region.program.rate;
const currency: string = region.region.currency;
void currency;
const validRegion: RegionUpdate = { country: 'GT', currency: 'GTQ', timezone: 'America/Guatemala', version: 'version' };
await client.put('/api/admin/region', validRegion);
// @ts-expect-error Country, currency, timezone and version are required.
await client.put('/api/admin/region', { currency: 'GTQ' });
// @ts-expect-error The transport must not send a textual numeric program rate.
await client.put('/api/admin/launch/program', { program_type: 'SPEND', rate: '10', round: 'ceil', version: 'version' });
// @ts-expect-error Unknown endpoints require an explicit caller-owned request contract.
await client.get('/api/admin/not-a-reviewed-endpoint');
const validProgram: ProgramUpdate = { program_type: 'VISIT', rate: 10, round: 'floor', version: 'version' };
// @ts-expect-error A program payload cannot be sent to the region endpoint.
await client.put('/api/admin/region', validProgram);
// @ts-expect-error A read cannot be supplied a mutation body.
await client.get('/api/admin/region', {body: '{}'});
const saved = await client.put('/api/admin/launch/program', validProgram);
const rate: number | null = saved.program.rate;
void rate;
// @ts-expect-error Program mutation replies do not contain customer IDs.
saved.customers;
// @ts-expect-error Reward payloads carry numeric points after form validation.
const invalidReward: RewardPayload['reward'] = { name: 'Coffee', description: null, points_cost: '50', active: true, stock: null, valid_until: null, branch_ids: [] };
void invalidReward;

const unspecified = await request('/api/admin/custom-endpoint');
// @ts-expect-error An explicit generic response contract is required for access.
unspecified.customers;
const owner = await request<{ customers: { id: string }[] }>('/api/admin/customers');
const id: string | undefined = owner.customers[0]?.id;
void id;
// @ts-expect-error A caller-owned response contract also rejects invented fields.
owner.staff;

// "Tu progreso": the read is typed, writes name their endpoint and payload, and nothing invents a score.
const progress = await client.get('/api/admin/owner-progress');
const stepsDone: number = progress.launch.done_count;
void stepsDone;
const goalKey: string | undefined = progress.goal?.key;
void goalKey;
// @ts-expect-error The progress payload carries no composite score.
progress.score;
await client.post('/api/admin/owner-progress/acknowledge', { keys: ['programa_en_marcha'] });
await client.post('/api/admin/owner-progress/goal', { key: 'monthly_review' });
await client.post('/api/admin/owner-progress/goal', { dismiss: 'returning_5' });
// @ts-expect-error A goal change names either a goal or a dismissal, never both.
await client.post('/api/admin/owner-progress/goal', { key: 'monthly_review', dismiss: 'monthly_review' });
// @ts-expect-error Review decisions are keep or adjust.
await client.post('/api/admin/owner-progress/review', { decision: 'delete' });
await client.post('/api/admin/owner-progress/review', { decision: 'adjust', note: 'Recompensa más cercana' });
// @ts-expect-error Visibility is a boolean, not text.
await client.post('/api/admin/owner-progress/visibility', { hidden: 'yes' });
// @ts-expect-error The acknowledge body lists milestone keys.
await client.post('/api/admin/owner-progress/acknowledge', { key: 'first_customer' });
// @ts-expect-error The progress read is not a mutation endpoint.
await client.post('/api/admin/owner-progress', {});
