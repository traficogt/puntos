import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awardPointsSchema, businessCustomerBrandingSchema, emailSchema, metaSchema,
  optionalUuidSchema, paginationSchema, rewardCreateSchema, staffLoginSchema,
  uuidSchema, validateQuery, validateRequest, verifyJoinCodeSchema
} from '../../src/utils/schemas.js';
import { validate } from '../../src/utils/validation.js';
import { dateTimeSchema } from '../../src/utils/date-time-schema.js';

function responseRecorder() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('validation middleware retains HTTP 400 field details for invalid bodies and query strings', () => {
  const response = responseRecorder();
  let nextCalled = false;
  validateRequest(staffLoginSchema)({ body: { email: 'staff@example.com' } }, response, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Validation failed');
  assert.equal(response.body.details[0].field, 'password');
  assert.equal(typeof response.body.details[0].message, 'string');
  const queryResponse = responseRecorder();
  validateQuery(paginationSchema)({ query: { limit: '0' } }, queryResponse, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(queryResponse.statusCode, 400);
  assert.equal(queryResponse.body.error, 'Invalid query parameters');
  assert.equal(queryResponse.body.details[0].field, 'limit');
  const validation = validate(staffLoginSchema, {});
  assert.ok('fieldErrors' in validation.error);
  assert.ok('password' in validation.error.fieldErrors);
  assert.ok(Array.isArray(validation.error.fieldErrors.password));
});

test('existing UUID and email inputs keep their acceptance rules', () => {
  for (const id of ['11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'abcdefab-cdef-abcd-efab-cdefabcdefab']) {
    assert.equal(uuidSchema.parse(id), id);
    assert.equal(optionalUuidSchema.parse([id, 'ignored']), id);
  }
  assert.equal(uuidSchema.safeParse('not-a-uuid').success, false);
  assert.equal(optionalUuidSchema.parse(''), undefined);
  assert.equal(optionalUuidSchema.parse(null), undefined);
  assert.equal(emailSchema.parse("o'connor@example.com"), "o'connor@example.com");
});

test('records retain JSON values and the existing metadata size boundary', () => {
  const meta = { text: 'café', count: 2, optional: null, nested: { list: [true, 4] } };
  assert.deepEqual(metaSchema.parse(meta), meta);
  assert.deepEqual(awardPointsSchema.parse({ customerQrToken: 'token', txId: '11111111-1111-1111-1111-111111111111', meta }).meta, meta);
  assert.equal(metaSchema.safeParse({ text: 'x'.repeat(10000) }).success, false);
});

test('defaults, query coercion, branding transforms and optional enrollment tokens remain compatible', () => {
  assert.deepEqual(paginationSchema.parse({}), { limit: 50, offset: 0 });
  assert.deepEqual(paginationSchema.parse({ limit: '20', offset: '4', ignored: 'field' }), { limit: 20, offset: 4 });
  assert.deepEqual(businessCustomerBrandingSchema.parse({ primary_color: ' #aabbcc ', customer_program_name: '  Café  ' }), {
    branding_mode: 'endorsed_brand', powered_by_visible: true, primary_color: '#AABBCC', customer_program_name: 'Café'
  });
  assert.equal(rewardCreateSchema.parse({ name: 'Coffee', points_cost: 10 }).active, true);
  const enrollment = verifyJoinCodeSchema.parse({ phone: '+50212345678', code: '1234', visitToken: { stale: true } });
  assert.equal(enrollment.visitToken, undefined);
});

test('reward timestamps retain minute precision without changing the supplied value', () => {
  for (const valid_until of ['2026-11-11T12:30Z', '2026-11-11T12:30:45Z', '2026-11-11T12:30:45.123Z']) {
    assert.equal(rewardCreateSchema.parse({ name: 'Coffee', points_cost: 10, valid_until }).valid_until, valid_until);
  }
  for (const valid_until of ['2026-02-30T12:30Z', '2026-11-11T25:30Z', '2026-11-11T12:30', '2026-11-11T12:30+02:00']) {
    assert.equal(rewardCreateSchema.safeParse({ name: 'Coffee', points_cost: 10, valid_until }).success, false);
  }
});

test('integer query values retain database-sized ranges and reject imprecise unsafe integers', () => {
  assert.equal(paginationSchema.parse({ offset: '2147483647' }).offset, 2147483647);
  assert.equal(paginationSchema.safeParse({ offset: String(Number.MAX_SAFE_INTEGER + 1) }).success, false);
});

test('offset timestamps retain basic and extended ISO offsets at minute and second precision', () => {
  const schema = dateTimeSchema({ offset: true });
  for (const value of ['2026-11-11T12:30+0200', '2026-11-11T12:30+02:00', '2026-11-11T12:30:45-0600', '2026-11-11T12:30:45.123-06:00', '2024-02-29T12:30Z']) {
    assert.equal(schema.parse(value), value);
  }
  for (const value of ['2026-02-29T12:30+02:00', '2026-11-11T12:30+99:99', '2026-11-11T12:30+02', '2026-11-11T12:30']) {
    assert.equal(schema.safeParse(value).success, false);
  }
});
