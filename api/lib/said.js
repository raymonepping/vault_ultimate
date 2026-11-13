// lib/said.js: "Vault said", the drawer behind every step. Exactly what Vault
// answered (status, errors verbatim, request id, node), minus anything secret:
// a field that is a token, password or secret id is dropped wherever it sits.
// A field named value is dropped too: no step reads one, and none may leak.

const SECRET_KEY = /^(token|client_token|password|secret_id|private_key|access_key_id|secret_access_key|value)$/;

export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) out[k] = scrub(x);
    return out;
  }
  return v;
}

// said(as, method, path, result): the block every step carries.
export function said(as, method, path, r) {
  return {
    method,
    path,
    status: r?.status ?? null,
    as,
    node: r?.node ?? null,
    errors: r?.errors ?? [],
    request_id: r?.requestId ?? null,
    data: r?.json?.data ? scrub(r.json.data) : null,
  };
}
