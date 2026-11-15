import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// ---------- Hilfen ----------

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
const MONTHS = ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const KIND = { bring: 'Bringen', pick: 'Abholen' };
const MIN_OFF = -2;
const MAX_OFF = 10;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const short = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;
const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  return addDays(x, -wd);
}
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / 86400000 + 1) / 7);
}
// Am Wochenende zeigt NiKo schon die kommende Woche.
function baseMonday() {
  const now = new Date();
  const wd = (now.getDay() + 6) % 7;
  return wd >= 5 ? addDays(mondayOf(now), 7) : mondayOf(now);
}
const join = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

// ---------- Figur und Icons ----------

const figure = (size, mood = 'calm') => `
<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 64 64">
<path d="M24 15c0-7 16-7 16 0" fill="none" stroke="#26243B" stroke-width="3" stroke-linecap="round"/>
<rect x="12" y="14" width="40" height="42" rx="16" fill="#F7D560"/>
<path d="M12 30c0-9 7-16 16-16h8c9 0 16 7 16 16v2H12z" fill="#EDBE2E"/>
<rect x="29" y="27" width="6" height="7" rx="2" fill="#26243B"/>
${mood === 'worried'
    ? '<circle cx="25" cy="41" r="2.6" fill="#26243B"/><circle cx="39" cy="41" r="2.6" fill="#26243B"/><path d="M28 50c2.5-2 5.5-2 8 0" fill="none" stroke="#26243B" stroke-width="2.5" stroke-linecap="round"/>'
    : '<path d="M21 42c1.5-3 6.5-3 8 0" fill="none" stroke="#26243B" stroke-width="2.5" stroke-linecap="round"/><path d="M35 42c1.5-3 6.5-3 8 0" fill="none" stroke="#26243B" stroke-width="2.5" stroke-linecap="round"/><path d="M27 48c3 3 7 3 10 0" fill="none" stroke="#26243B" stroke-width="2.5" stroke-linecap="round"/>'}
</svg>`;
const icoLeft = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const icoRight = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const icoChev = '<svg class="chev" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const icoClose = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const icoWarn = (label) => `<svg ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} width="18" height="18" viewBox="0 0 16 16" style="flex:none"><path d="M8 1.6l6.8 11.9H1.2z" fill="#C2452D" stroke="#C2452D" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6.2v3.3" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.95" fill="#FFFFFF"/></svg>`;
const icoInfo = (label) => `<svg ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} width="18" height="18" viewBox="0 0 16 16" style="flex:none"><circle cx="8" cy="8" r="7.4" fill="#1D5FBF"/><path d="M8 7.3v4" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="4.6" r="1" fill="#FFFFFF"/></svg>`;

// ---------- Zustand ----------

const S = {
  token: store.get('niko_token'),
  view: 'boot', // boot | nolink | welcome | week | standard | request | error
  me: null,
  people: {},
  peopleList: [],
  standard: {},
  slots: {},
  notes: {},
  notices: {},
  off: 0,
  loaded: null,
  sheet: null,
  stdParity: 'even',
  request: null,
  requestId: null,
  error: null,
  busy: false,
  nolinkReason: null,
};

// ---------- Datenbank ----------

async function rpc(fn, args) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch {
    const e = new Error('Keine Verbindung. Bitte nochmal versuchen.');
    e.network = true;
    throw e;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const e = new Error((data && data.message) || `Fehler ${res.status}`);
    e.code = data && data.code;
    throw e;
  }
  return data;
}
const call = (fn, args = {}) => rpc(fn, { p_token: S.token, ...args });

function weekRange(off) {
  const mon = addDays(baseMonday(), 7 * off);
  return { mon, fri: addDays(mon, 4) };
}

async function load(off = S.off, silent = false) {
  const { mon, fri } = weekRange(off);
  const d = await call('niko_load', { p_from: isoOf(mon), p_to: isoOf(fri) });
  S.me = d.me;
  S.peopleList = d.people;
  S.people = Object.fromEntries(d.people.map((p) => [p.id, p]));
  S.standard = Object.fromEntries(d.standard.map((x) => [`${x.parity}-${x.weekday}-${x.kind}`, x]));
  S.slots = Object.fromEntries(d.slots.map((x) => [`${x.day}-${x.kind}`, x]));
  S.notes = Object.fromEntries(d.notes.map((x) => [x.day, x.body]));
  S.notices = {};
  for (const n of d.notices) (S.notices[n.day] ||= []).push(n);
  S.loaded = off;
  if (!silent) S.error = null;
  return d;
}

