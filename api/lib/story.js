// lib/story.js: the four acts of config/story.json, run as the presenter.
//
//   home    plan, apply        Secrets Import: LocalStack's legacy secrets into kv/parcel/*
//   out     github, localstack Secrets Sync: associate story.sync.secret with a destination
//   change  rotate             a new KV version with a value generated here (D16)
//   letgo   github, localstack remove the association: Vault deletes the copy
//
// Only these steps exist. Which secret, which destination, which path: all
// from config/story.json, never from a request. Every step returns Vault's
// answer (lib/said.js) and leaves one event. No value, token or key ever
// enters an event or a response: values are fingerprints (8 hex of SHA-256).
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { said } from "./said.js";
import { fp } from "./localstack.js";

export const DESTINATIONS = {
  github: { type: "gh", name: "tidewell-github", label: "GitHub Actions (VaultSyncDemo)" },
  localstack: { type: "aws-sm", name: "tidewell-localstack", label: "AWS Secrets Manager (LocalStack)" },
};
export const STEPS = { home: ["plan", "apply"], out: ["github", "localstack"], change: ["rotate"], letgo: ["github", "localstack"] };
const MOUNT = "kv";

// The names the destinations' templates give (roles/github_app, roles/destinations).
export const githubName = (kv) => `TIDEWELL_${kv.replace(/[/-]/g, "_").toUpperCase()}_VALUE`;
export const copyName = (kv) => `vault/tidewell/${kv}`;

const count = (n) => `${n} legacy secret${n === 1 ? "" : "s"}`;

export class StoryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createEvents(max = 200) {
  const list = [];
  return {
    add(e) {
      list.unshift(e);
      list.length = Math.min(list.length, max);
      return e;
    },
    list: () => list.slice(),
    clear: () => (list.length = 0),
  };
}

// GitHub's own record (make github-evidence on the host, D15), read fresh.
// The host rewrites it in place: a read in the middle of that write gets a
// short file, so one retry.
export async function readEvidence(file, retry = true) {
  try {
    const j = JSON.parse(await readFile(file, "utf8"));
    return { read_at: j.read_at, secrets: Object.fromEntries((j.secrets || []).map((s) => [s.name, s.updated_at])) };
  } catch (e) {
    if (retry && e instanceof SyntaxError) {
      await new Promise((r) => setTimeout(r, 100));
      return readEvidence(file, false);
    }
    return { read_at: null, secrets: {}, missing: e.code === "ENOENT" ? "no evidence yet: run make github-evidence on the host" : `unreadable: ${e.message}` };
  }
}

// What GitHub said, and whether it can still be trusted: evidence read
// before Vault's last sync of this secret is stale, never current, unless
// GitHub's own record already shows a write at or after that sync. GitHub
// and gh give whole seconds, Vault gives fractions: compare whole seconds.
export function githubState(evidence, name, vaultUpdatedAt) {
  if (!evidence.read_at) return { state: "unknown", reason: evidence.missing };
  const updated = evidence.secrets[name] || null;
  const synced = vaultUpdatedAt ? Math.floor(Date.parse(vaultUpdatedAt) / 1000) * 1000 : null;
  const seen = Boolean(updated) && synced !== null && Date.parse(updated) >= synced;
  const stale = synced !== null && !seen && Date.parse(evidence.read_at) < Date.parse(vaultUpdatedAt);
  return { state: stale ? "stale" : updated ? "present" : "absent", updated_at: updated, read_at: evidence.read_at };
}

