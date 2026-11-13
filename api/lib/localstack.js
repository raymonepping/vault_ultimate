// lib/localstack.js: LocalStack's Secrets Manager (the AWS JSON protocol),
// with fetch only (D14). Synthetic credentials: LocalStack is an emulator and
// accepts any signature for its test keys. TLS is verified against the lab CA
// (NODE_EXTRA_CA_CERTS, D11).
// It reads names, tags and dates only, never a value. fp() is the lab's
// fingerprint (the first 8 hex of SHA-256), used by the witness.
import { createHash } from "node:crypto";
import { fetchWithTimeout } from "./vault.js";

export const LOCALSTACK_URL = (process.env.LOCALSTACK_URL || "https://localstack:4566").replace(/\/$/, "");
const REGION = process.env.VULT_AWS_REGION || "eu-west-1";

export const fp = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 8);

export function createLocalStack({ url = LOCALSTACK_URL, region = REGION, fetcher = fetchWithTimeout } = {}) {
  // call(Action, body) -> { ok, status, json, error }. Never throws for a
  // refusal; throws (VaultError-shaped, status 503/504) when unreachable.
  async function call(action, body) {
    const { res, text } = await fetcher(
      `${url}/`,
      {
        method: "POST",
        headers: {
          "X-Amz-Target": `secretsmanager.${action}`,
          "Content-Type": "application/x-amz-json-1.1",
          Authorization: `AWS4-HMAC-SHA256 Credential=test/20260101/${region}/secretsmanager/aws4_request, SignedHeaders=host, Signature=0`,
        },
        body: JSON.stringify(body),
      },
      8_000,
      "LocalStack",
    );
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, error: res.ok ? null : json?.message || json?.__type || `HTTP ${res.status}` };
  }

  return {
    // Name, tags and dates; never the value. null when the secret does not exist.
    async describe(name) {
      const r = await call("DescribeSecret", { SecretId: name });
      if (r.status === 400 && /ResourceNotFound/.test(r.json?.__type || "")) return null;
      if (!r.ok) throw Object.assign(new Error(`LocalStack DescribeSecret ${name}: ${r.error}`), { status: 502 });
      const j = r.json;
      return {
        name: j.Name,
        tags: Object.fromEntries((j.Tags || []).map((t) => [t.Key, t.Value])),
        created: epoch(j.CreatedDate),
        changed: epoch(j.LastChangedDate),
        deleted: j.DeletedDate ? epoch(j.DeletedDate) : null,
      };
    },
  };
}

const epoch = (x) => (typeof x === "number" ? new Date(x * 1000).toISOString() : x || null);