function handleError(e) {
  if (e.code === '28000' || /unbekannter Link/.test(e.message)) {
    store.del('niko_token');
    S.token = null;
    S.view = 'nolink';
    S.nolinkReason = 'invalid';
    S.sheet = null;
  } else {
    S.error = e.network ? e.message : `Das hat nicht geklappt: ${e.message}`;
  }
  render();
}

async function act(fn, args, okMsg) {
  if (S.busy) return false;
  S.busy = true;
  try {
    const r = await call(fn, args);
    await load(S.off);
    S.busy = false;
    if (okMsg) toast(okMsg);
    return { value: r };
  } catch (e) {
    S.busy = false;
    handleError(e);
    return false;
  }
}

// ---------- Logik ----------

const nameOf = (id) => (S.people[id] ? S.people[id].name : 'Jemand');
const meName = () => nameOf(S.me);

function handoverOf(id) {
  const p = S.people[id];
  if (!p || !p.handover_time) return '';
  return `Übergabe ${p.handover_time}${p.handover_place ? `, ${p.handover_place}` : ''}`;
}

function resolve(day, kind) {
  const iso = isoOf(day);
  const wd = (day.getDay() + 6) % 7;
  const parity = isoWeek(day) % 2 === 0 ? 'even' : 'odd';
  const std = S.standard[`${parity}-${wd}-${kind}`] || { status: 'open', person_id: null, detail: null };
  const ov = S.slots[`${iso}-${kind}`];
  const base = ov || std;
  return {
    iso, wd, kind, parity,
    status: base.status,
    person: base.person_id,
    askedBy: ov ? ov.asked_by : null,
    requestId: ov ? ov.request_id : null,
    changed: !!ov,
    detail: std.detail || '',
  };
}

function slotView(r) {
  const notices = S.notices[r.iso] || [];
  const v = { cls: 'slot', chip: '?', who: '', lines: [], open: false, conflict: false };
  if (r.status === 'person') {
    const p = S.people[r.person];
    v.who = p ? p.name : 'Unbekannt';
    v.chip = v.who.charAt(0);
    v.cls += p ? ` fam-${p.family}` : '';
    if (r.kind === 'bring') {
      const ho = handoverOf(r.person);
      const by = notices.map((n) => toMin(n.bring_by)).filter((x) => x != null).sort((a, b) => a - b)[0];
      const hoMin = toMin(S.people[r.person] && S.people[r.person].handover_time);
      if (by != null && hoMin != null && hoMin > by) {
        const byTxt = notices.find((n) => toMin(n.bring_by) === by).bring_by;
        v.lines.push(`Übergabe ${S.people[r.person].handover_time} ist zu spät. Bis ${byTxt} im Kindergarten.`);
        v.conflict = true;
        v.cls += ' conflict';
      } else if (ho) {
        v.lines.push(ho);
      }
    }
  } else if (r.status === 'separate') {
    v.who = 'Getrennt';
    v.chip = '–';
  } else {
    v.open = true;
    v.cls += ' open';
    v.who = r.status === 'asked' ? 'Anfrage läuft' : 'Offen';
    if (r.status === 'asked' && r.askedBy) v.lines.push(`${nameOf(r.askedBy)} sucht Ersatz`);
  }
  if (r.detail) v.lines.push(r.detail);
  v.label = `${DAYS_LONG[r.wd]}, ${KIND[r.kind]}: ${v.who}`;
  return v;
}

function weekDays(off) {
  const { mon } = weekRange(off);
  return DAYS.map((_, i) => addDays(mon, i));
}

// ---------- Teilen ----------

const baseUrl = () => location.origin + location.pathname;
const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

function askText(r, reqId) {
  const d = parseIso(r.iso);
  const extra = r.detail ? ` (${r.detail})` : '';
  return `${meName()} sucht Ersatz: ${DAYS_LONG[r.wd]}, ${short(d)}, ${KIND[r.kind]}${extra}. Wer kann übernehmen?\n${baseUrl()}?anfrage=${reqId}`;
}

// ---------- Rendering ----------

const app = document.getElementById('app');
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function render() {
  const views = { boot: vBoot, nolink: vNolink, welcome: vWelcome, week: vWeek, standard: vStandard, request: vRequest };
  app.innerHTML = (views[S.view] || vBoot)() + (S.sheet ? vSheet() : '');
  if (S.sheet && S.sheet.focus) {
    const el = app.querySelector(S.sheet.focus);
    if (el) el.focus();
    S.sheet.focus = null;
  }
}

