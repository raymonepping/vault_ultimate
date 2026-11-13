// lib/der.js: just enough DER/BER for the witness's two binary protocols, an
// OCSP request and an LDAP simple bind (no dependency, D18).
//
//   read(buf, off)        one TLV: {tag, header, start, end}
//   children(buf, node)   the TLVs inside a constructed node
//   tlv(tag, ...parts)    encode one TLV (definite length)
//   ocspRequest(leaf, issuerSpki)   a nonce-free OCSPRequest for one certificate
//   ocspStatus(response)  {status: good|revoked|unknown|error, revoked_at?}
//   ldapBind(dn, pw)      LDAPMessage 1, BindRequest v3, simple
//   ldapBindResult(buf)   {code, diagnostic} or null while incomplete
import { createHash } from 'node:crypto';

export function read(buf, off = 0) {
  if (off + 2 > buf.length) throw new Error('DER: truncated');
  const tag = buf[off];
  let len = buf[off + 1];
  let p = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: unsupported length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
  }
  if (p + len > buf.length) throw new Error('DER: truncated');
  return { tag, header: off, start: p, end: p + len };
}

export function children(buf, node) {
  const out = [];
  for (let p = node.start; p < node.end; ) {
    const c = read(buf, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

export function tlv(tag, ...parts) {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : null;
  if (!len) throw new Error('DER: value too long');
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
}

const sha1 = (b) => createHash('sha1').update(b).digest();
const SHA1_ALG = Buffer.from('300906052b0e03021a0500', 'hex');

// leafDer: the certificate; issuerSpkiDer: the issuer's SubjectPublicKeyInfo
// (X509Certificate.publicKey.export({type: 'spki', format: 'der'})).
export function ocspRequest(leafDer, issuerSpkiDer) {
  const f = children(leafDer, children(leafDer, read(leafDer))[0]);
  const i = f[0].tag === 0xa0 ? 1 : 0; // [0] version is optional
  const serial = leafDer.subarray(f[i].header, f[i].end);
  const issuerName = leafDer.subarray(f[i + 2].header, f[i + 2].end);
  const bits = children(issuerSpkiDer, read(issuerSpkiDer))[1];
  const key = issuerSpkiDer.subarray(bits.start + 1, bits.end); // skip the unused-bits byte
  const certId = tlv(0x30, SHA1_ALG, tlv(0x04, sha1(issuerName)), tlv(0x04, sha1(key)), serial);
  return tlv(0x30, tlv(0x30, tlv(0x30, tlv(0x30, certId))));
}

const STATUS = ['successful', 'malformedRequest', 'internalError', 'tryLater', 'unused', 'sigRequired', 'unauthorized'];

// shortcut: the response's signature is not verified (the witness asks Vault
// over verified TLS); verify it if the answer ever travels another way.
export function ocspStatus(resp) {
  const [st, rb] = children(resp, read(resp));
  const code = resp[st.start];
  if (code !== 0 || !rb) return { status: 'error', response_status: STATUS[code] ?? String(code) };
  const [, oct] = children(resp, children(resp, rb)[0]);
  const basic = resp.subarray(oct.start, oct.end);
  const kids = children(basic, children(basic, read(basic))[0]);
  const at = kids.findIndex((k) => k.tag === 0x18); // producedAt; responses follow it
  const single = children(basic, kids[at + 1])[0];
  const cs = children(basic, single)[1];
  if (cs.tag === 0x80) return { status: 'good' };
  if (cs.tag === 0xa1) {
    const t = children(basic, cs)[0];
    return { status: 'revoked', revoked_at: generalizedTime(basic.subarray(t.start, t.end).toString('latin1')) };
  }
  return { status: 'unknown' };
}

function generalizedTime(s) {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : s;
}

export function ldapBind(dn, password) {
  const req = tlv(0x60, tlv(0x02, Buffer.from([3])), tlv(0x04, Buffer.from(dn)), tlv(0x80, Buffer.from(password)));
  return tlv(0x30, tlv(0x02, Buffer.from([1])), req);
}

export function ldapBindResult(buf) {
  let msg;
  try {
    msg = read(buf);
  } catch {
    return null; // not all of it yet
  }
  const [, op] = children(buf, msg);
  if (!op || op.tag !== 0x61) throw new Error(`LDAP: unexpected response tag 0x${op?.tag.toString(16)}`);
  const [code, , diag] = children(buf, op);
  return { code: buf[code.start], diagnostic: buf.subarray(diag.start, diag.end).toString() };
}
