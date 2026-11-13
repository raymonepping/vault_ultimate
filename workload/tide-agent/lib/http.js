// lib/http.js: fetch with a referenced timer and an AbortController
// (AbortSignal.timeout alone has been seen never to fire in Node).
export async function call(url, init = {}, ms = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