function vBoot() {
  return `<div class="screen"><div class="head"><div class="speaker">${figure(76)}<div class="bubble"><p>Einen Moment …</p></div></div></div>
  <div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>`;
}

function vNolink() {
  const msg = S.nolinkReason === 'invalid'
    ? 'Dieser Link gilt nicht mehr. Frag nach deinem neuen persönlichen Link.'
    : S.requestId
      ? 'Öffne zuerst deinen persönlichen NiKo-Link. Danach tippst du nochmal auf die Anfrage in WhatsApp.'
      : 'Öffne NiKo bitte über deinen persönlichen Link. Den bekommst du von Michi.';
  return `<div class="screen"><div class="hero"><span class="brand">NiKo</span>${figure(180, 'worried')}</div>
  <div class="body"><h1>Hallo!</h1><p class="lead">${esc(msg)}</p></div></div>`;
}

function vWelcome() {
  return `<div class="screen"><div class="hero"><span class="brand">NiKo</span>${figure(190)}</div>
  <div class="body">
    <div class="stack" style="gap:8px"><h1>Hallo ${esc(meName())}!</h1>
    <p class="lead">Das ist NiKo, euer Plan für den Kindergartenweg von Ni und Ko.</p></div>
    <ol class="steps">
      <li><span class="n" aria-hidden="true">1</span><span>Sieh auf einen Blick, wer bringt und wer holt.</span></li>
      <li><span class="n" aria-hidden="true">2</span><span>Gib einen Tag ab, wenn du nicht kannst.</span></li>
      <li><span class="n" aria-hidden="true">3</span><span>Übernimm mit einem Tipp, wenn jemand fragt.</span></li>
    </ol>
    <p class="hint" style="margin:0">Tipp: Leg NiKo über das Browser-Menü auf den Startbildschirm. Dann ist es wie eine App.</p>
    <div class="stack push">
      <button class="primary" data-a="welcome-done">Los geht's</button>
      <button class="textbtn" style="align-self:center" data-a="not-me">Ich bin nicht ${esc(meName())}</button>
    </div>
  </div></div>`;
}

function errorPill() {
  return S.error ? `<p class="pill err" role="alert">${esc(S.error)} <button class="textbtn" style="min-height:32px" data-a="retry">Nochmal</button></p>` : '';
}

