import './env.js';
import express from 'express';
import webpush from 'web-push';
import { DatabaseSync } from 'node:sqlite';
import { LINES, STATIONS, PLACES, FESTIVALS } from './metro.js';
import { understand, readTimetable, llmName } from './llm.js';

const PORT = process.env.PORT || 3000, TT = process.env.TOMTOM_KEY || '';
const db = new DatabaseSync('commutex.db');
db.exec(`CREATE TABLE IF NOT EXISTS trips(id INTEGER PRIMARY KEY, at TEXT DEFAULT CURRENT_TIMESTAMP, q TEXT, origin TEXT, dest TEXT, deadline_min REAL);
CREATE TABLE IF NOT EXISTS advisories(id INTEGER PRIMARY KEY, line TEXT, delay_min REAL, note TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS geocache(q TEXT PRIMARY KEY, lat REAL, lng REAL, name TEXT);
CREATE TABLE IF NOT EXISTS alarms(id INTEGER PRIMARY KEY, title TEXT, at_ms INTEGER, fire_ms INTEGER, dest TEXT, note TEXT, fired INTEGER DEFAULT 0, dismissed INTEGER DEFAULT 0);`);

db.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS subs(endpoint TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS price_reports(id INTEGER PRIMARY KEY, kind TEXT, ratio REAL, price REAL, at TEXT DEFAULT CURRENT_TIMESTAMP);`);
try { db.exec('ALTER TABLE alarms ADD COLUMN pushed INTEGER DEFAULT 0'); } catch {}
let vk = db.prepare("SELECT v FROM kv WHERE k='vapid'").get()?.v;
if (!vk) { vk = JSON.stringify(webpush.generateVAPIDKeys()); db.prepare("INSERT INTO kv VALUES('vapid',?)").run(vk); }
const VAPID = JSON.parse(vk); webpush.setVapidDetails('mailto:commutex@example.com', VAPID.publicKey, VAPID.privateKey);
const WA = { DMRC: process.env.DMRC_WHATSAPP || '919650855800', NMRC: process.env.NMRC_WHATSAPP || '919599030188' };

const GREY = '#8D9BAF', PURPLE = '#B58CFF';
const hav = (a, b) => { const r = x => x * Math.PI / 180, dA = r(b[0]-a[0]), dO = r(b[1]-a[1]);
  const h = Math.sin(dA/2)**2 + Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dO/2)**2; return 12742 * Math.asin(Math.sqrt(h)); };
const istNow = () => { const p = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }).match(/(\d+):(\d+)/); return +p[1]*60 + +p[2]; };
const clock = m => new Date(Date.now() + m*60000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const peak = () => { const h = istNow()/60; return (h >= 8 && h < 11) || (h >= 17 && h < 21); };
const fare = km => km<=2?11 : km<=5?21 : km<=12?32 : km<=21?43 : km<=32?54 : 64; // DMRC slabs: verify against current fares

// ---------- metro graph (node = station|line, transfers cost 5 min) ----------
const adj = {}, byStation = {};
const link = (a, b, w, km, line, type) => (adj[a] ??= []).push({ to: b, w, km, line, type });
for (const [line, { stops }] of Object.entries(LINES)) stops.forEach((s, i) => { if (!i) return;
  const p = stops[i-1], km = hav(STATIONS[p], STATIONS[s]) * 1.15, w = km * 1.75 + 0.8;
  link(`${p}|${line}`, `${s}|${line}`, w, km, line, 'ride'); link(`${s}|${line}`, `${p}|${line}`, w, km, line, 'ride'); });
Object.keys(adj).forEach(k => (byStation[k.split('|')[0]] ??= []).push(k));

for (const ks of Object.values(byStation)) for (const a of ks) for (const b of ks) if (a !== b) link(a, b, 5, 0, null, 'xfer');

// Manually link the Blue/Aqua walkway
if (adj['Noida Sector 52|Blue'] && adj['Noida Sector 51|Aqua']) {
  link('Noida Sector 52|Blue', 'Noida Sector 51|Aqua', 8, 0.3, null, 'xfer');
  link('Noida Sector 51|Aqua', 'Noida Sector 52|Blue', 8, 0.3, null, 'xfer');
}

function metro(from, to, mode) {
  const cost = e => mode === 'cheap' ? e.km + (e.type === 'xfer' ? 0.8 : 0) : e.w;
  const dist = {}, prev = {}, q = new Set(); let end = null;
  byStation[from].forEach(k => { dist[k] = 0; q.add(k); });
  while (q.size) { let u = null; for (const k of q) if (u === null || dist[k] < dist[u]) u = k; q.delete(u);
    if (u.startsWith(to + '|')) { end = u; break; }
    for (const e of adj[u]) { const nd = dist[u] + cost(e); if (nd < (dist[e.to] ?? 1e9)) { dist[e.to] = nd; prev[e.to] = { u, e }; q.add(e.to); } } }
  if (!end) return null;
  const path = []; for (let k = end; prev[k]; k = prev[k].u) path.unshift(prev[k]);
  const legs = [];
  for (const { u, e } of path) { const a = u.split('|')[0], b = e.to.split('|')[0];
    if (e.type === 'xfer') { legs.push({ kind: 'xfer', at: a, mins: 5, km: 0 }); continue; }
    const L = legs[legs.length-1];
    if (L && L.kind === 'ride' && L.line === e.line) { L.to = b; L.mins += e.w; L.km += e.km; L.geom.push(STATIONS[b]); }
    else legs.push({ kind: 'ride', line: e.line, from: a, to: b, mins: e.w, km: e.km, geom: [STATIONS[a], STATIONS[b]] }); }
  return { legs, mins: legs.reduce((a, l) => a + l.mins, 0), km: legs.reduce((a, l) => a + l.km, 0) };
}

// ---------- roads & live traffic (TomTom if key is set, otherwise time-of-day estimate) ----------
async function road(a, b) {
  const km = hav(a, b) * 1.3, free = km / 35 * 60;
  if (TT) try {
    const j = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${a[0]},${a[1]}:${b[0]},${b[1]}/json?traffic=true&key=${TT}`).then(r => r.json());
    const r = j.routes[0], s = r.summary, pts = r.legs[0].points, step = Math.ceil(pts.length / 150);
    return { km: s.lengthInMeters/1000, mins: s.travelTimeInSeconds/60, delay: s.trafficDelayInSeconds/60, live: true,
      geom: pts.filter((_, i) => i % step === 0).map(p => [p.latitude, p.longitude]) };
  } catch {}
  const h = istNow()/60, f = peak() ? (h < 12 ? 1.7 : 1.9) : (h >= 23 || h < 6) ? 1 : 1.15;
  return { km, mins: free*f, delay: free*(f-1), geom: [a, b], live: false };
}
// ---------- price model: estimates, calibrated by "I paid" reports ----------
const RATES = { erick: [10, 8, .3], auto: [25, 11, .8], bike: [20, 7, .7], cab: [45, 13, 1.5] }; // base, per km, per min (rough; tune with real reports)
const NAMES = { erick: 'e-rickshaw', auto: 'auto', bike: 'bike taxi', cab: 'cab' };
let cx = null;
async function context() {
  if (cx && Date.now() - cx.t < 6e5) return cx.v;
  const v = { rain: false, temp: null, aqi: null, festival: null }, j = async u => (await fetch(u, { signal: AbortSignal.timeout(4000) })).json();
  try { const w = (await j('https://api.open-meteo.com/v1/forecast?latitude=28.6&longitude=77.2&current=temperature_2m,precipitation')).current; v.temp = Math.round(w.temperature_2m); v.rain = w.precipitation > 0.2; } catch {}
  try { v.aqi = (await j('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=28.6&longitude=77.2&current=us_aqi')).current.us_aqi; } catch {}
  v.festival = FESTIVALS.find(f => f.date === istDate().toISOString().slice(0, 10)) || null;
  cx = { t: Date.now(), v }; return v;
}
const calib = kind => { const r = db.prepare('SELECT ratio FROM price_reports WHERE kind=? ORDER BY id DESC LIMIT 30').all(kind).map(x => x.ratio).sort((a, b) => a - b); return r.length >= 3 ? Math.min(1.8, Math.max(.6, r[r.length >> 1])) : 1; };
function priceOf(kind, r, c, cal = calib(kind)) {
  const [b, k, m] = RATES[kind], free = r.mins - r.delay, why = [], h = istNow() / 60, dow = istDate().getUTCDay(); let mult = 1;
  if (peak()) { mult += .25; why.push('peak hours'); }
  if (h >= 22 || h < 5) { mult += .25 + (dow === 5 || dow === 6 ? .1 : 0); why.push('late night'); }
  if (c.rain) { mult += .3; why.push('rain'); }
  if (c.festival) { mult += c.festival.surge; why.push(c.festival.name); }
  if (r.delay >= 3) { mult += Math.min(.3, r.delay / Math.max(1, r.mins)); why.push('traffic'); }
  const mid = Math.round((b + k*r.km + m*free) * Math.min(2, mult) * cal / 5) * 5;
  return { mid, lo: Math.round(mid * .88 / 5) * 5, hi: Math.round(mid * 1.15 / 5) * 5, why };
}
async function access(a, b, toName) {
  const r = await road(a, b), c = await context();
  if (r.km < 1) return { kind: 'walk', title: `Walk to ${toName}`, mins: Math.max(1, Math.round(r.km*13)), delay: 0, cost: 0, color: GREY, geom: [a, b] };
  const mode = r.km < 4 ? 'auto' : 'cab', p = priceOf(mode, r, c);
  const alts = ['erick', 'auto', 'bike', 'cab'].filter(k => k !== mode && !(k === 'erick' && r.km > 4)).map(k => { const q = priceOf(k, r, c); return `${NAMES[k]} \u20B9${q.lo}\u2013${q.hi}`; }).join(' \u00B7 ');
  return { kind: 'cab', mode, km: r.km, rawmins: r.mins, title: `${mode === 'auto' ? 'Auto' : 'Cab'} to ${toName}`, mins: Math.round(r.mins), delay: r.delay, cost: p.mid, lo: p.lo, hi: p.hi, why: p.why, alts, color: PURPLE, geom: r.geom, live: r.live };
}
const uberLink = (p, d, name) => `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${p[0]}&pickup[longitude]=${p[1]}&dropoff[latitude]=${d[0]}&dropoff[longitude]=${d[1]}&dropoff[nickname]=${encodeURIComponent(name)}${process.env.UBER_CLIENT_ID ? '&client_id=' + process.env.UBER_CLIENT_ID : ''}`;

