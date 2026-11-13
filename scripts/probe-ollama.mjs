// scripts/probe-ollama.mjs: probe question 10. Times each model under D8's
// limits: cold load, time to the first token (streamed), tokens per second,
// and the valid-JSON rate on a fixed task. Runs in a throwaway node container
// on vult-internal (Ollama has no host port). Prints one JSON object.
// Usage: node probe-ollama.mjs <model> [<model> ...]
const BASE = process.env.OLLAMA_URL || 'http://ollama:11434';
const RUNS = Number(process.env.RUNS || 3);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 120000);

// A referenced setTimeout plus AbortController: AbortSignal.timeout alone
// has been seen never to fire in Node (the user's memory).
async function call(path, body, onChunk) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body), signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    if (!onChunk) return await res.json();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let last = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        last = JSON.parse(line);
        onChunk(last);
      }
    }
    return last;
  } finally {
    clearTimeout(timer);
  }
}

const PROMPT = 'In one sentence, what does a ferry booking clerk do when a crossing is cancelled for weather?';
const JSON_TASK =
  'Return only JSON: {"action": "rebook" or "cancel" or "none", "crossing": string}. ' +
  'Request: "Please move everyone on the 11:00 crossing of day 1 to the 15:30, the 11:00 is cancelled for storm."';

async function unload(model) {
  await call('/api/generate', { model, prompt: '', keep_alive: 0, stream: false }).catch(() => {});
}

async function streamed(model) {
  const t0 = performance.now();
  let first = null;
  const final = await call('/api/generate', { model, prompt: PROMPT, stream: true, keep_alive: '5m', options: { num_ctx: 2048 } }, (c) => {
    if (first === null && c.response) first = performance.now() - t0;
  });
  return {
    first_token_ms: Math.round(first ?? -1),
    total_ms: Math.round(performance.now() - t0),
    load_ms: Math.round((final.load_duration || 0) / 1e6),
    tokens: final.eval_count || 0,
    tokens_per_s: final.eval_duration ? +(final.eval_count / (final.eval_duration / 1e9)).toFixed(1) : 0,
  };
}

async function jsonTask(model) {
  const r = await call('/api/generate', { model, prompt: JSON_TASK, format: 'json', stream: false, keep_alive: '5m', options: { num_ctx: 2048, temperature: 0 } });
  try {
    const j = JSON.parse(r.response);
    return ['rebook', 'cancel', 'none'].includes(j.action) && typeof j.crossing === 'string';
  } catch {
    return false;
  }
}

const out = {};
for (const model of process.argv.slice(2)) {
  try {
    await unload(model);
    const cold = await streamed(model);
    const warm = [];
    for (let i = 0; i < RUNS; i++) warm.push(await streamed(model));
    let valid = 0;
    for (let i = 0; i < RUNS; i++) if (await jsonTask(model)) valid++;
    const med = (k) => warm.map((w) => w[k]).sort((a, b) => a - b)[Math.floor(warm.length / 2)];
    out[model] = {
      cold_first_token_ms: cold.first_token_ms,
      cold_load_ms: cold.load_ms,
      warm_first_token_ms: med('first_token_ms'),
      warm_tokens_per_s: med('tokens_per_s'),
      valid_json: `${valid}/${RUNS}`,
    };
    await unload(model);
  } catch (e) {
    out[model] = { error: String(e.message || e) };
  }
}
console.log(JSON.stringify(out));
