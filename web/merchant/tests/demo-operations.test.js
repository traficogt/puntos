import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoOperations } from '../src/demo-operations.js';

test('operations demo includes both message sources and actionable costs without using a provider', () => {
  const data = demoOperations();
  assert.equal(data.sections.length, 6);
  assert.match(data.sections.find(s=>s.id==='owner_brief').summary,/no acredita entrega ni lectura/);
  assert.ok(data.next_actions.some(a=>a.id==='owner_brief_history'));
  assert.ok(data.sections.every(section => Array.isArray(section.reasons)));
  assert.deepEqual(data.sections.find(section => section.id === 'messaging').sources.map(source => source.id), ['growth', 'lifecycle']);
  assert.equal(data.summary.attention_count, data.sections.filter(section => section.state === 'needs_attention').length);
  assert.equal(data.summary.configured_count, 1);
  assert.ok(data.next_actions.some(action => action.href === '#automatizaciones'));
  assert.ok(data.next_actions.some(action => action.href === '#costos'));
  assert.ok(data.next_actions.every((action, index, all) => !index || action.priority >= all[index-1].priority));
  assert.match(data.sections.find(section => section.id === 'economics').summary, /no cambia.*historial/);
  const second = demoOperations();
  data.next_actions[0].label = 'changed';
  assert.notEqual(second.next_actions[0].label, 'changed');
});