// ---------- planner ----------
async function plan(A, B, dl, prefer) {
  const adv = {}; for (const r of db.prepare('SELECT line, SUM(delay_min) d, MAX(note) note FROM advisories WHERE active=1 GROUP BY line').all()) adv[r.line] = r;
  const near = ll => Object.keys(STATIONS).map(n => [n, hav(ll, STATIONS[n])]).sort((x, y) => x[1] - y[1]).slice(0, 3);
  const pick = {};
  for (const mode of ['cheap', 'fast']) { let best = null;
    for (const [s1, d1] of near(A.ll)) for (const [s2, d2] of near(B.ll)) { if (s1 === s2) continue; const m = metro(s1, s2, mode); if (!m) continue;
      const score = mode === 'cheap' ? fare(m.km) + 11*(d1+d2) : m.mins + 3*(d1+d2);
      if (!best || score < best.score) best = { s1, s2, m, score }; }
    pick[mode] = best; }
  const out = [], seen = new Set();
  for (const [mode, label] of [['cheap', 'Metro, cheapest'], ['fast', 'Metro, fastest']]) {
    const p = pick[mode]; if (!p) continue; const sig = p.s1 + p.s2 + p.m.legs.map(l => l.line || 'x').join(); if (seen.has(sig)) { out[0].label = 'Metro, cheapest and fastest'; continue; } seen.add(sig);
    const a = await access(A.ll, STATIONS[p.s1], p.s1), z = await access(STATIONS[p.s2], B.ll, B.name);
    let first = true;
    const mid = p.m.legs.map(l => { if (l.kind === 'xfer') return { kind: 'xfer', title: `Change trains at ${l.at}`, mins: 5, delay: 0, cost: 0, color: '#ECEAE3', geom: [] };
      const d = adv[l.line]?.d || 0, c = first ? fare(p.m.km) : 0; first = false;
      return { kind: 'metro', title: `${l.line} Line: ${l.from} to ${l.to}`, mins: Math.round(l.mins + d), delay: d, cost: c, color: LINES[l.line].color, geom: l.geom, note: adv[l.line]?.note }; });
    const legs = [a, { kind: 'wait', title: `Wait for train at ${p.s1}`, mins: peak() ? 3 : 6, delay: 0, cost: 0, color: GREY, geom: [] }, ...mid, z];
    out.push({ label, legs, board: { name: p.s1, ll: STATIONS[p.s1] }, alight: { name: p.s2, ll: STATIONS[p.s2] }, uber: uberLink(STATIONS[p.s2], B.ll, B.name),
      tickets: [{ network: 'DMRC', from: p.s1, to: p.s2, fare: fare(p.m.km), wa: WA.DMRC }], nmrc: B.ll[0] > 28.45 && B.ll[1] > 77.3 ? WA.NMRC : null });
  }
  const r = await road(A.ll, B.ll), cxv = await context();
  for (const [mode, label, f] of [['cab', 'Uber, door to door', 1], ['bike', 'Bike taxi, door to door', .85]]) {
    if (mode === 'bike' && r.km > 30) continue;
    const rr = { ...r, mins: r.mins * f, delay: r.delay * f }, p = priceOf(mode, rr, cxv);
    out.push({ label, legs: [{ kind: 'cab', mode, km: r.km, rawmins: rr.mins, title: `${mode === 'bike' ? 'Bike taxi' : 'Uber'} to ${B.name}`, mins: Math.round(rr.mins), delay: rr.delay, cost: p.mid, lo: p.lo, hi: p.hi, why: p.why, color: PURPLE, geom: r.geom, live: r.live }],
      board: { name: A.name, ll: A.ll }, alight: { name: B.name, ll: B.ll }, uber: uberLink(A.ll, B.ll, B.name) });
  }
  for (const o of out) { o.mins = o.legs.reduce((s, l) => s + l.mins, 0); o.cost = o.legs.reduce((s, l) => s + l.cost, 0); o.lo = o.legs.reduce((s, l) => s + (l.lo ?? l.cost), 0); o.hi = o.legs.reduce((s, l) => s + (l.hi ?? l.cost), 0); o.why = [...new Set(o.legs.flatMap(l => l.why || []))]; o.from = A.name; o.to = B.name; o.delay = o.legs.reduce((s, l) => s + l.delay, 0);
    o.live = o.legs.some(l => l.live); o.arrive = clock(o.mins); o.late = dl != null ? Math.max(0, Math.round(o.mins - dl)) : 0; o.slack = dl != null && !o.late ? Math.round(dl - o.mins) : null; }
  const ok = out.filter(o => !o.late), pool = ok.length ? ok : out, by = (prefer === 'fast' || !ok.length) ? 'mins' : 'cost', best = out.indexOf([...pool].sort((x, y) => x[by] - y[by])[0]);
  return { out, best, ontime: ok.length };
}

