// lib/plan.js: turn a clerk's request into one allowlisted action. The model
// only chooses among fixed actions and crossing ids it was shown; it never
// builds a URL, a query or a path. Anything else is refused.
export const ACTIONS = ['rebook', 'cancel', 'none'];
const CROSSING = /^d[0-9]-[0-9]{4}$/;

export function prompt(text, crossings) {
  const list = crossings.map((c) => `${c.id} (day ${c.day} ${c.departs}, ${c.status})`).join('; ');
  return (
    'You map a ferry clerk\'s request onto exactly one action. Answer only JSON: ' +
    '{"action": "rebook" | "cancel" | "none", "from": crossing id or null, "to": crossing id or null}. ' +
    `Known crossings: ${list}. Request: ${JSON.stringify(String(text).slice(0, 500))}`
  );
}

// validate(answer, crossings): the action, or throws with the reason.
export function validate(answer, crossings) {
  let a = answer;
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      throw new Error('the model did not answer JSON');
    }
  }
  if (!a || !ACTIONS.includes(a.action)) throw new Error('the model chose an action outside the allowlist');
  if (a.action === 'none') return { action: 'none' };
  const ids = new Set(crossings.map((c) => c.id));
  for (const k of a.action === 'rebook' ? ['from', 'to'] : ['from']) {
    if (typeof a[k] !== 'string' || !CROSSING.test(a[k]) || !ids.has(a[k])) throw new Error(`the model named an unknown crossing (${k})`);
  }
  if (a.action === 'rebook' && a.from === a.to) throw new Error('rebook needs two different crossings');
  return a.action === 'rebook' ? { action: 'rebook', from: a.from, to: a.to } : { action: 'cancel', from: a.from };
}
