// lib/redact.js (copied from runner/lib, from vault_lab_index): text goes to
// the browser or a log line only after this
// A redactor is stateful so a PEM private key block is dropped whole.
const RULES = [
  [/\bhv[sbr]\.[A-Za-z0-9_-]{20,}/g, (m) => `${m.slice(0, 4)}[redacted]`],
  [/\bs\.[A-Za-z0-9]{24}\b/g, 's.[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted jwt]'],
  [/\b(unseal key \d+|recovery key \d+|initial root token)(\s*:\s*)\S+/gi, '$1$2[redacted]'],
  [/\b([A-Za-z_-]*(?:password|passwd|secret|token|license|licence|api_?key|private_?key)[A-Za-z_-]*)("?\s*[:=]\s*)("?)[^\s"',]+/gi, '$1$2$3[redacted]'],
  [/\b[a-f0-9]{32,}\b/gi, '[redacted hex]'],
  // Long base64 or base32 with mixed case and digits: licences, keys, secret_ids.
  [/[A-Za-z0-9+/]{40,}={0,2}/g, (m) => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m) ? '[redacted]' : m)],
];

export function createRedactor() {
  let inKey = false;
  return (line) => {
    if (inKey) {
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(line)) inKey = false;
      return null;
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) {
      inKey = !/-----END [A-Z ]*PRIVATE KEY-----/.test(line);
      return '[redacted private key]';
    }
    return RULES.reduce((s, [re, to]) => s.replace(re, to), line);
  };
}
