// lib/vault.js: the only place the API talks to Vault (from vault_identity).
//
// Who acts is explicit (D13): every call names its token, and the only token
// is the presenter's own, held in her server-side session. There is no
// console token and no VAULT_TOKEN variable, so the audit log names Saskia for
// every import, sync and rotation the console runs.
//
// Every story path lives in namespace tidewell: callers name it with ns().
// Every call goes to the ACTIVE node (sys/leader, cached for a few seconds).
// TLS: NODE_EXTRA_CA_CERTS adds the lab CA. Nothing disables verification.
//
// call() never throws for a Vault refusal: the story needs Vault's answer
// (status, errors verbatim, request id) as data. It throws VaultError only
// when Vault cannot be reached.

export const VAULT_NODES = (
  process.env.VAULT_NODES ||
  "https://vault-1:8200,https://vault-2:8200,https://vault-3:8200"
)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
export const NAMESPACE = process.env.VULT_NAMESPACE || "tidewell";
const ACTIVE_TTL_MS = 5_000;

// A path in the story's namespace.
export const ns = (path) => `${NAMESPACE}/${path}`;

export class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A referenced setTimeout aborts the whole exchange, body included
// (AbortSignal.timeout was seen never to fire on a hung connection).
export async function fetchWithTimeout(url, opts, timeoutMs, label = "Vault") {
  const ac = new AbortController();
  const t = setTimeout(
    () => ac.abort(new Error(`timed out after ${timeoutMs} ms`)),
    timeoutMs,
  );
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    return { res, text: await res.text() };
  } catch (e) {
    throw new VaultError(
      ac.signal.aborted ? 504 : 503,
      `${label} ${opts.method || "GET"} ${url.replace(/^.*\/v1\//, "")}: ${ac.signal.reason?.message || e?.cause?.code || e.message}`,
    );
  } finally {
    clearTimeout(t);
  }
}

let active = { addr: null, at: 0 };

export async function activeAddr() {
  if (active.addr && Date.now() - active.at < ACTIVE_TTL_MS) return active.addr;
  for (const addr of VAULT_NODES) {
    try {
      const { text } = await fetchWithTimeout(
        `${addr}/v1/sys/leader`,
        { method: "GET" },
        3_000,
      );
      if (JSON.parse(text)?.is_self) {
        active = { addr, at: Date.now() };
        return addr;
      }
    } catch {
      // try the next node
    }
  }
  active = { addr: null, at: 0 };
  throw new VaultError(503, "no active Vault node among vault-1..3");
}

const nodeName = (addr) =>
  String(addr || "").replace(/^https?:\/\/([^:/]+).*/, "$1");

// call(token | null, METHOD, path, { body, correlationId, timeoutMs })
//   -> { ok, status, json, errors, requestId, node }
// X-Correlation-Id lands in the audit log, so an event joins Vault's record.
export async function call(
  token,
  method,
  path,
  { body, correlationId, timeoutMs = 15_000 } = {},
) {
  const h = {};
  if (correlationId) h["X-Correlation-Id"] = correlationId;
  if (token) h["X-Vault-Token"] = token;
  if (body !== undefined) h["content-type"] = "application/json";
  const addr = await activeAddr();
  let res, text;
  try {
    ({ res, text } = await fetchWithTimeout(
      `${addr}/v1/${path}`,
      {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    ));
  } catch (e) {
    active = { addr: null, at: 0 };
    throw e;
  }
  if (res.status === 503 || res.status === 500) active = { addr: null, at: 0 };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  // Some refusals arrive as data.error, not errors (probe P3).
  const raw = json?.errors?.length ? json.errors : json?.data?.error && !res.ok ? [json.data.error] : [];
  const errors = raw.map((e) =>
    String(e).replace(/\s+/g, " ").trim(),
  );
  return {
    ok: res.ok,
    status: res.status,
    json,
    errors,
    requestId: json?.request_id || null,
    node: nodeName(addr),
  };
}

// Unauthenticated sys/health of one node.
export async function nodeHealth(addr) {
  try {
    const { text } = await fetchWithTimeout(
      `${addr}/v1/sys/health?standbyok=true&perfstandbyok=true&sealedcode=200&uninitcode=200`,
      { method: "GET" },
      4_000,
    );
    const j = JSON.parse(text);
    return {
      node: nodeName(addr),
      reachable: true,
      initialized: Boolean(j.initialized),
      sealed: Boolean(j.sealed),
      standby: Boolean(j.standby),
      performanceStandby: Boolean(j.performance_standby),
      version: j.version || null,
    };
  } catch (e) {
    return {
      node: nodeName(addr),
      reachable: false,
      error: String(e?.message || e),
    };
  }
}