function vWeek() {
  const days = weekDays(S.off);
  const mon = days[0];
  const fri = days[4];
  const kw = isoWeek(mon);
  const range = mon.getMonth() === fri.getMonth()
    ? `${mon.getDate()}.–${fri.getDate()}. ${MONTHS[fri.getMonth()]}`
    : `${mon.getDate()}. ${MONTHS[mon.getMonth()]} – ${fri.getDate()}. ${MONTHS[fri.getMonth()]}`;
  const todayIso = isoOf(new Date());
  const myBring = [];
  const myPick = [];
  const openList = [];
  const noticeList = [];

  const cards = days.map((day) => {
    const iso = isoOf(day);
    const wd = (day.getDay() + 6) % 7;
    const rs = ['bring', 'pick'].map((k) => resolve(day, k));
    const vs = rs.map(slotView);
    rs.forEach((r, i) => {
      if (r.status === 'person' && r.person === S.me) (r.kind === 'bring' ? myBring : myPick).push(DAYS[wd]);
      if (vs[i].open) openList.push(`${DAYS[wd]} ${KIND[r.kind]}`);
    });
    const notices = S.notices[iso] || [];
    notices.forEach((n) => noticeList.push(`${DAYS[wd]} ${n.title}`));
    const warn = vs.some((v) => v.open);
    const note = S.notes[iso];
    const isToday = iso === todayIso;
    return `<section class="day${isToday ? ' today' : ''}" aria-label="${DAYS_LONG[wd]}, ${short(day)}">
      <button class="badge" data-a="day" data-day="${iso}" aria-label="${DAYS_LONG[wd]} ${short(day)}: Notiz und Kindergarten-Mitteilung">
        ${isToday ? '<span class="today-tag">Heute</span>' : ''}
        <b>${DAYS[wd]}</b><small>${short(day)}</small>
        ${warn || notices.length ? `<span class="marks">${warn ? icoWarn('Noch offen') : ''}${notices.length ? icoInfo('Mitteilung vom Kindergarten') : ''}</span>` : ''}
      </button>
      <div class="col">
        ${vs.map((v, i) => `<button class="${v.cls}" data-a="slot" data-day="${iso}" data-kind="${rs[i].kind}" aria-label="${esc(v.label)}. Ändern">
          <span class="chip" aria-hidden="true">${esc(v.chip)}</span>
          <span class="txt"><span class="kind">${KIND[rs[i].kind]}${rs[i].changed ? ' · geändert' : ''}</span>
          <span class="who">${esc(v.who)}</span>
          ${v.lines.map((l) => `<span class="det">${esc(l)}</span>`).join('')}</span>${icoChev}</button>`).join('')}
        ${notices.map((n) => `<div class="notice">${icoInfo()}<span class="txt"><span class="lbl">Kindergarten</span><b>${esc(n.title)}</b>${n.bring_by ? `<span>Bis spätestens ${esc(n.bring_by)} im Kindergarten.</span>` : ''}${n.body ? `<span>${esc(n.body)}</span>` : ''}</span></div>`).join('')}
        ${note ? `<p class="note">Notiz: ${esc(note)}</p>` : ''}
      </div>
    </section>`;
  }).join('');

  let summary = 'Diese Woche bist du nicht eingeteilt.';
  if (myBring.length && myPick.length) summary = `Du bringst ${join(myBring)} und holst ${join(myPick)} ab.`;
  else if (myBring.length) summary = `Du bringst ${join(myBring)}.`;
  else if (myPick.length) summary = `Du holst ${join(myPick)} ab.`;
  const loading = S.loaded !== S.off;

  return `<div class="screen">
  <header class="head">
    <div class="speaker">${figure(76, openList.length && !loading ? 'worried' : 'calm')}
      <div class="bubble"><small>Hallo ${esc(meName())}</small><p>${loading ? 'Lade die Woche …' : esc(summary)}</p></div>
    </div>
    <nav class="weeknav" aria-label="Woche wählen">
      <button class="round" data-a="prev" aria-label="Vorige Woche" ${S.off <= MIN_OFF ? 'disabled' : ''}>${icoLeft}</button>
      <div class="mid"><h1>KW ${kw} · ${range}</h1><span>${kw % 2 === 0 ? 'Gerade' : 'Ungerade'} Woche${S.off !== 0 ? ' · <button class="textbtn" style="min-height:24px;font-size:13px" data-a="today">zu heute</button>' : ''}</span></div>
      <button class="round" data-a="next" aria-label="Nächste Woche" ${S.off >= MAX_OFF ? 'disabled' : ''}>${icoRight}</button>
    </nav>
  </header>
  <div class="list">
    ${errorPill()}
    ${loading ? '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>' : `
    ${openList.length ? `<p class="pill warn">${icoWarn()}<span>Noch offen: ${esc(openList.join(', '))}</span></p>` : ''}
    ${noticeList.length ? `<p class="pill info">${icoInfo()}<span>Kindergarten: ${esc(noticeList.join(', '))}</span></p>` : ''}
    ${cards}
    <div class="links">
      <button class="textbtn" data-a="go-standard">Standardplan</button>
      <button class="textbtn" data-a="not-me">Ich bin nicht ${esc(meName())}</button>
    </div>`}
  </div></div>`;
}

function vStandard() {
  const p = S.stdParity;
  const cards = DAYS.map((d, wd) => {
    const rows = ['bring', 'pick'].map((kind) => {
      const st = S.standard[`${p}-${wd}-${kind}`] || { status: 'open' };
      const fake = { iso: '', wd, kind, status: st.status, person: st.person_id, detail: st.detail || '', askedBy: null };
      const v = slotView(fake);
      return `<button class="${v.cls}" data-a="std-slot" data-wd="${wd}" data-kind="${kind}" aria-label="${esc(v.label)}. Ändern">
        <span class="chip" aria-hidden="true">${esc(v.chip)}</span>
        <span class="txt"><span class="kind">${KIND[kind]}</span><span class="who">${esc(v.who)}</span>
        ${v.lines.map((l) => `<span class="det">${esc(l)}</span>`).join('')}</span>${icoChev}</button>`;
    }).join('');
    return `<section class="day" aria-label="${DAYS_LONG[wd]}"><div class="badge" style="pointer-events:none"><b>${d}</b></div><div class="col">${rows}</div></section>`;
  }).join('');
  return `<div class="screen">
    <div class="plainhead">
      <div class="top"><button class="round" data-a="go-week" aria-label="Zurück zum Wochenplan">${icoLeft}</button><h1>Standardplan</h1></div>
      <div class="toggle" role="group" aria-label="Wochen">
        <button data-a="std-parity" data-p="even" aria-pressed="${p === 'even'}">Gerade Wochen</button>
        <button data-a="std-parity" data-p="odd" aria-pressed="${p === 'odd'}">Ungerade Wochen</button>
      </div>
    </div>
    <div class="list" style="padding-top:0">${errorPill()}${cards}
      <p class="hint">Der Standardplan gilt für alle Wochen. Einzelne Tage änderst du im Wochenplan, die gehen vor.</p>
    </div></div>`;
}