// ---------- chat parsing & geocoding ----------
function parse(t, ctx) {
  const m = t.match(/from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:but|and|by|before|reach|arrive)\b|[.,]|$)/i) || t.match(/^(.+?)\s+to\s+(.+?)(?:\s+(?:but|by|before)\b|[.,]|$)/i);
  const tm = t.match(/(?:by|before|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let dl = null, dlText = null;
  if (tm) { let h = +tm[1], mi = +(tm[2] || 0), now = istNow(); const mer = tm[3]?.toLowerCase();
    if (mer === 'pm' && h < 12) h += 12; if (mer === 'am' && h === 12) h = 0;
    let target = h*60 + mi; if (!mer && h < 12 && target <= now) target += 720; while (target <= now) target += 1440;
    dl = target - now; dlText = tm[0].replace(/^(by|before|at)\s+/i, ''); }
  if (m) return { from: m[1].trim(), to: m[2].trim(), dl, dlText };
  const only = t.match(/\bto\s+(.+?)(?:\s+(?:but|by|before)\b|[.,]|$)/i);
  if (only) return { from: 'my location', to: only[1].trim(), dl, dlText };
  if (ctx?.from && dl != null) return { from: ctx.from, to: ctx.to, dl, dlText };
  return null;
}
async function geocode(q, me) {
  const k = q.toLowerCase().trim();
  if (/^(my location|here|current location|me)$/.test(k)) return me ? { name: 'Your location', ll: me } : null;
  for (const [n, v] of Object.entries(PLACES)) if (k.includes(n)) return v;
  const c = db.prepare('SELECT * FROM geocache WHERE q=?').get(k); if (c) return { name: c.name, ll: [c.lat, c.lng] };
  try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&viewbox=76.8,29.0,77.7,28.2&bounded=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'chalo-ncr-demo' } }).then(r => r.json());
    if (r[0]) { const v = { name: r[0].display_name.split(',').slice(0, 2).join(','), ll: [+r[0].lat, +r[0].lon] }; db.prepare('INSERT OR REPLACE INTO geocache VALUES(?,?,?,?)').run(k, v.ll[0], v.ll[1], v.name); return v; } } catch {}
  return null;
}

