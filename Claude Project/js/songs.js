// Song years: a read-only view of guesses.csv from the Spotify year-guessing
// overlay (C:\Users\WilliamTappa\dev\spotify-year). The app never writes to
// that file.
//
// Getting at the file: a page opened from disk cannot fetch other local files,
// so the user picks guesses.csv once. Where the browser supports it (Edge,
// Chrome) the file handle is kept in IndexedDB and re-read on each visit, with
// at most a one-click permission prompt per browser session. Elsewhere the
// file is picked each time. The last successful read is cached in
// localStorage so the tab still shows something when the file is unreachable,
// and says how old it is. At ~160 bytes a guess, the cache fits roughly
// 25,000 guesses in the 5 MB localStorage budget.
//
// CSV (from the overlay's README): date, time, guess, actual, delta,
// year_source, spotify_album_year, track, artist, album, spotify_uri.
// delta = guess - actual. actual is the year scored against. Dates appear as
// both M/D/YYYY (earliest rows) and YYYY-MM-DD.
window.App = window.App || {};

App.songs = (function () {
  const U = App.util;
  const C = App.charts;
  const S = App.storage;
  const $ = id => document.getElementById(id);

  const CACHE_KEY = 'spotify-guesses';
  const NEAR = 3;           // "within 3 years": the overlay's gold threshold
  const RECENT_SHOWN = 15;  // recent-guesses table rows before "Show all"
  const TOP_ARTISTS = 10;
  const REQUIRED = ['date', 'guess', 'actual', 'track', 'artist'];
  const canRemember = typeof window.showOpenFilePicker === 'function';

  let data = null;          // { rows, skipped, totalRows, fileName, fileModified, readAt }
  let status = null;        // { kind: 'ok' | 'warn' | 'error', text }
  let showAllRecent = false;
  let visible = false;

  // ---------- CSV ----------
  // RFC 4180: quoted fields, "" escapes, commas and newlines inside quotes.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
  }

  function parseDate(s) {
    s = (s || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let ymd = m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : null;
    if (!ymd) {
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);   // M/D/YYYY, as the overlay wrote it at first
      if (m) ymd = m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
    }
    return ymd && U.isValidYmd(ymd) ? ymd : null;
  }

  const parseYear = s => /^\s*\d{4}\s*$/.test(s || '') ? Number(s) : null;

  // Returns { rows, skipped: [{ line, reason }], totalRows } or { error }.
  function normalize(text) {
    const table = parseCsv(text);
    if (!table.length) return { error: 'The file is empty.' };
    const header = table[0].map(h => h.trim().toLowerCase());
    const missing = REQUIRED.filter(c => !header.includes(c));
    if (missing.length) {
      return { error: 'This does not look like the guesses file: no ' + missing.join(', ') + ' column' + (missing.length > 1 ? 's' : '') + '.' };
    }
    const col = name => header.indexOf(name);
    const get = (r, name) => col(name) >= 0 ? (r[col(name)] || '').trim() : '';

    const rows = [], skipped = [];
    table.slice(1).forEach((r, i) => {
      const line = i + 2;   // 1-based, after the header
      const date = parseDate(get(r, 'date'));
      const guess = parseYear(get(r, 'guess'));
      const actual = parseYear(get(r, 'actual'));
      if (!date) { skipped.push({ line, reason: 'unreadable date "' + get(r, 'date') + '"' }); return; }
      if (guess == null || actual == null) { skipped.push({ line, reason: 'guess or actual is not a year' }); return; }
      rows.push({
        date, time: get(r, 'time'), guess, actual,
        // Computed, not read: one definition (guess - actual) regardless of file version.
        delta: guess - actual,
        source: get(r, 'year_source') || 'unknown',
        track: get(r, 'track') || '(untitled)', artist: get(r, 'artist') || '(unknown artist)',
        album: get(r, 'album')
      });
    });
    return { rows, skipped, totalRows: table.length - 1 };
  }

  // ---------- file access ----------
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('facelog', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const getHandle = () => idbDo('readonly', st => st.get('guesses')).catch(() => null);
  const saveHandle = h => idbDo('readwrite', st => st.put(h, 'guesses')).catch(() => null);
  const forgetHandle = () => idbDo('readwrite', st => st.delete('guesses')).catch(() => null);

  async function readFile(file) {
    let text;
    try { text = await file.text(); }
    catch (e) { return fail('Could not read ' + file.name + '. If it is open in Excel, close it and refresh.'); }
    const res = normalize(text);
    if (res.error) return fail(res.error + ' Nothing was changed.');
    data = Object.assign(res, { fileName: file.name, fileModified: file.lastModified, readAt: Date.now() });
    if (!S.save(CACHE_KEY, data)) console.warn('Song years: could not cache the last read');
    status = { kind: 'ok', text: '' };
    render();
  }

  function fail(text) {
    status = { kind: 'error', text };
    render();
  }

  // Pick the file (first time, or to switch files).
  async function choose() {
    if (!canRemember) { $('songs-file').click(); return; }
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }], multiple: false
      });
    } catch (e) {
      if (e.name !== 'AbortError') fail('Could not open the file picker: ' + e.message);
      return;
    }
    await saveHandle(handle);
    await readFile(await handle.getFile());
  }

  // Re-read the remembered file. interactive = a click, which may ask for permission.
  async function refresh(interactive) {
    if (!canRemember) { if (interactive) $('songs-file').click(); return; }
    const handle = await getHandle();
    if (!handle) { if (interactive) choose(); return; }
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted' && interactive) perm = await handle.requestPermission({ mode: 'read' });
    if (perm !== 'granted') {
      status = interactive
        ? { kind: 'error', text: 'Permission to read ' + handle.name + ' was not given, so the data below was not refreshed.' }
        : { kind: 'warn', text: 'Click Refresh to read the latest ' + handle.name + '. Your browser asks once per session.' };
      render();
      return;
    }
    try {
      await readFile(await handle.getFile());
    } catch (e) {
      if (e.name === 'NotFoundError') {
        await forgetHandle();
        fail(handle.name + ' is no longer where it was (moved, renamed or deleted). Choose it again.');
      } else {
        fail('Could not read ' + handle.name + ': ' + e.message);
      }
    }
  }

  // ---------- stats ----------
  const absMean = rows => rows.reduce((a, r) => a + Math.abs(r.delta), 0) / rows.length;
  const fmtYears = v => (Math.round(v * 10) / 10) + (Math.round(v * 10) / 10 === 1 ? ' year' : ' years');
  const pct = (n, d) => Math.round(n / d * 100) + '%';
  const chrono = (a, b) => (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);

  // ---------- rendering ----------
  function render() {
    if (!visible) return;
    renderSource();
    const wrap = $('songs-body');
    wrap.replaceChildren();
    $('songs-stats').replaceChildren();

    if (!data) {
      wrap.append(U.el('div', { class: 'panel songs-intro' },
        U.el('h2', { text: 'Connect your guesses file' }),
        U.el('p', { text: 'This tab reads guesses.csv from your Spotify year overlay and charts how your guesses compare with the real release years. It only reads the file and never changes it.' }),
        U.el('p', { class: 'hint', text: canRemember
          ? 'Choose the file once. After that, this tab reads the latest version each time you open it.'
          : 'This browser cannot remember the file, so choose it each time you want fresh numbers. Edge or Chrome can remember it.' }),
        U.el('button', { type: 'button', class: 'primary-btn', text: 'Choose guesses.csv', onclick: choose })));
      return;
    }

    const rows = data.rows.slice().sort(chrono);
    if (!rows.length) {
      wrap.append(U.el('p', { class: 'empty', text: data.totalRows
        ? 'None of the ' + data.totalRows + ' rows in ' + data.fileName + ' could be read. Details are above.'
        : data.fileName + ' has a header but no guesses yet. Make a guess in the overlay, then refresh.' }));
      return;
    }

    renderStats(rows);
    renderScatter(wrap, rows);
    renderDaily(wrap, rows);
    renderMisses(wrap, rows);
    renderDecades(wrap, rows);
    renderArtists(wrap, rows);
    renderRecent(wrap, rows);
  }

  function renderSource() {
    const bar = $('songs-source');
    bar.replaceChildren();
    if (!data && !status) { bar.hidden = true; return; }
    bar.hidden = false;
    const info = U.el('div', { class: 'source-info' });
    if (data) {
      info.append(U.el('p', { class: 'source-line', text:
        'From ' + data.fileName + ', read ' + U.fmtStamp(new Date(data.readAt).toISOString()) +
        ' (file last saved ' + U.fmtStamp(new Date(data.fileModified).toISOString()) + ').' }));
      // CLAIMS: coverage of the read. COUNTS: rows parsed vs rows in the file after the header.
      info.append(U.el('p', { class: 'source-line muted', text: data.skipped.length
        ? 'Read ' + data.rows.length + ' of ' + data.totalRows + ' rows. Skipped: ' +
          data.skipped.slice(0, 5).map(s => 'line ' + s.line + ' (' + s.reason + ')').join('; ') +
          (data.skipped.length > 5 ? '; and ' + (data.skipped.length - 5) + ' more.' : '.')
        : 'Read all ' + U.plural(data.totalRows, 'row') + '.' }));
    }
    if (status && status.text) info.append(U.el('p', { class: 'source-line ' + status.kind, role: status.kind === 'error' ? 'alert' : null, text: status.text }));
    const actions = U.el('div', { class: 'source-actions' },
      data || (status && status.kind === 'warn') ? U.el('button', { type: 'button', class: 'ghost-btn', text: 'Refresh', onclick: () => refresh(true) }) : null,
      U.el('button', { type: 'button', class: 'ghost-btn', text: data ? 'Choose a different file' : 'Choose guesses.csv', onclick: choose }));
    bar.append(info, actions);
  }

  function stat(label, value, note) {
    return U.el('div', { class: 'stat' },
      U.el('p', { class: 'stat-label', text: label }),
      U.el('p', { class: 'stat-value', text: value }),
      note ? U.el('p', { class: 'stat-note', text: note }) : null);
  }

  function renderStats(rows) {
    const n = rows.length;
    const exact = rows.filter(r => r.delta === 0).length;
    // CLAIMS: "Within 3 years" (the overlay's gold band, exact guesses included).
    // COUNTS: |guess - actual| <= 3.
    const near = rows.filter(r => Math.abs(r.delta) <= NEAR).length;
    // CLAIMS: "Average miss" = typical distance from the right year. COUNTS: mean |guess - actual|, exact guesses included as 0.
    const avg = absMean(rows);
    // CLAIMS: "Lean" = whether guesses run older or newer than the truth. COUNTS: mean of guess - actual.
    const bias = rows.reduce((a, r) => a + r.delta, 0) / n;
    const lean = Math.abs(bias) < 0.5 ? 'None' : fmtYears(Math.abs(bias)) + (bias > 0 ? ' newer' : ' older');
    const first = rows[0].date, last = rows[rows.length - 1].date;
    $('songs-sub').textContent = U.plural(n, 'guess', 'guesses') + ' from ' + U.fmtMed(first) + ' to ' + U.fmtMed(last) + '.';
    $('songs-stats').replaceChildren(
      stat('Guesses', String(n), U.plural(new Set(rows.map(r => r.artist)).size, 'artist')),
      stat('Exact', pct(exact, n), exact + ' of ' + n),
      stat('Within ' + NEAR + ' years', pct(near, n), near + ' of ' + n + ', exact included'),
      stat('Average miss', fmtYears(avg), 'exact guesses count as 0'),
      stat('Lean', lean, Math.abs(bias) < 0.5 ? 'your misses balance out' : 'average of guess minus actual'));
  }

  // A chart card with a chart/table toggle, the same pattern as Trends.
  const tableMode = {};
  function card(wrap, id, title, sub, opts) {
    opts = opts || {};
    const body = U.el('div');
    const el = U.el('section', { class: 'panel chart-card', 'aria-labelledby': 'sg-' + id + '-h' },
      U.el('div', { class: 'chart-head' },
        U.el('div', null, U.el('h2', { id: 'sg-' + id + '-h', text: title }), U.el('p', { class: 'chart-sub', text: sub })),
        opts.noToggle ? null : U.el('button', {
          type: 'button', class: 'ghost-btn chart-toggle', text: tableMode[id] ? 'Show chart' : 'Show table',
          onclick: () => { tableMode[id] = !tableMode[id]; render(); }
        })),
      opts.legend && !tableMode[id] ? opts.legend : null,
      body);
    wrap.append(el);
    return { body, table: !!tableMode[id] };
  }

  function renderScatter(wrap, rows) {
    const c = card(wrap, 'scatter', 'Your guess against the real year',
      'Across is the year the song came out; up is what you guessed. Dots on the line are exact. Above the line you guessed too new, below it too old. Bigger dots are spots you hit more than once.', {
        legend: U.el('div', { class: 'legend' },
          U.el('span', null, U.el('i', { class: 'key-box', style: '--c:var(--accent-wash);box-shadow:inset 0 0 0 1px var(--line)' }), 'Within ' + NEAR + ' years'),
          U.el('span', null, U.el('i', { class: 'key-line', style: '--c:var(--axis)' }), 'Exact'))
      });
    if (c.table) {
      return C.table(c.body, ['Song', 'Artist', 'Guess', 'Actual', 'Off by'],
        rows.slice().sort((a, b) => a.actual - b.actual).map(r => [r.track, r.artist, String(r.guess), String(r.actual), offText(r.delta)]));
    }
    C.guessScatter(c.body, {
      band: NEAR, ariaLabel: 'Scatter of guessed year against actual year. Use Show table for the values.',
      points: rows.map(r => ({ x: r.actual, y: r.guess, title: r.track, detail: r.artist }))
    });
  }

  function offText(d) {
    if (d === 0) return 'exact';
    return U.plural(Math.abs(d), 'year') + (d > 0 ? ' too new' : ' too old');
  }

  function renderDaily(wrap, rows) {
    const byDay = new Map();
    rows.forEach(r => { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); });
    const days = Array.from(byDay.keys()).sort();
    const title = 'Average miss by day';
    if (days.length < 2) return;   // one point is not a trend; the stat tiles already cover it
    // CLAIMS: "Average miss by day". COUNTS: mean |guess - actual| over that day's guesses.
    const pts = days.map(d => ({ d: U.dayNum(d), y: Math.round(absMean(byDay.get(d)) * 10) / 10 }));
    const c = card(wrap, 'daily', title, 'Years off, averaged over each day you played. Lower is better. Gaps are days with no guesses.');
    if (c.table) {
      return C.table(c.body, ['Date', 'Guesses', 'Average miss', 'Within ' + NEAR + ' years'],
        days.slice().reverse().map(d => { const l = byDay.get(d); return [U.fmtMed(d), String(l.length), fmtYears(absMean(l)), pct(l.filter(r => Math.abs(r.delta) <= NEAR).length, l.length)]; }));
    }
    C.line(c.body, {
      d0: U.dayNum(days[0]), d1: U.dayNum(days[days.length - 1]),
      ariaLabel: title + ' chart. Use Show table for the values.',
      series: [{ label: 'average miss', color: 'var(--series-1)', points: pts }],
      yFmt: (v, full) => full ? fmtYears(v) : String(v)
    });
  }

  // Signed misses in bins that line up with the overlay's 3-year band.
  const BINS = [
    { label: 'Too old by 11+', test: d => d <= -11 },
    { label: 'Too old by 7 to 10', test: d => d >= -10 && d <= -7 },
    { label: 'Too old by 4 to 6', test: d => d >= -6 && d <= -4 },
    { label: 'Too old by 1 to 3', test: d => d >= -3 && d <= -1 },
    { label: 'Exact', test: d => d === 0 },
    { label: 'Too new by 1 to 3', test: d => d >= 1 && d <= 3 },
    { label: 'Too new by 4 to 6', test: d => d >= 4 && d <= 6 },
    { label: 'Too new by 7 to 10', test: d => d >= 7 && d <= 10 },
    { label: 'Too new by 11+', test: d => d >= 11 }
  ];

  function renderMisses(wrap, rows) {
    const items = BINS.map(b => ({ label: b.label, value: rows.filter(r => b.test(r.delta)).length }));
    const c = card(wrap, 'misses', 'How far off',
      'Every guess sorted by how far off it was. "Too old" means you guessed an earlier year than the real one.');
    if (c.table) return C.table(c.body, ['Miss', 'Guesses', 'Share'], items.map(i => [i.label, String(i.value), pct(i.value, rows.length)]));
    C.hbars(c.body, items, v => U.plural(v, 'guess', 'guesses'));
  }

  function renderDecades(wrap, rows) {
    const byDec = new Map();
    rows.forEach(r => { const d = Math.floor(r.actual / 10) * 10; if (!byDec.has(d)) byDec.set(d, []); byDec.get(d).push(r); });
    const decs = Array.from(byDec.keys()).sort((a, b) => a - b);
    // CLAIMS: average miss for songs released in each decade. COUNTS: mean |guess - actual| grouped by decade of the actual year.
    const items = decs.map(d => ({ label: d + 's', value: Math.round(absMean(byDec.get(d)) * 10) / 10, n: byDec.get(d).length }));
    const c = card(wrap, 'decades', 'Average miss by decade',
      'Grouped by when the song actually came out, oldest first. Shorter bars mean you know that era better. Decades with only a guess or two can swing a lot.');
    if (c.table) return C.table(c.body, ['Decade', 'Guesses', 'Average miss'], items.map(i => [i.label, String(i.n), fmtYears(i.value)]));
    C.hbars(c.body, items, (v, i) => fmtYears(v) + ' (' + U.plural(i.n, 'guess', 'guesses') + ')');
  }

  function renderArtists(wrap, rows) {
    const by = new Map();
    rows.forEach(r => { if (!by.has(r.artist)) by.set(r.artist, []); by.get(r.artist).push(r); });
    const all = Array.from(by, ([artist, list]) => ({ label: artist, value: list.length, avg: absMean(list) }))
      .sort((a, b) => b.value - a.value || a.avg - b.avg || a.label.localeCompare(b.label));
    const top = all.slice(0, TOP_ARTISTS);
    const c = card(wrap, 'artists', 'Most-guessed artists',
      (all.length > TOP_ARTISTS ? 'Top ' + TOP_ARTISTS + ' of ' + all.length + ' artists' : 'All ' + U.plural(all.length, 'artist')) +
      ' by number of guesses, with your average miss for each. The table lists every artist.');
    if (c.table) return C.table(c.body, ['Artist', 'Guesses', 'Average miss'], all.map(a => [a.label, String(a.value), fmtYears(a.avg)]));
    C.hbars(c.body, top, (v, i) => U.plural(v, 'guess', 'guesses') + ', off by ' + fmtYears(i.avg) + ' on average');
  }

  function renderRecent(wrap, rows) {
    const latest = rows.slice().reverse();
    const shown = showAllRecent ? latest : latest.slice(0, RECENT_SHOWN);
    const c = card(wrap, 'recent', 'Recent guesses',
      shown.length < latest.length ? 'The latest ' + shown.length + ' of ' + latest.length + ' guesses.' : 'All ' + U.plural(latest.length, 'guess', 'guesses') + ', newest first.',
      { noToggle: true });
    C.table(c.body, ['When', 'Song', 'Artist', 'Guess', 'Actual', 'Off by'],
      shown.map(r => [U.fmtShort(r.date) + ' ' + r.time.slice(0, 5), r.track, r.artist, String(r.guess), String(r.actual), offText(r.delta)]));
    c.body.style.maxHeight = 'none';   // the list is already capped; no scroll box inside the page
    if (latest.length > RECENT_SHOWN) {
      c.body.parentNode.append(U.el('button', {
        type: 'button', class: 'ghost-btn show-more',
        text: showAllRecent ? 'Show the latest ' + RECENT_SHOWN + ' only' : 'Show all ' + latest.length,
        onclick: () => { showAllRecent = !showAllRecent; render(); }
      }));
    }
  }

  // ---------- init ----------
  function init() {
    data = S.load(CACHE_KEY, null);
    $('songs-file').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) await readFile(f);
    });
    window.addEventListener('resize', U.debounce(render, 150));
  }

  return {
    init,
    onShow() { visible = true; render(); refresh(false); },
    onHide() { visible = false; },
    _normalize: normalize   // exposed for the test page
  };
})();
