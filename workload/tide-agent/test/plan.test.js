import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, prompt } from '../lib/plan.js';

const crossings = [{ id: 'd1-1100', day: 1, departs: '11:00', status: 'cancelled' }, { id: 'd1-1530', day: 1, departs: '15:30', status: 'scheduled' }];

test('a rebook between two known crossings is accepted', () => {
  assert.deepEqual(validate('{"action":"rebook","from":"d1-1100","to":"d1-1530"}', crossings), { action: 'rebook', from: 'd1-1100', to: 'd1-1530' });
});

test('an action outside the allowlist is refused', () => {
  assert.throws(() => validate({ action: 'delete', from: 'd1-1100' }, crossings), /allowlist/);
});

test('a crossing the agent was not shown is refused, also a path-shaped one', () => {
  assert.throws(() => validate({ action: 'cancel', from: 'd9-9999' }, crossings), /unknown crossing/);
  assert.throws(() => validate({ action: 'cancel', from: '../admin' }, crossings), /unknown crossing/);
});

test('free text is not JSON and is refused', () => {
  assert.throws(() => validate('Sure, I moved everyone!', crossings), /did not answer JSON/);
});

test('the request text is quoted into the prompt and cut at 500 characters', () => {
  const p = prompt('x'.repeat(900) + '"', crossings);
  assert.ok(p.includes('"' + 'x'.repeat(500) + '"'));
  assert.ok(p.includes('d1-1530'));
});
