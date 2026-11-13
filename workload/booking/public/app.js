// The booking page: plain on purpose (the customer's application, not the
// lab's console). textContent everywhere: support notes are user input.
const $ = (s) => document.querySelector(s);
const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text ?? '' });
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}
let me = { user: null };
async function load() {
  me = await api('/api/me');
  const who = $('#who');
  who.replaceChildren();
  if (me.user) {
    who.append(el('span', `Signed in as ${me.user}. `));
    const out = el('button', 'Sign out');
    out.type = 'button';
    out.onclick = async () => { await fetch('/auth/logout', { method: 'POST' }); load(); };
    who.append(out);
  } else {
    const a = el('a', 'Staff sign in');
    a.href = '/auth/login';
    who.append(a);
  }
  const { crossings } = await api('/api/crossings');
  const tb = $('#crossings tbody');
  tb.replaceChildren(...crossings.map((c) => {
    const tr = document.createElement('tr');
    tr.dataset.crossing = c.id;
    for (const v of [`Day ${c.day}`, c.departs, `${c.from_port} to ${c.to_port}`, `${c.booked} / ${c.seats}`, c.status]) tr.append(el('td', v));
    return tr;
  }));
  for (const sel of ['#book-crossing', '#staff-crossing']) {
    $(sel).replaceChildren(...crossings.map((c) => Object.assign(el('option', `Day ${c.day} ${c.departs} (${c.status})`), { value: c.id })));
  }
  const staff = (me.groups || []).includes('bookings');
  $('#staff').hidden = !staff;
  if (staff) loadNotes();
}
async function loadNotes() {
  const { notes } = await api('/api/notes');
  $('#notes').replaceChildren(...notes.map((n) => el('li', `${n.author}, ${new Date(n.created_at).toLocaleString()}: ${n.body}`)));
}
$('#book').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/bookings', { method: 'POST', body: JSON.stringify({ crossing: $('#book-crossing').value, name: $('#book-name').value }) });
    $('#book-result').textContent = `Booked: booking ${r.booking}.`;
    load();
  } catch (err) { $('#book-result').textContent = err.message; }
};
$('#manifest-show').onclick = async () => {
  try {
    const { bookings } = await api(`/api/crossings/${$('#staff-crossing').value}/manifest`);
    const tb = $('#manifest tbody');
    tb.replaceChildren(...bookings.map((b) => { const tr = document.createElement('tr'); for (const v of [b.id, b.name, b.vehicle_plate || '', b.status]) tr.append(el('td', String(v))); return tr; }));
    $('#manifest').hidden = false;
  } catch (err) { $('#staff-result').textContent = err.message; }
};
$('#crossing-cancel').onclick = async () => {
  try {
    const r = await api(`/api/crossings/${$('#staff-crossing').value}/cancel`, { method: 'POST' });
    $('#staff-result').textContent = r.cancelled ? 'Crossing cancelled.' : 'That crossing was already cancelled.';
    load();
  } catch (err) { $('#staff-result').textContent = err.message; }
};
$('#note').onsubmit = async (e) => {
  e.preventDefault();
  try { await api('/api/notes', { method: 'POST', body: JSON.stringify({ body: $('#note-body').value }) }); $('#note-body').value = ''; loadNotes(); }
  catch (err) { $('#staff-result').textContent = err.message; }
};
load().catch((err) => { $('#who').textContent = err.message; });