function vRequest() {
  const q = S.request;
  if (!q) return vBoot();
  const back = '<button class="primary" data-a="go-week">Zum Wochenplan</button>';
  let bubble;
  let body = '';
  let buttons = back;
  if (!q.found) {
    bubble = 'Diese Anfrage gibt es nicht mehr. Schau im Wochenplan nach.';
  } else {
    const d = parseIso(q.day);
    const wd = (d.getDay() + 6) % 7;
    const r = resolve(d, q.kind);
    const v = slotView(r);
    const what = `${DAYS_LONG[wd]}, ${short(d)}`;
    body = `<div class="card"><small class="label" style="text-transform:uppercase;letter-spacing:.06em">${KIND[q.kind]}</small><h2>${what}</h2>
      <div class="${v.cls}" style="margin-top:10px"><span class="chip" aria-hidden="true">${esc(v.chip)}</span>
      <span class="txt"><span class="who">${esc(v.who)}</span>${v.lines.map((l) => `<span class="det">${esc(l)}</span>`).join('')}</span></div></div>`;
    if (q.result === 'accepted') {
      bubble = `Danke! Du ${q.kind === 'bring' ? 'bringst' : 'holst'} am ${DAYS_LONG[wd]}${q.kind === 'pick' ? ' ab' : ''}.`;
      const msg = `${meName()} übernimmt ${DAYS_LONG[wd]}, ${short(d)}, ${KIND[q.kind]}.`;
      buttons = `<a class="primary" href="${waLink(msg)}" target="_blank" rel="noopener">In der Gruppe Bescheid geben</a>
        <button class="secondary" data-a="go-week">Zum Wochenplan</button>`;
    } else if (q.result === 'declined') {
      bubble = 'Kein Problem. Die Anfrage bleibt für die anderen offen.';
    } else if (q.status === 'asked' && q.asked_by === S.me) {
      bubble = 'Das ist deine eigene Anfrage. Sie ist noch offen.';
      buttons = `<a class="primary" href="${waLink(askText(r, S.requestId))}" target="_blank" rel="noopener">Nochmal in der Gruppe fragen</a>
        <button class="secondary" data-a="go-week">Zum Wochenplan</button>`;
    } else if (q.status === 'asked') {
      bubble = `${nameOf(q.asked_by)} sucht Ersatz. Kannst du am ${DAYS_LONG[wd]} ${q.kind === 'bring' ? 'bringen' : 'abholen'}?`;
      buttons = `<button class="primary" data-a="accept" ${S.busy ? 'disabled' : ''}>Ich übernehme</button>
        <button class="secondary" data-a="decline">Kann leider nicht</button>`;
    } else if (q.status === 'person') {
      bubble = q.person_id === S.me ? 'Das hast du schon übernommen. Danke!' : `Schon erledigt: ${nameOf(q.person_id)} übernimmt.`;
    } else {
      bubble = 'Die Anfrage wurde zurückgezogen. Schau im Wochenplan nach.';
    }
  }
  return `<div class="screen">
    <div class="head" style="padding-top:calc(40px + env(safe-area-inset-top))"><div class="speaker">${figure(92)}<div class="bubble"><small>Hallo ${esc(meName())}</small><p>${esc(bubble)}</p></div></div></div>
    <div class="list" style="gap:14px">${errorPill()}${body}<div class="stack push">${buttons}</div></div></div>`;
}

// ---------- Sheets ----------

function sheetFrame(kicker, title, inner) {
  return `<div class="overlay"><button class="scrim" data-a="close" aria-label="Schließen"></button>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><div class="t">${kicker ? `<small>${esc(kicker)}</small>` : ''}<h2>${esc(title)}</h2></div>
    <button class="round" data-a="close" aria-label="Schließen">${icoClose}</button></div>
    ${inner}</div></div>`;
}

