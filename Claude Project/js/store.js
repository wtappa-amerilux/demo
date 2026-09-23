// All journal days, cube solves and settings live here, and every view reads
// through this one module so the numbers on each screen agree.
//
// Day:   { date, feelsF, q: {qualityKey: 1..5}, tags: [], title, body,
//          notes: [{id, text, at}], createdAt, updatedAt }
// Solve: { id, date, ms, penalty: 'none' | '+2' | 'dnf', note, createdAt }
window.App = window.App || {};

App.QUALITIES = [
  { key: 'muggy',  name: 'Mugginess', low: 'crisp',    high: 'soupy' },
  { key: 'wind',   name: 'Wind bite', low: 'still',    high: 'biting' },
  { key: 'glare',  name: 'Glare',     low: 'dim',      high: 'squinting' },
  { key: 'mood',   name: 'Sky mood',  low: 'brooding', high: 'cheerful' },
  { key: 'charge', name: 'Charge',    low: 'calm',     high: 'electric' },
  { key: 'scent',  name: 'Scent',     low: 'nothing',  high: 'everything' },
  { key: 'cozy',   name: 'Coziness',  low: 'none',     high: 'blanket' },
  { key: 'drama',  name: 'Drama',     low: 'flat',     high: 'cinematic' },
  { key: 'ground', name: 'Underfoot', low: 'dusty',    high: 'squelchy' }
];

App.DEFAULT_TAGS = [
  'petrichor', 'sweater weather', 'smells like snow', 'golden hour', 'frizz day',
  'eerie calm', 'sunburn risk', 'pollen haze', 'sticky', 'thunder-ish'
];

App.store = (function () {
  const S = App.storage;
  const U = App.util;
  let days = {};
  let solves = [];
  let settings = { tempUnit: 'F' };
  const listeners = [];

  function emit(what) { listeners.forEach(fn => fn(what)); }
  function on(fn) { listeners.push(fn); }

  function blankDay(date) {
    return { date, feelsF: null, q: {}, tags: [], title: '', body: '', notes: [], createdAt: null, updatedAt: null };
  }

  function isEmptyDay(d) {
    return d.feelsF == null && Object.keys(d.q).length === 0 && d.tags.length === 0 &&
      !d.title.trim() && !d.body.trim() && d.notes.length === 0;
  }

  // One-time move of v1 journal entries (a flat list, several per day allowed)
  // into v2 days (one per date). Same-day entries are joined, oldest first,
  // so nothing is dropped. The v1 key is left in place as a backup.
  // Sentinel: the 'days' key exists only after migration has written it.
  function migrateV1() {
    const old = S.load('journal', []);
    const out = {};
    let moved = 0, skipped = 0;
    (Array.isArray(old) ? old : [])
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .forEach(e => {
        const t = new Date(e && e.createdAt);
        if (!e || isNaN(t)) { skipped++; return; }
        const date = U.ymd(t);
        const d = out[date] || Object.assign(blankDay(date), { createdAt: e.createdAt });
        const title = (e.title || '').trim();
        const body = (e.body || '').trim();
        if (!d.title && !d.body) {
          d.title = title;
          d.body = body;
        } else {
          d.body = d.body + '\n\n' + (title ? title + '\n' : '') + body;
        }
        d.updatedAt = e.createdAt;
        out[date] = d;
        moved++;
      });
    if (moved || skipped) console.info('Facelog: migrated ' + moved + ' journal entries, skipped ' + skipped + ' unreadable');
    return out;
  }

  function load() {
    const stored = S.load('days', null);
    if (stored === null) {
      days = migrateV1();
      S.save('days', days);
    } else {
      days = stored;
    }
    solves = S.load('solves', []);
    settings = Object.assign({ tempUnit: 'F' }, S.load('settings', {}));
  }

  // ---- days ----
  function getDay(date) {
    const d = days[date];
    return d ? JSON.parse(JSON.stringify(d)) : blankDay(date);
  }
  function hasDay(date) { return !!days[date]; }

  // Saves the day, or removes it if it holds nothing. Returns false if storage failed.
  function saveDay(day) {
    const now = new Date().toISOString();
    if (isEmptyDay(day)) {
      delete days[day.date];
    } else {
      day.createdAt = day.createdAt || now;
      day.updatedAt = now;
      days[day.date] = JSON.parse(JSON.stringify(day));
    }
    const ok = S.save('days', days);
    emit('days');
    return ok;
  }

  function deleteDay(date) {
    delete days[date];
    const ok = S.save('days', days);
    emit('days');
    return ok;
  }

  // All days, oldest first.
  function listDays() {
    return Object.keys(days).sort().map(k => days[k]);
  }

  // Every tag ever used plus the defaults, defaults first.
  function allTags() {
    const set = new Set(App.DEFAULT_TAGS);
    listDays().forEach(d => d.tags.forEach(t => set.add(t)));
    return Array.from(set);
  }

  // ---- solves ----
  // Chronological: by the day the solve belongs to, then by when it was recorded.
  // This is the order averages of 5 and 12 are taken in.
  function listSolves() {
    return solves.slice().sort((a, b) =>
      a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date));
  }

  function addSolve(s) {
    const solve = {
      id: S.newId(),
      date: s.date,
      ms: s.ms,
      penalty: s.penalty || 'none',
      note: s.note || '',
      createdAt: new Date().toISOString()
    };
    solves.push(solve);
    const ok = S.save('solves', solves);
    emit('solves');
    return ok ? solve : null;
  }

  function updateSolve(id, patch) {
    const s = solves.find(x => x.id === id);
    if (!s) return false;
    Object.assign(s, patch);
    const ok = S.save('solves', solves);
    emit('solves');
    return ok;
  }

  function deleteSolve(id) {
    solves = solves.filter(x => x.id !== id);
    const ok = S.save('solves', solves);
    emit('solves');
    return ok;
  }

  // ---- settings ----
  function getSetting(k) { return settings[k]; }
  function setSetting(k, v) {
    settings[k] = v;
    S.save('settings', settings);
    emit('settings');
  }

  // ---- backup ----
  function exportAll() {
    return {
      app: 'facelog', version: 2, exportedAt: new Date().toISOString(),
      days, solves, settings, todos: S.load('todos', [])
    };
  }

  // Replaces everything. Returns an error message, or null on success.
  function importAll(data) {
    if (!data || data.app !== 'facelog') return 'That file is not a Facelog backup.';
    if (typeof data.days !== 'object' || Array.isArray(data.days) || !Array.isArray(data.solves)) {
      return 'That backup is missing its journal or solve data.';
    }
    const badDay = Object.keys(data.days).find(k => !U.isValidYmd(k));
    if (badDay) return 'That backup has an unreadable date: ' + badDay;
    const ok = S.save('days', data.days) && S.save('solves', data.solves) &&
      S.save('settings', data.settings || {}) && S.save('todos', Array.isArray(data.todos) ? data.todos : []);
    return ok ? null : 'Could not write to browser storage.';
  }

  return {
    load, on, getDay, hasDay, saveDay, deleteDay, listDays, allTags,
    listSolves, addSolve, updateSolve, deleteSolve,
    getSetting, setSetting, exportAll, importAll
  };
})();
