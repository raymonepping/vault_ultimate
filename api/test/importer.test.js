import { test } from "node:test";
import assert from "node:assert/strict";
import { importConfig } from "../lib/importer.js";

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