// ---------- alarms ----------
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const istDate = () => new Date(Date.now() + 19800000);
const istEpoch = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 19800000;
const stamp = () => `${DAYS[istDate().getUTCDay()]} ${istDate().toISOString().slice(0, 10)} ${clock(0)} IST`;
const when = ms => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
function parseAlarm(t) {
  const tm = t.match(/(?:\b(?:at|by|before)\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || t.match(/(?:\b(?:at|by|before)\s+)?\b(\d{1,2}):(\d{2})()\b/);
  if (!tm) return { error: 'What time should I set it for? For example: \u201Calarm for my 9am class tomorrow\u201D.' };
  let h = +tm[1], mi = +(tm[2] || 0); const mer = (tm[3] || '').toLowerCase();
  if (mer === 'pm' && h < 12) h += 12; if (mer === 'am' && h === 12) h = 0;
  const n = istDate(), wd = DAYS.findIndex(w => new RegExp('\\b' + w + '\\b', 'i').test(t));
  let day = /\b(tomorrow|kal)\b/i.test(t) ? 1 : 0; if (wd >= 0) day = (wd - n.getUTCDay() + 7) % 7;
  let at = istEpoch(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate() + day, h, mi);
  if (at <= Date.now()) at += (wd >= 0 ? 7 : 1) * 86400000;
  let rest = t.replace(tm[0], ' ').replace(/\b(tomorrow|today|kal)\b/ig, ' ').replace(new RegExp('\\b(on\\s+)?(' + DAYS.join('|') + ')\\b', 'ig'), ' ');
  const lm = rest.match(/(\d+)\s*(?:min|mins|minutes)\s*before/i); rest = rest.replace(/(\d+)\s*(?:min|mins|minutes)\s*before/i, ' ');
  const dm = rest.match(/\b(?:at|in|to|near)\s+([^,.]+?)\s*$/i);
  let title = (dm ? rest.slice(0, dm.index) : rest).replace(/\b(set|add|create|make)\b|\b(alarm|reminder)\b|\b(remind me|wake me)( up)?\b|\b(for|about|to)\b/ig, ' ').replace(/\s+/g, ' ').trim().replace(/^((my|the|a|an)\s+)+/i, '');
  title = title ? title[0].toUpperCase() + title.slice(1) : 'Event';
  return { title, at, dest: dm ? dm[1].trim() : null, lead: lm ? +lm[1] : null };
}
async function makeAlarm({ title, at, dest, lead, me }, cache = {}) {
  let leadMin = lead ?? 15, note = lead != null ? `${lead} min before the event` : '';
  if (lead == null && dest && cache[dest]) ({ leadMin, note } = cache[dest]);
  else if (lead == null && dest) {
    const B = await geocode(dest, me);
    if (B && me) { const { out, best } = await plan({ name: 'You', ll: me }, B, null, 'fast'), r = out[best]; leadMin = r.mins + 10; note = `Leave-by includes ${r.mins} min via ${r.label.toLowerCase()} + 10 min buffer`; }
    else note = B ? 'Allow location access to include travel time' : `Couldn\u2019t find \u201C${dest}\u201D on the map`;
  }
  if (lead == null && dest) cache[dest] = { leadMin, note };
  const fire = at - Math.round(leadMin) * 60000;
  const id = Number(db.prepare('INSERT INTO alarms(title,at_ms,fire_ms,dest,note) VALUES(?,?,?,?,?)').run(title, at, fire, dest || null, note).lastInsertRowid);
  return { id, title, at_ms: at, fire_ms: fire, dest, note };
}

// ---------- API ----------
const app = express(); app.use(express.json({ limit: '12mb' })); app.use(express.static('public'));
app.post('/api/chat', async (req, res) => {
  const { text = '', me, ctx } = req.body;
  const cxv = await context(), live = `${cxv.rain ? 'raining' : 'dry'}, ${cxv.temp ?? '?'}C, AQI ${cxv.aqi ?? '?'}, ${cxv.festival ? cxv.festival.name + ' today' : 'no festival today'}, ${peak() ? 'peak traffic hours' : 'off-peak'}`;
  const L = await understand(text, ctx, stamp(), live);
  const wantsAlarm = L?.intent === 'alarm' || (L?.intent !== 'route' && L?.intent !== 'chat' && /\b(alarm|remind|reminder|wake me)\b/i.test(text));
  if (wantsAlarm) {
    let a = null, m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(L?.event_time || '');
    if (m) a = { title: L.title || 'Event', at: istEpoch(+m[1], +m[2], +m[3], +m[4], +m[5]), dest: L.dest || null, lead: L.lead_min ?? null };
    a ??= parseAlarm(text);
    if (a.error) return res.json({ reply: [a.error], ctx });
    const r = await makeAlarm({ ...a, me });
    return res.json({ reply: [`Alarm set for \u201C${r.title}\u201D on ${when(r.at_ms)}.`, `It will ring at ${when(r.fire_ms)}${r.note ? ` (${r.note})` : ''}. Open the Alarms panel once and allow notifications so it can also ring when this tab is closed.`], alarm: r, ctx });
  }
  if (L?.intent === 'chat' && L.reply) return res.json({ reply: [L.reply], ctx });
  if (L?.reply && L.intent !== 'route' && L.intent !== 'alarm') return res.json({ reply: [L.reply], ctx });
  let p = null;
  if (L?.intent === 'route' && (L.to || ctx?.to)) {
    const hm = /^(\d{1,2}):(\d{2})$/.exec(L.deadline || ''), now = istNow();
    let dl = null, dlText = null; if (hm) { let t = +hm[1]*60 + +hm[2]; while (t <= now) t += 1440; dl = t - now; dlText = new Date(2000, 0, 1, +hm[1], +hm[2]).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }); }
    p = { from: L.from || ctx?.from || 'my location', to: L.to || ctx?.to, dl, dlText, prefer: /fast/i.test(L.prefer || '') ? 'fast' : null };
  }
  p ??= parse(text, ctx);
  if (!p) return res.json({ reply: ['Tell me where you\u2019re headed, like \u201cfrom Gurugram Worldmark to Amity University Noida\u201d. Add \u201cby 6pm\u201d if you have a deadline.'] });
  const A = await geocode(p.from, me), B = await geocode(p.to, me);
  if (!A || !B) return res.json({ reply: [!A && p.from === 'my location' ? 'Allow location access so I can start from where you are.' : `I couldn\u2019t find \u201c${!A ? p.from : p.to}\u201d in NCR. Try a landmark or sector name.`], ctx });
  const { out, best, ontime } = await plan(A, B, p.dl, p.prefer), rec = out[best];
  db.prepare('INSERT INTO trips(q,origin,dest,deadline_min) VALUES(?,?,?,?)').run(text, A.name, B.name, p.dl);
  const reply = [];
  if (p.dl != null) reply.push(ontime ? `${ontime} of ${out.length} routes make your ${p.dlText} deadline. ${p.prefer === 'fast' ? 'Fastest' : 'Cheapest'} that does: ${rec.label}, \u20B9${rec.cost}, arriving ${rec.arrive}.`
    : `No route makes ${p.dlText} right now. Fastest is ${rec.label} at ${rec.mins} min, which lands ${rec.late} min late.`);
  else reply.push(`${p.prefer === 'fast' ? 'Fastest' : 'Cheapest'} way: ${rec.label}, about \u20B9${rec.cost} and ${rec.mins} min, arriving ${rec.arrive}.`);
  const road = rec.legs.filter(l => l.kind === 'cab' || l.kind === 'walk'), rd = road.reduce((s, l) => s + l.delay, 0);
  reply.push(rd >= 1 ? `Traffic: expect about +${Math.round(rd)} min on the road legs${rec.live ? ' (live data)' : ' (estimated from time of day; add a TOMTOM_KEY for live data)'}.` : 'Traffic: roads look clear on your legs.');
  reply.push(rec.why.length ? `Prices are estimates (about \u00B115%) and include ${rec.why.join(', ')}.` : 'Prices are estimates (about \u00B115%); no surge factors right now.');
  for (const l of rec.legs) if (l.note) reply.push(`Metro advisory on the ${l.title.split(' ')[0]} Line: ${l.note}`);
  if (p.dl != null) { const lb = p.dl - rec.mins; reply.push(lb > 0 ? `To arrive by ${p.dlText}, leave by ${clock(lb)}.` : 'To arrive by then you would have needed to leave already.'); }
  res.json({ reply, options: out, best, ctx: { from: p.from, to: p.to } });
});
app.get('/api/health', (_, res) => res.json({ ai: llmName, traffic: TT ? 'live' : 'estimated' }));
app.get('/api/alarms', (_, res) => res.json(db.prepare('SELECT * FROM alarms WHERE dismissed=0 ORDER BY fire_ms').all()));
app.post('/api/alarms', async (req, res) => { const a = req.body; if (!a.at_ms) return res.status(400).json({ error: 'at_ms required' });
  res.json(await makeAlarm({ title: a.title || 'Event', at: +a.at_ms, dest: a.dest || null, lead: a.lead_min == null ? null : +a.lead_min, me: a.me })); });
