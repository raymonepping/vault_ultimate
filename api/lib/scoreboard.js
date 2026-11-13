// lib/scoreboard.js: the four numbers of D4, computed only from witness runs
// (lib/witness.js), each with the evidence rows it rests on. Pure functions:
// the tests feed recorded runs.
//
//   summarise(run)                -> {standing, unmanaged, longest, residual}
//   scoreboard(history, canaries) -> {at, act, standing, longest, unmanaged, leak_windows, residuals}
//
// standing      inventory credentials that work right now
// longest       of those (residuals aside), the longest remaining lifetime: "never" when one
//               has no end (VALID UNTIL infinity, no rotation), else seconds
//               to the latest end the target itself reports
// unmanaged     copies outside Vault that Vault does not keep current, while
//               what they hold still works
// leak window   per canary: from the moment it was posted to the first run
//               that saw its credential refused, to the second; open while
//               every run since saw it work

const ref = (run, id) => ({ run: run.at, id });

export function summarise({ at, credentials, copies }) {
  const working = credentials.filter((c) => c.works);
  // A residual (inventory.json says why) is counted in standing and listed on
  // its own; it does not set the longest lifetime, or the number could never
  // move off "never" for a credential the lab cannot remove.
  const owned = working.filter((c) => !c.residual);
  const never = owned.find((c) => c.lifetime?.never);
  let longest;
  if (never) longest = { never: true, id: never.id };
  else if (!owned.length) longest = { seconds: 0, id: null };
  else {
    const t0 = Date.parse(at || new Date().toISOString());
    const last = owned.filter((c) => c.lifetime?.until).sort((a, b) => Date.parse(b.lifetime.until) - Date.parse(a.lifetime.until))[0];
    longest = last ? { seconds: Math.max(0, Math.round((Date.parse(last.lifetime.until) - t0) / 1000)), until: last.lifetime.until, id: last.id } : { seconds: null, id: null };
  }
  return {
    standing: working.length,
    unmanaged: copies.filter((c) => c.unmanaged).length,
    longest,
    residual: working.filter((c) => c.residual).map((c) => c.id),
  };
}

export function leakWindow(history, canary) {
  const runs = history.filter((r) => Date.parse(r.at) >= Date.parse(canary.posted_at)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const row = (r) => r.credentials.find((c) => c.id === canary.credential);
  let lastWorking = null;
  for (const r of runs) {
    const c = row(r);
    if (!c) continue;
    if (c.works) lastWorking = r;
    else {
      return {
        canary: canary.id, credential: canary.credential, posted_at: canary.posted_at, open: false,
        closed_at: r.at, seconds: Math.round((Date.parse(r.at) - Date.parse(canary.posted_at)) / 1000),
        last_seen_working: lastWorking?.at ?? null, answer: c.answer,
        evidence: [...(lastWorking ? [ref(lastWorking, canary.credential)] : []), ref(r, canary.credential)],
      };
    }
  }
  return {
    canary: canary.id, credential: canary.credential, posted_at: canary.posted_at, open: true, closed_at: null,
    seconds: lastWorking ? Math.round((Date.parse(lastWorking.at) - Date.parse(canary.posted_at)) / 1000) : null,
    last_seen_working: lastWorking?.at ?? null, evidence: lastWorking ? [ref(lastWorking, canary.credential)] : [],
  };
}

export function scoreboard(history, canaries = []) {
  if (!history.length) return null;
  const runs = [...history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = runs.at(-1);
  const s = summarise(last);
  return {
    at: last.at,
    act: last.act,
    standing: { value: s.standing, evidence: last.credentials.filter((c) => c.works).map((c) => ref(last, c.id)) },
    longest: { value: s.longest.never ? 'never' : s.longest.seconds, ...s.longest, evidence: s.longest.id ? [ref(last, s.longest.id)] : [] },
    unmanaged: { value: s.unmanaged, evidence: last.copies.filter((c) => c.unmanaged).map((c) => ref(last, c.id)) },
    leak_windows: canaries.map((c) => leakWindow(runs, c)),
    residuals: last.credentials.filter((c) => c.residual).map((c) => ({ id: c.id, works: c.works, why: c.residual_reason ?? null, evidence: [ref(last, c.id)] })),
  };
}