// createStory({ story, call, ns, localstack, importer, vaultAddr, events, evidenceFile, localstackIp })
export function createStory({ story, call, ns, localstack, importer, vaultAddr, events, evidenceFile, localstackIp }) {
  let busy = null;

  const meta = async (s, kv, cid) => {
    const r = await call(s.token, "GET", ns(`${MOUNT}/metadata/${kv}`), { correlationId: cid });
    return { r, data: r.ok ? r.json.data : null };
  };
  // Merge into custom_metadata (a POST replaces the whole map).
  async function label(s, kv, add, cid) {
    const { data } = await meta(s, kv, cid);
    const custom = { ...(data?.custom_metadata || {}), ...add };
    return call(s.token, "POST", ns(`${MOUNT}/metadata/${kv}`), { body: { custom_metadata: custom }, correlationId: cid });
  }
  async function missing(s, cid) {
    const out = [];
    for (const l of story.legacy) if (!(await meta(s, l.kv_name, cid)).data) out.push(l);
    return out;
  }
  async function requireImported(s, kv, cid) {
    if (!(await meta(s, kv, cid)).data) throw new StoryError(409, `${kv} is not in Vault yet: bring it home first (Act 1)`);
  }

  const steps = {
    async "home/plan"(s, cid) {
      const todo = await missing(s, cid);
      if (!todo.length) throw new StoryError(409, "every legacy secret is already in Vault; a second import would write a new version. make stage-reset CONFIRM=yes starts over");
      const r = await importer.run("plan", { token: s.token, vaultAddr: await vaultAddr(), config: importer.config({ secrets: todo, address: await vaultAddr(), localstackIp }) });
      return { ok: r.ok, summary: r.ok ? `plan: ${count(todo.length)} to import` : "the import plan failed", output: r.output, secrets: todo.map((l) => `${l.aws_name} -> ${MOUNT}/${l.kv_name}`) };
    },
    async "home/apply"(s, cid) {
      const todo = await missing(s, cid);
      if (!todo.length) throw new StoryError(409, "every legacy secret is already in Vault; a second import would write a new version. make stage-reset CONFIRM=yes starts over");
      const r = await importer.run("apply", { token: s.token, vaultAddr: await vaultAddr(), config: importer.config({ secrets: todo, address: await vaultAddr(), localstackIp }) });
      const said_ = [];
      // The value Vault now holds is LocalStack's: record its fingerprint
      // (declared by the API, read in memory) next to Import's own labels.
      // Only for paths that landed, also after a partial failure: labelling a
      // path that did not would create it, and it would look imported.
      for (const l of todo) {
        if (!(await meta(s, l.kv_name, cid)).data) continue;
        const v = await localstack.fingerprint(l.aws_name);
        said_.push(said(s.user, "POST", `${MOUNT}/metadata/${l.kv_name}`, await label(s, l.kv_name, { value_fp: v || "unknown" }, cid)));
      }
      return { ok: r.ok, summary: r.ok ? `imported ${count(todo.length)} into ${MOUNT}/parcel/` : "the import failed", output: r.output, said: said_ };
    },
    async "out/github"(s, cid) { return associate(s, "github", "set", cid); },
    async "out/localstack"(s, cid) { return associate(s, "localstack", "set", cid); },
    async "letgo/github"(s, cid) { return associate(s, "github", "remove", cid); },
    async "letgo/localstack"(s, cid) { return associate(s, "localstack", "remove", cid); },
    async "change/rotate"(s, cid) {
      const kv = story.rotate;
      await requireImported(s, kv, cid);
      // Generated here, never from the browser; "demo" marks it synthetic
      // (the GitHub repository is public). Only its fingerprint is kept.
      const value = `tidewell-rotated-demo-${randomBytes(12).toString("hex")}`;
      const fingerprint = fp(value);
      const w = await call(s.token, "POST", ns(`${MOUNT}/data/${kv}`), { body: { data: { value } }, correlationId: cid });
      const out = [said(s.user, "POST", `${MOUNT}/data/${kv}`, w)];
      if (!w.ok) return { ok: false, summary: `Vault refused the rotation: ${w.errors[0] || w.status}`, said: out };
      const l = await label(s, kv, { value_fp: fingerprint, rotated_by: s.user, rotated_at: new Date().toISOString() }, cid);
      out.push(said(s.user, "POST", `${MOUNT}/metadata/${kv}`, l));
      const version = w.json?.data?.version;
      // Without its label the console would compare the copies to the old fingerprint.
      return l.ok
        ? { ok: true, summary: `${kv} is now version ${version} (fingerprint ${fingerprint})`, said: out }
        : { ok: false, summary: `${kv} is now version ${version}, but Vault refused its fingerprint label: ${l.errors[0] || l.status}`, said: out };
    },
  };

  async function associate(s, key, op, cid) {
    const d = DESTINATIONS[key];
    const kv = story.sync.secret;
    if (op === "set") await requireImported(s, kv, cid);
    const path = `sys/sync/destinations/${d.type}/${d.name}/associations/${op}`;
    const r = await call(s.token, "POST", ns(path), { body: { mount: MOUNT, secret_name: kv }, correlationId: cid });
    const verb = op === "set" ? `syncs ${kv} to ${d.label}` : `stopped syncing ${kv} to ${d.label}; Vault deletes the copy`;
    return { ok: r.ok, summary: r.ok ? `Vault ${verb}` : `Vault refused: ${r.errors[0] || `HTTP ${r.status}`}`, said: [said(s.user, "POST", path, r)] };
  }

  return {
    busy: () => busy,
    // run(session, act, step): one step at a time (409 while another runs).
    async run(s, act, step) {
      if (!STEPS[act]?.includes(step)) throw new StoryError(404, `no step ${act}/${step}`);
      if (busy) throw new StoryError(409, `busy: ${busy} is still running`);
      busy = `${act}/${step}`;
      const cid = `vult-${randomUUID()}`;
      const at = new Date().toISOString();
      try {
        const out = await steps[busy](s, cid);
        return events.add({ id: cid, at, act, step, who: s.user, ok: out.ok, summary: out.summary, output: out.output ?? null, secrets: out.secrets ?? null, said: out.said ?? [] });
      } catch (e) {
        if (e instanceof StoryError) throw e;
        events.add({ id: cid, at, act, step, who: s.user, ok: false, summary: `failed: ${e.message}`, output: null, secrets: null, said: [] });
        throw e;
      } finally {
        busy = null;
      }
    },

    // Both destinations as Vault reports them, with their associations.
    async sync(s) {
      const out = {};
      for (const [key, d] of Object.entries(DESTINATIONS)) {
        const base = `sys/sync/destinations/${d.type}/${d.name}`;
        const [dest, assoc] = await Promise.all([call(s.token, "GET", ns(base)), call(s.token, "GET", ns(`${base}/associations`))]);
        out[key] = {
          ...d,
          found: dest.ok,
          error: dest.ok ? null : dest.errors[0] || `HTTP ${dest.status}`,
          options: dest.ok ? dest.json.data.options : null,
          associations: Object.values(assoc.json?.data?.associated_secrets || {}).map((a) => ({
            secret_name: a.secret_name, mount: a.mount, sync_status: a.sync_status, updated_at: a.updated_at, error: a.error_message || null,
          })),
        };
      }
      return out;
    },

    // Each legacy secret in all four places: LocalStack's legacy store,
    // Vault, LocalStack's synced copy and GitHub. Fingerprints, never values.
    async sources(s) {
      const d = DESTINATIONS.github;
      const [evidence, gh] = await Promise.all([readEvidence(evidenceFile), call(s.token, "GET", ns(`sys/sync/destinations/${d.type}/${d.name}/associations`))]);
      const ghAssoc = Object.fromEntries(Object.values(gh.json?.data?.associated_secrets || {}).map((a) => [a.secret_name, a]));
      const rows = [];
      for (const l of story.legacy) {
        const [legacy, legacyFp, m, copy, copyFp] = await Promise.all([
          localstack.describe(l.aws_name),
          localstack.fingerprint(l.aws_name),
          meta(s, l.kv_name),
          localstack.describe(copyName(l.kv_name)),
          localstack.fingerprint(copyName(l.kv_name), { json: true }),
        ]);
        const v = m.data;
        rows.push({
          aws_name: l.aws_name,
          kv_name: l.kv_name,
          owner: l.labels.owner,
          legacy: legacy ? { exists: true, changed: legacy.changed, tags: legacy.tags, fingerprint: legacyFp } : { exists: false },
          vault: v
            ? { exists: true, current_version: v.current_version, created: v.created_time, updated: v.updated_time, labels: v.custom_metadata || {}, fingerprint: v.custom_metadata?.value_fp || null }
            : { exists: false, status: m.r.status, error: m.r.ok || m.r.status === 404 ? null : m.r.errors[0] || null },
          localstack_copy: copy && !copy.deleted ? { exists: true, name: copy.name, changed: copy.changed, tags: copy.tags, fingerprint: copyFp } : { exists: false, name: copyName(l.kv_name) },
          github: { name: githubName(l.kv_name), ...githubState(evidence, githubName(l.kv_name), ghAssoc[l.kv_name]?.updated_at) },
        });
      }
      return { evidence_read_at: evidence.read_at, evidence_missing: evidence.missing || null, secrets: rows };
    },

  };
}
