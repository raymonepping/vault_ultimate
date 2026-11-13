import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manifestSql, rng, q } from './manifest-sql.js';

const story = JSON.parse(readFileSync(new URL('../config/story.json', import.meta.url)));

test('the manifest is deterministic: the same seed gives the same SQL', () => {
  assert.equal(manifestSql(story), manifestSql(story));
});

test('one crossing per day and departure, booked_per_crossing passengers each', () => {
  const sql = manifestSql(story);
  assert.equal((sql.match(/INSERT INTO crossings/g) || []).length, story.schedule.days * story.schedule.departures.length);
  assert.equal((sql.match(/INSERT INTO passengers/g) || []).length, story.schedule.days * story.schedule.departures.length * story.schedule.booked_per_crossing);
  assert.match(sql, /'d1-1100'/);
});

test('quoting doubles single quotes', () => {
  assert.equal(q("O'Neil"), "'O''Neil'");
});

test('the generator stays in [0, 1)', () => {
  const r = rng(1);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});
