// make wake-up's decision (D16): nothing to do when all is well; the clock,
// broken containers and Agent's lost login each get their repair; one-shot
// containers and other projects are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './wake-decide.js';

const c = (name, state = 'running', health = 'healthy', stack = 'vault', service = name.replace(/^vult-/, '')) => ({ name, state, health, stack, service });
const fine = { skew: 0, act: 3, containers: [c('vult-vault_1'), c('vult-booking', 'running', 'healthy', 'workload', 'booking'), c('vult-booking_agent', 'running', 'healthy', 'workload', 'booking-agent')], agent: { state: 'running', health: 'healthy' }, booking: { database: 'up', credential: 'vault-agent' } };

test('all well: nothing to do (the fast no-op)', () => {
  assert.deepEqual(decide(fine), []);
});

test('the VM clock off by more than 2 s: clock-sync', () => {
  assert.deepEqual(decide({ ...fine, skew: -16195 }), [{ do: 'clock-sync', why: 'the VM clock is -16195 s off the Mac' }]);
  assert.deepEqual(decide({ ...fine, skew: 2 }), []);
});

test('an exited or unhealthy service is restarted through its stack; one-shots are not', () => {
  const o = { ...fine, containers: [c('vult-postgres', 'exited', null, 'data', 'postgres'), c('vult-keycloak', 'running', 'unhealthy', 'identity', 'keycloak'), c('vult-volume_init', 'exited', null, 'vault', 'volume-init'), c('vult-keycloak_bootstrap', 'exited', null, 'identity', 'keycloak-bootstrap')] };
  assert.deepEqual(decide(o).map((a) => [a.do, a.stack, a.service]), [['restart', 'data', 'postgres'], ['restart', 'identity', 'keycloak']]);
});

test('a container without a compose stack is not ours to restart', () => {
  assert.deepEqual(decide({ ...fine, containers: [{ name: 'vult-witness', state: 'exited' }] }), []);
});

test("from act 2: Agent gone or the app off its lease means a fresh secret id; before act 2 never", () => {
  assert.deepEqual(decide({ ...fine, agent: null }).map((a) => a.do), ['agent']);
  assert.deepEqual(decide({ ...fine, agent: { state: 'exited' } }).map((a) => a.why), ['Vault Agent is exited']);
  assert.deepEqual(decide({ ...fine, booking: { database: 'down', credential: 'vault-agent' } }).map((a) => a.why), ['the app is off its database']);
  assert.deepEqual(decide({ ...fine, act: 1, agent: null }), []);
});
