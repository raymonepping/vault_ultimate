import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkStory, checkInventory } from './story-check.js';

const story = () => JSON.parse(readFileSync(new URL('../config/story.json', import.meta.url)));
const inv = () => JSON.parse(readFileSync(new URL('../config/inventory.json', import.meta.url)));

test('the shipped story and inventory are valid', () => {
  assert.deepEqual(checkStory(story()), []);
  assert.deepEqual(checkInventory(inv(), story()), []);
});

test('a real-looking value is refused (the GitHub repository is public)', () => {
  const d = story();
  d.legacy[0].value = 'prod-harbour-key-7f3a9c'; // no "demo": not marked synthetic
  assert.match(checkStory(d).join(), /synthetic/);
});

test('a support note never carries a credential', () => {
  const d = story();
  d.notes.act0 = 'try postgres://booking_app:synthetic-demo@postgres/tidewell';
  assert.match(checkStory(d).join(), /must not carry a credential/);
});

test('the weather cancellation must rebook to another departure in the schedule', () => {
  const d = story();
  d.weather_cancel.rebook_to = d.weather_cancel.departure;
  assert.match(checkStory(d).join(), /another departure/);
  d.weather_cancel.rebook_to = '23:59';
  assert.match(checkStory(d).join(), /in the schedule/);
});

test('an inventory credential the witness cannot try is refused', () => {
  const i = inv();
  i.credentials[0].test = 'look-at-it';
  assert.match(checkInventory(i, story()).join(), /no way to try it/);
});

test('a residual needs a reason and no removing act', () => {
  const i = inv();
  const r = i.credentials.find((c) => c.residual);
  delete r.residual_reason;
  r.removed_by_act = 3;
  const errors = checkInventory(i, story()).join();
  assert.match(errors, /no removing act/);
  assert.match(errors, /needs its reason/);
});

test('a copy must hold a known credential or legacy secret', () => {
  const i = inv();
  i.copies[0].holds = 'nothing-known';
  assert.match(checkInventory(i, story()).join(), /neither a credential/);
});