function optionButtons(cur, action, includeOpen) {
  const opts = S.peopleList.map((p) => `<button class="opt ${p.family}" data-a="${action}" data-status="person" data-person="${p.id}" aria-pressed="${cur.status === 'person' && cur.person === p.id}"><span class="chip" aria-hidden="true">${esc(p.name.charAt(0))}</span><span>${esc(p.name)}</span></button>`);
  opts.push(`<button class="opt" data-a="${action}" data-status="separate" aria-pressed="${cur.status === 'separate'}"><span class="chip" aria-hidden="true">–</span><span>Getrennt</span></button>`);
  if (includeOpen) opts.push(`<button class="opt o" data-a="${action}" data-status="open" aria-pressed="${cur.status === 'open'}"><span class="chip" aria-hidden="true">?</span><span>Offen</span></button>`);
  return `<div class="grid2">${opts.join('')}</div>`;
}

function vSheet() {
  const sh = S.sheet;
  if (sh.type === 'slot') {
    const d = parseIso(sh.day);
    const r = resolve(d, sh.kind);
    const v = slotView(r);
    let status;
    if (r.status === 'person') status = `${v.who} ${r.kind === 'bring' ? 'bringt' : 'holt ab'}.`;
    else if (r.status === 'separate') status = 'Getrennt: Jede Familie für sich.';
    else if (r.status === 'asked') status = `Anfrage läuft. ${nameOf(r.askedBy)} sucht Ersatz, noch hat niemand übernommen.`;
    else status = 'Noch niemand eingetragen.';
    const lines = v.lines.length ? ` ${v.lines.join('. ')}.` : '';
    const inner = `<p class="lead">${esc(status + lines)}</p>
      <div class="stack" style="gap:8px"><span class="label">Wer macht's?</span>${optionButtons(r, 'set-slot', true)}</div>
      <div class="stack">
        ${r.status === 'person' ? `<button class="primary" data-a="ask" ${S.busy ? 'disabled' : ''}>Abgeben und in der Gruppe fragen</button>` : ''}
        ${r.status === 'open' ? `<button class="primary" data-a="ask" ${S.busy ? 'disabled' : ''}>In der Gruppe fragen</button>` : ''}
        ${r.status === 'asked' && r.requestId ? `<a class="primary" href="${waLink(askText(r, r.requestId))}" target="_blank" rel="noopener">Nochmal in der Gruppe fragen</a>` : ''}
        ${r.changed ? '<button class="textbtn" style="align-self:center" data-a="reset">Zurück zum Standardplan</button>' : ''}
      </div>`;
    return sheetFrame(KIND[sh.kind], `${DAYS_LONG[r.wd]}, ${short(d)}`, inner);
  }
  if (sh.type === 'share') {
    const text = sh.text;
    const canShare = typeof navigator.share === 'function';
    const inner = `<p class="lead">Schick die Anfrage in eure WhatsApp-Gruppe. Wer auf den Link tippt, kann den Tag übernehmen.</p>
      <div class="chat">${esc(text)}</div>
      <div class="stack">
        <a class="primary" href="${waLink(text)}" target="_blank" rel="noopener" data-a="shared">In WhatsApp teilen</a>
        ${canShare ? '<button class="secondary" data-a="native-share">Anders teilen</button>' : ''}
        <button class="secondary" data-a="copy">Text kopieren</button>
      </div>`;
    return sheetFrame('Anfrage', 'Ersatz gesucht', inner);
  }
  if (sh.type === 'day') {
    const d = parseIso(sh.day);
    const wd = (d.getDay() + 6) % 7;
    const notices = S.notices[sh.day] || [];
    const list = notices.map((n) => `<div class="notice" style="justify-content:space-between">
        <span style="display:flex;gap:8px;min-width:0">${icoInfo()}<span class="txt"><b>${esc(n.title)}</b>${n.bring_by ? `<span>Bis spätestens ${esc(n.bring_by)}</span>` : ''}${n.body ? `<span>${esc(n.body)}</span>` : ''}</span></span>
        ${sh.confirm === n.id
          ? `<button class="textbtn danger" style="flex:none" data-a="del-notice" data-id="${n.id}">Wirklich löschen</button>`
          : `<button class="textbtn" style="flex:none" data-a="ask-del" data-id="${n.id}">Löschen</button>`}
      </div>`).join('');
    const inner = `
      <form class="stack" data-form="note">
        <div class="field"><label class="label" for="note">Notiz für ${DAYS_LONG[wd]}</label>
        <textarea id="note" name="body" maxlength="500" placeholder="z. B. Turnsachen mitnehmen">${esc(S.notes[sh.day] || '')}</textarea></div>
        <button class="secondary" type="submit" ${S.busy ? 'disabled' : ''}>Notiz speichern</button>
      </form>
      <div class="stack" style="gap:8px"><span class="label">Mitteilungen vom Kindergarten</span>${list || '<p class="lead" style="color:var(--muted)">Keine für diesen Tag.</p>'}</div>
      <form class="box" data-form="notice">
        <span class="label" style="color:var(--ink)">Neue Mitteilung</span>
        <div class="field"><label class="label" for="n-title">Worum geht's?</label><input id="n-title" name="title" required maxlength="120" placeholder="z. B. Ausflug Weltmuseum"></div>
        <div class="field"><label class="label" for="n-by">Kind muss da sein bis (optional)</label><input id="n-by" name="bring_by" type="time"></div>
        <div class="field"><label class="label" for="n-body">Details (optional)</label><textarea id="n-body" name="body" maxlength="1000" placeholder="z. B. Jause und Regenjacke mitgeben"></textarea></div>
        <button class="primary" type="submit" ${S.busy ? 'disabled' : ''}>Mitteilung eintragen</button>
      </form>`;
    return sheetFrame('Tag', `${DAYS_LONG[wd]}, ${short(d)}`, inner);
  }
  if (sh.type === 'std') {
    const st = S.standard[`${S.stdParity}-${sh.wd}-${sh.kind}`] || { status: 'open' };
    const cur = { status: sh.status ?? st.status, person: sh.person ?? st.person_id };
    const inner = `
      <p class="lead">Gilt für alle ${S.stdParity === 'even' ? 'geraden' : 'ungeraden'} Wochen.</p>
      <div class="stack" style="gap:8px"><span class="label">Wer macht's?</span>${optionButtons(cur, 'std-pick', true)}</div>
      <form class="stack" data-form="std">
        <div class="field"><label class="label" for="s-det">Hinweis (optional)</label>
        <input id="s-det" name="detail" maxlength="200" value="${esc(sh.detail ?? st.detail ?? '')}" placeholder="z. B. Ni 17:00 Basketball"></div>
        <button class="primary" type="submit" ${S.busy ? 'disabled' : ''}>Speichern</button>
      </form>`;
    return sheetFrame(`${KIND[sh.kind]} · ${S.stdParity === 'even' ? 'Gerade' : 'Ungerade'} Wochen`, DAYS_LONG[sh.wd], inner);
  }
  return '';
}

