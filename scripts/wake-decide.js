#!/usr/bin/env node
// scripts/wake-decide.js: what make wake-up must repair (D16), from what
// scripts/wake-up.sh observed. Pure: the decision is unit-tested
// (scripts/wake-decide.test.js); the script does the repairs.
//
//   observed: { skew, act, containers: [{name, state, health, stack, service}],
//               agent: {state, health} | null, booking: {database, credential} | null }
//   -> [{ do: 'clock-sync' | 'restart' | 'agent', why, stack?, service?, name? }]
//
// One-shot init and bootstrap containers are never restarted (they exit 0 by
// design); a container compose did not make is not this lab's to restart.
const ONE_SHOT = /_(init|bootstrap)$/;

export function decide(o) {
  const out = [];
  if (Math.abs(o.skew ?? 0) > 2) out.push({ do: 'clock-sync', why: `the VM clock is ${o.skew} s off the Mac` });
  for (const c of o.containers || []) {
    if (ONE_SHOT.test(c.name) || !c.stack || !c.service) continue;
    if (c.name === 'vult-booking_agent') continue; // the agent decision below owns it
    const broken = c.state === 'exited' || c.state === 'dead' || c.state === 'created' || c.health === 'unhealthy';
    if (broken) out.push({ do: 'restart', name: c.name, stack: c.stack, service: c.service, why: `${c.name} is ${c.health === 'unhealthy' ? 'unhealthy' : c.state}` });
  }
  if ((o.act ?? 0) >= 2) {
    const a = o.agent;
    const app = o.booking;
    const agentDown = !a || a.state !== 'running' || a.health === 'unhealthy';
    const appOff = app && (app.database !== 'up' || app.credential !== 'vault-agent');
    // A restarted Agent has lost its tmpfs token and its secret id is spent:
    // only a fresh wrapped secret id brings it back.
    if (agentDown || appOff) out.push({ do: 'agent', why: agentDown ? `Vault Agent is ${a ? (a.health === 'unhealthy' ? 'unhealthy' : a.state) : 'gone'}` : `the app is ${app.database !== 'up' ? 'off its database' : 'not on its lease'}` });
  }
  return out;
}

// node scripts/wake-decide.js '<observed JSON>' prints the actions as JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(decide(JSON.parse(process.argv[2] || '{}')))}\n`);
}
