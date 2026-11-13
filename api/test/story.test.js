import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStory, createEvents, githubState, githubName, copyName, readEvidence, StoryError } from "../lib/story.js";
import { fp } from "../lib/localstack.js";

const story = {
  legacy: [
    { aws_name: "tidewell-legacy/delivery-api", kv_name: "parcel/delivery-api", labels: { owner: "delivery-team" } },
    { aws_name: "tidewell-legacy/smtp-relay", kv_name: "parcel/smtp-relay", labels: { owner: "notifications-team" } },
  ],
  sync: { secret: "parcel/delivery-api", destinations: ["github", "localstack"] },
  rotate: "parcel/delivery-api",
};
const saskia = { user: "saskia", token: "tok-saskia" };

// A fake Vault: KV metadata per path, every call recorded with its body.
function fakeVault(imported = []) {
  const kv = Object.fromEntries(imported.map((k) => [k, { current_version: 1, custom_metadata: { "import-source": "aws-sm" } }]));
  const calls = [];
  const call = async (token, method, path, { body } = {}) => {
    calls.push({ token, method, path, body });
    const m = /kv\/(metadata|data)\/(.+)$/.exec(path);
    if (m && m[1] === "metadata" && method === "GET") return kv[m[2]] ? { ok: true, status: 200, json: { data: kv[m[2]] }, errors: [] } : { ok: false, status: 404, json: null, errors: [] };
    if (m && m[1] === "metadata" && method === "POST") { kv[m[2]].custom_metadata = body.custom_metadata; return { ok: true, status: 204, json: null, errors: [] }; }
    if (m && m[1] === "data") { kv[m[2]].current_version++; return { ok: true, status: 200, json: { data: { version: kv[m[2]].current_version } }, errors: [] }; }
    return { ok: true, status: 200, json: { data: {} }, errors: [] };
  };
  return { call, calls, kv };
}
const localstack = { fingerprint: async () => "aaaaaaaa", describe: async () => null };
const make = (v, importer = { run: async () => ({ ok: true, output: "done" }), config: () => "hcl" }) =>
  createStory({ story, call: v.call, ns: (p) => `tidewell/${p}`, localstack, importer, vaultAddr: async () => "https://vault-1:8200", events: createEvents(3), evidenceFile: "/nope", localstackIp: "10.0.0.1" });

test("only the declared steps exist", async () => {
  const s = make(fakeVault());
  await assert.rejects(s.run(saskia, "home", "destroy"), (e) => e instanceof StoryError && e.status === 404);
  await assert.rejects(s.run(saskia, "sys", "mounts"), (e) => e.status === 404);
});

test("the import plans only what Vault does not hold, and refuses a second import", async () => {
  let planned;
  const v = fakeVault(["parcel/delivery-api"]);
  const s = make(v, { run: async () => ({ ok: true, output: "plan" }), config: (o) => ((planned = o.secrets), "hcl") });
  const e = await s.run(saskia, "home", "plan");
  assert.deepEqual(planned.map((l) => l.kv_name), ["parcel/smtp-relay"]);
  assert.equal(e.who, "saskia");
  const all = make(fakeVault(["parcel/delivery-api", "parcel/smtp-relay"]));
  await assert.rejects(all.run(saskia, "home", "apply"), (x) => x.status === 409 && /new version/.test(x.message));
});

test("an association needs the secret in Vault first; the name comes from the story", async () => {
  await assert.rejects(make(fakeVault()).run(saskia, "out", "github"), (e) => e.status === 409 && /Act 1/.test(e.message));
  const v = fakeVault(["parcel/delivery-api"]);
  await make(v).run(saskia, "out", "localstack");
  const set = v.calls.find((c) => c.path.endsWith("/associations/set"));
  assert.equal(set.path, "tidewell/sys/sync/destinations/aws-sm/tidewell-localstack/associations/set");
  assert.deepEqual(set.body, { mount: "kv", secret_name: "parcel/delivery-api" });
  assert.equal(set.token, "tok-saskia");
});

test("a rotation's value goes to Vault only; the event and metadata carry its fingerprint", async () => {
  const v = fakeVault(["parcel/delivery-api"]);
  const events = createEvents(5);
  const s = createStory({ story, call: v.call, ns: (p) => `tidewell/${p}`, localstack, importer: null, vaultAddr: async () => "x", events, evidenceFile: "/nope", localstackIp: "x" });
  const e = await s.run(saskia, "change", "rotate");
  const value = v.calls.find((c) => c.path.endsWith("kv/data/parcel/delivery-api")).body.data.value;
  assert.match(value, /^tidewell-rotated-demo-[0-9a-f]{24}$/);
  assert.ok(!JSON.stringify(events.list()).includes(value));
  assert.equal(v.kv["parcel/delivery-api"].custom_metadata.value_fp, fp(value));
  assert.equal(v.kv["parcel/delivery-api"].custom_metadata["import-source"], "aws-sm");
  assert.match(e.summary, new RegExp(`version 2 \\(fingerprint ${fp(value)}\\)`));
});