// ---------- Ereignisse ----------

app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  const ds = el.dataset;
  switch (a) {
    case 'close': S.sheet = null; render(); break;
    case 'retry': S.error = null; await reload(); break;
    case 'prev': if (S.off > MIN_OFF) { S.off -= 1; render(); await reload(); } break;
    case 'next': if (S.off < MAX_OFF) { S.off += 1; render(); await reload(); } break;
    case 'today': S.off = 0; render(); await reload(); break;
    case 'welcome-done':
      store.set(`niko_seen_${S.me}`, '1');
      S.view = S.requestId ? 'request' : 'week';
      render();
      break;
    case 'not-me':
      store.del('niko_token');
      S.token = null; S.view = 'nolink'; S.nolinkReason = null; S.sheet = null;
      render();
      break;
    case 'go-standard': S.view = 'standard'; S.sheet = null; history.pushState({ v: 'standard' }, '', '#standard'); render(); break;
    case 'go-week':
      S.view = 'week'; S.sheet = null; S.request = null; S.requestId = null;
      history.replaceState(null, '', location.pathname);
      render();
      await reload();
      break;
    case 'slot': S.sheet = { type: 'slot', day: ds.day, kind: ds.kind }; render(); break;
    case 'day': S.sheet = { type: 'day', day: ds.day }; render(); break;
    case 'set-slot': {
      const sh = S.sheet;
      const ok = await act('niko_set_slot', { p_day: sh.day, p_kind: sh.kind, p_status: ds.status, p_person: ds.person || null }, 'Gespeichert');
      if (ok) { S.sheet = null; render(); }
      break;
    }
    case 'reset': {
      const sh = S.sheet;
      const ok = await act('niko_set_slot', { p_day: sh.day, p_kind: sh.kind, p_status: 'reset', p_person: null }, 'Zurück zum Standardplan');
      if (ok) { S.sheet = null; render(); }
      break;
    }
    case 'ask': {
      const sh = S.sheet;
      const res = await act('niko_ask', { p_day: sh.day, p_kind: sh.kind });
      if (res && res.value) {
        const r = resolve(parseIso(sh.day), sh.kind);
        S.sheet = { type: 'share', text: askText(r, res.value) };
        render();
      }
      break;
    }
    case 'shared': setTimeout(() => { S.sheet = null; render(); }, 400); break;
    case 'native-share':
      try { await navigator.share({ text: S.sheet.text }); S.sheet = null; render(); } catch { /* abgebrochen */ }
      break;
    case 'copy':
      try { await navigator.clipboard.writeText(S.sheet.text); toast('Text kopiert'); } catch { toast('Kopieren ging nicht'); }
      break;
    case 'ask-del': S.sheet.confirm = ds.id; render(); break;
    case 'del-notice': {
      const ok = await act('niko_delete_notice', { p_id: ds.id }, 'Mitteilung gelöscht');
      if (ok) { S.sheet.confirm = null; render(); }
      break;
    }
    case 'std-parity': S.stdParity = ds.p; render(); break;
    case 'std-slot': S.sheet = { type: 'std', wd: Number(ds.wd), kind: ds.kind }; render(); break;
    case 'std-pick': {
      const input = app.querySelector('#s-det');
      S.sheet.detail = input ? input.value : S.sheet.detail;
      S.sheet.status = ds.status;
      S.sheet.person = ds.person || null;
      render();
      break;
    }
    case 'accept': {
      S.busy = true; render();
      try {
        const r = await call('niko_accept', { p_request: S.requestId });
        await load(S.off);
        S.busy = false;
        if (r.ok) {
          S.request.result = 'accepted';
          S.request.status = 'person';
          S.request.person_id = S.me;
        } else {
          Object.assign(S.request, await call('niko_request', { p_request: S.requestId }));
          toast('Da war jemand schneller');
        }
        render();
      } catch (e) { S.busy = false; handleError(e); }
      break;
    }
    case 'decline': S.request.result = 'declined'; render(); break;
    default: break;
  }
});

