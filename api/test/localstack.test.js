import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createLocalStack, fp } from "../lib/localstack.js";

test("fp is the first 8 hex of SHA-256", () => assert.equal(fp("abc"), "ba7816bf"));

// A fake Secrets Manager: one legacy secret (a plain string) and one synced copy (secret-path JSON).
const store = { "tidewell-legacy/a": "legacy-demo-1", "vault/tidewell/parcel/a": JSON.stringify({ value: "copy-demo-2" }) };
const seen = [];
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const action = req.headers["x-amz-target"];
    seen.push({ action, type: req.headers["content-type"] });
    if (req.url === "/_localstack/health") return res.end(JSON.stringify({ services: { secretsmanager: "running" }, version: "x" }));
    const { SecretId } = JSON.parse(body);
    res.setHeader("content-type", "application/x-amz-json-1.1");
    if (!(SecretId in store)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ __type: "ResourceNotFoundException", message: "not found" }));
    }
    if (action === "secretsmanager.DescribeSecret") return res.end(JSON.stringify({ Name: SecretId, Tags: [{ Key: "owner", Value: "t" }], CreatedDate: 1794470000.5 }));
    if (action === "secretsmanager.GetSecretValue") return res.end(JSON.stringify({ Name: SecretId, SecretString: store[SecretId] }));
    res.statusCode = 500;
    res.end("{}");
  });
});

test("LocalStack: names, tags and dates; never a value", async (t) => {
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  t.after(() => fake.close());
  const ls = createLocalStack({ url: `http://127.0.0.1:${fake.address().port}` });
  const d = await ls.describe("tidewell-legacy/a");
  assert.equal(d.tags.owner, "t");
  assert.match(d.created, /^2026-/);
  assert.equal(await ls.describe("missing"), null);
  assert.ok(!JSON.stringify(d).includes("demo"));
  assert.ok(seen.every((s) => s.type === "application/x-amz-json-1.1"));
});

test("LocalStack: unreachable is an error, not an empty store", async () => {
  const ls = createLocalStack({ url: "http://127.0.0.1:9" });
  await assert.rejects(ls.describe("x"), (e) => e.status === 503);
});
