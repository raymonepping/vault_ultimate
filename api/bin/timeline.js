// bin/timeline.js: act 6's timeline, evidence panel and summary from the
// drill's records (/out/raw.json, collected by ansible/act-6.yml) into
// /out/timeline.json. scripts/timeline.sh runs it on vult-internal, where
// Ollama is; Ollama sees the rows only, and only sentences that cite real
// rows are kept. Ollama down or slow: "not available", the rows stay whole.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildTimeline, panel, summarise, SUMMARY_SCHEMA } from '../lib/timeline.js';

const out = process.env.TIMELINE_OUT || '/out';
const OLLAMA = (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 20000);

async function ask(prompt) {
  const ac = new AbortController();
  // Referenced, not AbortSignal.timeout alone: that was seen never to fire.
  const timer = setTimeout(() => ac.abort(new Error(`no answer within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, format: SUMMARY_SCHEMA, stream: false, keep_alive: '10m', options: { temperature: 0, num_ctx: 4096 } }),
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    return (await r.json()).response;
  } catch (e) {
    throw ac.signal.aborted ? ac.signal.reason : e;
  } finally {
    clearTimeout(timer);
  }
}

const raw = JSON.parse(readFileSync(`${out}/raw.json`, 'utf8'));
const rows = buildTimeline(raw);
const t0 = Date.now();
const summary = await summarise(rows, ask);
const doc = { built_at: new Date().toISOString(), model: MODEL, model_ms: Date.now() - t0, drill: raw.drill, panel: panel(raw, rows), rows, summary };
writeFileSync(`${out}/timeline.json`, `${JSON.stringify(doc, null, 2)}\n`);

for (const r of rows) console.log(`${r.id} ${r.at} ${r.source.padEnd(11)} ${r.text}`);
const p = doc.panel;
console.log(`window ${p.window ? `${p.window.seconds}s (revoke to session gone ${p.window.revoke_to_gone_seconds}s)` : 'n/a'}, hand changes ${p.hand_changes}, people ${p.people.join(', ') || 'none'}`);
console.log(summary.available ? `summary: ${summary.sentences.length} cited sentence(s), ${summary.dropped} dropped (${doc.model_ms} ms)` : `summary: ${summary.text} (${summary.reason})`);
