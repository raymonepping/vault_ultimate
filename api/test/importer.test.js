import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, chmodSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importConfig, runImport, cleanOutput, importFailed } from "../lib/importer.js";

const secrets = [{ aws_name: "tidewell-legacy/delivery-api", kv_name: "parcel/delivery-api" }, { aws_name: "a.b+c", kv_name: "parcel/x" }];

test("one mapping per secret, exact names, LocalStack's /32 only", () => {
  const h = importConfig({ secrets, address: "https://vault-1:8200", namespace: "tidewell", localstackIp: "10.89.28.50" });
  assert.equal(h.match(/^mapping \{/gm).length, 2);
  assert.match(h, /allowed_ipv4_cidrs = \["10\.89\.28\.50\/32"\]/);
  assert.match(h, /filter = "Secret.Name == \\"tidewell-legacy\/delivery-api\\""/);
  // Regex metacharacters in a name are escaped, so "a.b+c" matches itself only.
  assert.match(h, /from = "\^a\\\\.b\\\\\+c\$"/);
  assert.match(h, /to = "parcel\/x"/);
});

test("the CLI output loses colour, log prefixes and anything token-shaped", () => {
  const out = cleanOutput("\x1b[32m2026-11-12T10:08:34.942Z [INFO]  aws source configured\x1b[0m\nVAULT_TOKEN=hvs.CAESIabcdefghijklmnopqrstuvwxyz");
  assert.equal(out, "aws source configured\nVAULT_TOKEN=[token removed]");
});

test("the token goes in the child's environment, never argv; the config file is gone after", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fakevault-"));
  const bin = join(dir, "vault");
  // A fake vault: records its argv, whether it got a token, and the config path.
  writeFileSync(bin, `#!/bin/sh\necho "argv: $*" > "${dir}/seen"\n[ -n "$VAULT_TOKEN" ] && echo token-in-env >> "${dir}/seen"\nfor a; do case "$a" in -config=*) echo "\${a#-config=}" > "${dir}/config";; esac; done\necho planned\n`);
  chmodSync(bin, 0o755);
  const r = await runImport("apply", { token: "hvs.secret-token-value", config: "x", vaultAddr: "https://vault-1:8200", bin });
  assert.equal(r.ok, true);
  assert.equal(r.output, "planned");
  const seen = readFileSync(join(dir, "seen"), "utf8");
  assert.match(seen, /argv: operator import -config=\S+ -auto-approve apply/);
  assert.ok(!seen.includes("hvs.secret-token-value"));
  assert.match(seen, /token-in-env/);
  assert.equal(existsSync(readFileSync(join(dir, "config"), "utf8").trim()), false);
  await assert.rejects(runImport("destroy", { token: "t", config: "x", vaultAddr: "x", bin }));
});

test("exit 0 with a not-imported list is a failure (measured: the CLI exits 0)", () => {
  assert.equal(importFailed("Import Progress: 100%\nSecrets not imported to dest \"tidewell\" due to write errors:\n  * x: 403"), true);
  assert.equal(importFailed("Import Progress: 100%\nAll planned imports completed successfully"), false);
});