app.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(form);
  const kind = form.dataset.form;
  if (kind === 'note') {
    const ok = await act('niko_set_note', { p_day: S.sheet.day, p_body: f.get('body') || '' }, 'Notiz gespeichert');
    if (ok) { S.sheet = null; render(); }
  } else if (kind === 'notice') {
    const ok = await act('niko_add_notice', {
      p_day: S.sheet.day, p_title: f.get('title'), p_body: f.get('body') || null, p_bring_by: f.get('bring_by') || null,
    }, 'Mitteilung eingetragen');
    if (ok) { S.sheet = null; render(); }
  } else if (kind === 'std') {
    const sh = S.sheet;
    const st = S.standard[`${S.stdParity}-${sh.wd}-${sh.kind}`] || { status: 'open' };
    const status = sh.status ?? st.status;
    const person = status === 'person' ? (sh.person ?? st.person_id) : null;
    const ok = await act('niko_set_standard', {
      p_parity: S.stdParity, p_weekday: sh.wd, p_kind: sh.kind, p_status: status, p_person: person, p_detail: f.get('detail') || '',
    }, 'Standardplan gespeichert');
    if (ok) { S.sheet = null; render(); }
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
});

window.addEventListener('popstate', () => {
  if (S.view === 'standard' && location.hash !== '#standard') { S.view = 'week'; S.sheet = null; render(); }
});

async function reload() {
  if (!S.token) return;
  const want = S.off;
  try {
    await load(want);
    if (want === S.off) render();
  } catch (e) { handleError(e); }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !S.sheet && (S.view === 'week' || S.view === 'standard')) reload();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && !S.sheet && !S.busy && S.view === 'week') reload();
}, 60000);

// ---------- Start ----------

async function start() {
  const params = new URLSearchParams(location.search);
  const t = params.get('t');
  if (t && /^[a-f0-9]{32,128}$/i.test(t)) {
    S.token = t;
    store.set('niko_token', t);
  }
  const req = params.get('anfrage');
  if (req && /^[0-9a-f-]{36}$/i.test(req)) S.requestId = req;
  // Den Token nicht in der Adresszeile stehen lassen.
  if (t) history.replaceState(null, '', location.pathname + (S.requestId ? `?anfrage=${S.requestId}` : ''));

  if (!S.token) { S.view = 'nolink'; render(); return; }
  render();
  try {
    if (S.requestId) {
      S.request = await call('niko_request', { p_request: S.requestId });
      if (S.request.found) {
        const target = mondayOf(parseIso(S.request.day));
        S.off = Math.max(MIN_OFF, Math.min(MAX_OFF, Math.round((target - baseMonday()) / (7 * 86400000))));
      }
    }
    await load(S.off);
    const seen = store.get(`niko_seen_${S.me}`);
    if (!seen) S.view = 'welcome';
    else if (S.requestId) S.view = 'request';
    else S.view = location.hash === '#standard' ? 'standard' : 'week';
    render();
  } catch (e) {
    S.view = 'week';
    handleError(e);
  }
}

start();