test("one step at a time", async () => {
  let release;
  const slow = { run: () => new Promise((r) => (release = () => r({ ok: true, output: "" }))), config: () => "" };
  const s = make(fakeVault(), slow);
  const first = s.run(saskia, "home", "plan");
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(s.run(saskia, "out", "github"), (e) => e.status === 409 && /busy/.test(e.message));
  release();
  await first;
  assert.equal(s.busy(), null);
});

test("the event list keeps the newest, bounded", () => {
  const ev = createEvents(2);
  for (const i of [1, 2, 3]) ev.add({ i });
  assert.deepEqual(ev.list().map((e) => e.i), [3, 2]);
});

test("GitHub evidence read before Vault's last sync is stale, never current", () => {
  const ev = { read_at: "2026-11-12T10:00:00Z", secrets: { TIDEWELL_PARCEL_DELIVERY_API_VALUE: "2026-11-12T09:59:00Z" } };
  assert.equal(githubState(ev, "TIDEWELL_PARCEL_DELIVERY_API_VALUE", "2026-11-12T10:05:00Z").state, "stale");
  assert.equal(githubState(ev, "TIDEWELL_PARCEL_DELIVERY_API_VALUE", "2026-11-12T09:59:30Z").state, "present");
  assert.equal(githubState(ev, "TIDEWELL_OTHER_VALUE", null).state, "absent");
  // Read in the same second as Vault's sync (whole seconds vs fractions): GitHub's own write decides.
  const same = { read_at: "2026-11-12T10:48:03Z", secrets: { X: "2026-11-12T10:48:03Z" } };
  assert.equal(githubState(same, "X", "2026-11-12T10:48:03.512Z").state, "present");
  assert.equal(githubState({ ...same, secrets: { X: "2026-11-12T10:48:01Z" } }, "X", "2026-11-12T10:48:03.512Z").state, "stale");
  assert.equal(githubState({ read_at: null, secrets: {}, missing: "no evidence yet" }, "X", null).state, "unknown");
});

test("the names the destination templates give (probe P23)", () => {
  assert.equal(githubName("parcel/delivery-api"), "TIDEWELL_PARCEL_DELIVERY_API_VALUE");
  assert.equal(copyName("parcel/delivery-api"), "vault/tidewell/parcel/delivery-api");
});

test("a partly failed import labels exactly the secrets that landed", async () => {
  const v = fakeVault();
  // The import wrote one of two, then reported a refusal.
  const importer = { run: async () => { v.kv["parcel/delivery-api"] = { current_version: 1, custom_metadata: { "import-source": "aws-sm" } }; return { ok: false, output: "Secrets not imported ..." }; }, config: () => "" };
  const e = await make(v, importer).run(saskia, "home", "apply");
  assert.equal(e.ok, false);
  assert.equal(v.kv["parcel/delivery-api"].custom_metadata.value_fp, "aaaaaaaa");
  assert.equal(v.kv["parcel/smtp-relay"], undefined); // not created by a label
});

test("evidence read mid-write is read again once", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "ev-")), "evidence.json");
  writeFileSync(f, '{"read_at": "2026-11');
  setTimeout(() => writeFileSync(f, JSON.stringify({ read_at: "2026-11-12T10:00:00Z", secrets: [{ name: "X", updated_at: "2026-11-12T09:00:00Z" }] })), 20);
  const ev = await readEvidence(f);
  assert.equal(ev.read_at, "2026-11-12T10:00:00Z");
  assert.equal(ev.secrets.X, "2026-11-12T09:00:00Z");
});

test("a rotation whose fingerprint label is refused is not reported as done", async () => {
  const v = fakeVault(["parcel/delivery-api"]);
  const call = async (token, method, path, o = {}) =>
    method === "POST" && path.includes("/metadata/") ? { ok: false, status: 403, json: null, errors: ["permission denied"] } : v.call(token, method, path, o);
  const s = createStory({ story, call, ns: (p) => `tidewell/${p}`, localstack, importer: null, vaultAddr: async () => "x", events: createEvents(5), evidenceFile: "/nope", localstackIp: "x" });
  const e = await s.run(saskia, "change", "rotate");
  assert.equal(e.ok, false);
  assert.match(e.summary, /version 2, but Vault refused its fingerprint label: permission denied/);
});