app.post('/api/alarms/:id/fired', (req, res) => { db.prepare('UPDATE alarms SET fired=1 WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
app.post('/api/alarms/:id/snooze', (req, res) => { db.prepare('UPDATE alarms SET fired=0, pushed=0, fire_ms=? WHERE id=?').run(Date.now() + (+req.body.min || 5) * 60000, +req.params.id); res.json({ ok: true }); });
app.delete('/api/alarms/:id', (req, res) => { db.prepare('UPDATE alarms SET dismissed=1 WHERE id=?').run(+req.params.id); res.json({ ok: true }); });
// ---------- context, price feedback, timetable photo, web push ----------
app.get('/api/context', async (_, res) => res.json({ ...(await context()), peak: peak() }));
app.post('/api/price-report', async (req, res) => { const { kind, km, mins, delay = 0, price } = req.body;
  if (!RATES[kind] || !(price > 0)) return res.status(400).json({ error: 'bad report' });
  const p = priceOf(kind, { km, mins, delay }, await context(), 1);
  db.prepare('INSERT INTO price_reports(kind,ratio,price) VALUES(?,?,?)').run(kind, price / Math.max(5, p.mid), price); res.json({ ok: true, factor: calib(kind) }); });
app.post('/api/timetable', async (req, res) => {
  const { image, mime = 'image/jpeg', venue, me } = req.body; if (!image) return res.status(400).json({ error: 'No image received' });
  let t; try { t = await readTimetable(image, mime); } catch (e) { return res.json({ error: 'Couldn\u2019t read the image: ' + e.message }); }
  const n = istDate(), cache = {}, made = [];
  for (const e of (t.events || []).slice(0, 25)) {
    const wd = DAYS.indexOf(String(e.day).toLowerCase()), m = /^(\d{1,2}):(\d{2})/.exec(e.time || ''); if (wd < 0 || !m) continue;
    let at = istEpoch(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate() + ((wd - n.getUTCDay() + 7) % 7), +m[1], +m[2]); if (at <= Date.now()) at += 7 * 864e5;
    made.push(await makeAlarm({ title: e.title || 'Class', at, dest: e.place || venue || null, lead: null, me }, cache));
  }
  res.json({ count: made.length, alarms: made });
});
app.get('/api/push/key', (_, res) => res.json({ key: VAPID.publicKey }));
app.post('/api/push/subscribe', (req, res) => { db.prepare('INSERT OR REPLACE INTO subs VALUES(?,?)').run(req.body.endpoint, JSON.stringify(req.body)); res.json({ ok: true }); });
setInterval(async () => { // background alarms: push to every subscribed device even when the tab is closed
  for (const a of db.prepare('SELECT * FROM alarms WHERE fired=0 AND dismissed=0 AND pushed=0 AND fire_ms<=?').all(Date.now())) {
    db.prepare('UPDATE alarms SET pushed=1 WHERE id=?').run(a.id);
    for (const s of db.prepare('SELECT * FROM subs').all()) try { await webpush.sendNotification(JSON.parse(s.json), JSON.stringify({ title: a.title, body: `${a.dest ? 'Time to leave for ' + a.dest + '. ' : ''}Event at ${when(a.at_ms)}` })); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM subs WHERE endpoint=?').run(s.endpoint); }
  } }, 20000);
app.get('/api/advisories', (_, res) => res.json(db.prepare('SELECT * FROM advisories').all()));
app.post('/api/advisory', (req, res) => { const { line, delay_min = 10, note = 'Delays reported' } = req.body;
  res.json({ id: db.prepare('INSERT INTO advisories(line,delay_min,note) VALUES(?,?,?)').run(line, delay_min, note).lastInsertRowid.toString() }); });
app.delete('/api/advisories', (_, res) => { db.prepare('UPDATE advisories SET active=0').run(); res.json({ ok: true }); });
if (!llmName) { console.error('\n  CommuteX needs an AI key. Copy .env.example to .env and set GEMINI_API_KEY (free at https://aistudio.google.com/apikey) or OPENAI_API_KEY.\n'); process.exit(1); }
app.listen(PORT, '0.0.0.0', () => console.log(`CommuteX running on http://localhost:${PORT}  (traffic: ${TT ? 'live TomTom' : 'estimated'}, chatbot: ${llmName || 'built-in parser'})`));