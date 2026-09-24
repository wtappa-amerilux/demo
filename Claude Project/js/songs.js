// Song years: a read-only view of the Spotify year-guessing overlay's data in
// C:\Users\WilliamTappa\dev\spotify-year. The app never writes to that folder.
//
// Files read:
//   guesses.csv       written by the overlay, one row per guess (required)
//   artist-info.json  written by Get-ArtistInfo.ps1 in that folder: MusicBrainz
//                     genres, band/solo type and country per artist (optional)
//
// Getting at the files: a page opened from disk cannot fetch other local files,
// so the user picks the spotify-year folder once. Where the browser supports it
// (Edge, Chrome) the folder handle is kept in IndexedDB and re-read on each
// visit, with at most a one-click permission prompt per browser session.
// Elsewhere the files are picked each time. The last successful read is cached
// in localStorage so the tab still shows something when the folder is
// unreachable, and says how old it is. At ~200 bytes a guess plus ~300 an
// artist, the cache fits roughly 20,000 guesses in the 5 MB localStorage budget.
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
  const TOP_COUNTRIES = 8;
  const REQUIRED = ['date', 'guess', 'actual', 'track', 'artist'];
  const canRemember = typeof window.showDirectoryPicker === 'function';

  // data: { rows, skipped, totalRows, fileName, fileModified, readAt,
  //         via: 'folder' | 'file' | 'picked', folderName,
  //         artists: { name: info } | null, artistsModified, artistsProblem }
  let data = null;
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
        album: get(r, 'album'), uri: get(r, 'spotify_uri')
      });
    });
    return { rows, skipped, totalRows: table.length - 1 };
  }

  // artist-info.json -> { artists } or { problem }
  function parseArtists(text) {
    let j;
    try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return { problem: 'artist-info.json is not valid JSON, so genres are not shown. Run Get-ArtistInfo.ps1 again.' }; }
    if (!j || typeof j.artists !== 'object' || Array.isArray(j.artists)) return { problem: 'artist-info.json has no artists list, so genres are not shown.' };
    return { artists: j.artists };
  }

  // ---------- genre families ----------
  // MusicBrainz genres are fine-grained ("red dirt", "heartland rock"). Each
  // artist goes into ONE family: its most-voted genre that maps to a family.
  // Exact names first, then keyword rules in order.
  const FAMILY_EXACT = {
    'country': 'Country and Americana', 'americana': 'Country and Americana', 'red dirt': 'Country and Americana',
    'bluegrass': 'Country and Americana', 'country folk': 'Country and Americana', 'country rock': 'Country and Americana',
    'alt-country': 'Country and Americana', 'alternative country': 'Country and Americana', 'outlaw country': 'Country and Americana',
    'honky tonk': 'Country and Americana', 'texas country': 'Country and Americana', 'progressive bluegrass': 'Country and Americana',
    'southern rock': 'Southern and heartland rock', 'heartland rock': 'Southern and heartland rock', 'roots rock': 'Southern and heartland rock',
    'blues rock': 'Southern and heartland rock', 'swamp rock': 'Southern and heartland rock',
    'grunge': 'Alternative and grunge', 'post-grunge': 'Alternative and grunge', 'alternative rock': 'Alternative and grunge',
    'nu metal': 'Alternative and grunge', 'emo': 'Alternative and grunge',
    'indie rock': 'Indie', 'indie pop': 'Indie', 'indie folk': 'Indie', 'chamber pop': 'Indie', 'art rock': 'Indie', 'dream pop': 'Indie', 'lo-fi': 'Indie',
    'folk': 'Folk and singer-songwriter', 'folk rock': 'Folk and singer-songwriter', 'singer-songwriter': 'Folk and singer-songwriter', 'contemporary folk': 'Folk and singer-songwriter',
    'hip hop': 'Hip hop and R&B', 'rap': 'Hip hop and R&B', 'r&b': 'Hip hop and R&B', 'soul': 'Hip hop and R&B', 'funk': 'Hip hop and R&B'
  };
  const FAMILY_KEYWORDS = [
    [/country|bluegrass|americana/, 'Country and Americana'],
    [/metal/, 'Metal'],
    [/hip hop|rap\b|trap|r&b|soul/, 'Hip hop and R&B'],
    [/punk|grunge|alternative/, 'Alternative and grunge'],
    [/indie/, 'Indie'],
    [/folk|singer-songwriter/, 'Folk and singer-songwriter'],
    [/pop|dance|disco|synth|electro/, 'Pop and dance'],
    [/rock/, 'Rock']
  ];
  function familyOf(genres) {
    for (const g of genres) {
      const n = g.name.toLowerCase();
      if (FAMILY_EXACT[n]) return FAMILY_EXACT[n];
      const k = FAMILY_KEYWORDS.find(([re]) => re.test(n));
      if (k) return k[1];
    }
    return 'Other genres';
  }

  // Every CSV artist lands in exactly one bucket, including the "don't know" ones,
  // and the don't-know reasons are kept apart (rule: an empty state is a claim).
  const NOT_LOADED = 'Artist details not loaded';
  const NOT_LOOKED_UP = 'Not looked up yet';
  const NO_MATCH = 'Not found on MusicBrainz';
  const FAILED = 'Lookup failed';
  const NO_GENRE = 'No genre on file';
  const UNKNOWN_BUCKETS = [NOT_LOADED, NOT_LOOKED_UP, NO_MATCH, FAILED, NO_GENRE];

  function infoFor(artist) {
    if (!data.artists) return { bucket: NOT_LOADED };
    const a = data.artists[artist];
    if (!a) return { bucket: NOT_LOOKED_UP };
    if (a.status === 'no-match') return { bucket: NO_MATCH };
    if (a.status !== 'found') return { bucket: FAILED };
    return { bucket: 'found', info: a };
  }

  function genreBucket(artist) {
    const r = infoFor(artist);
    if (r.bucket !== 'found') return r.bucket;
    return r.info.genres && r.info.genres.length ? familyOf(r.info.genres) : NO_GENRE;
  }

  function typeBucket(artist) {
    const r = infoFor(artist);
    if (r.bucket !== 'found') return r.bucket;
    if (r.info.type === 'Group') return 'Bands';
    if (r.info.type === 'Person') return 'Solo artists';
    return r.info.type ? 'Other (' + r.info.type.toLowerCase() + ')' : 'Type not on file';
  }

  const regionNames = (typeof Intl !== 'undefined' && Intl.DisplayNames) ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
  function countryBucket(artist) {
    const r = infoFor(artist);
    if (r.bucket !== 'found') return r.bucket;
    const c = r.info.country;
    if (!c) return 'Country not on file';
    if (c === 'XW') return 'Worldwide';
    try { return regionNames ? regionNames.of(c) : c; } catch (e) { return c; }
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
  const getHandle = key => idbDo('readonly', st => st.get(key)).catch(() => null);
  const saveHandle = (key, h) => idbDo('readwrite', st => st.put(h, key)).catch(() => null);
  const forgetHandle = key => idbDo('readwrite', st => st.delete(key)).catch(() => null);

  // Reads guesses.csv (required) and artist-info.json (optional) and replaces the cache.
  async function readFiles(csvFile, artistFile, via, folderName) {
    let text;
    try { text = await csvFile.text(); }
    catch (e) { return fail('Could not read ' + csvFile.name + '. If it is open in Excel, close it and refresh.'); }
    const res = normalize(text);
    if (res.error) return fail(res.error + ' Nothing was changed.');

    let artists = null, artistsModified = null, artistsProblem = null;
    if (artistFile) {
      try {
        const a = parseArtists(await artistFile.text());
        artists = a.artists || null;
        artistsProblem = a.problem || null;
        artistsModified = artistFile.lastModified;
      } catch (e) {
        artistsProblem = 'Could not read artist-info.json (' + e.message + '), so genres are not shown.';
      }
    }
    data = Object.assign(res, {
      fileName: csvFile.name, fileModified: csvFile.lastModified, readAt: Date.now(),
      via, folderName: folderName || null, artists, artistsModified, artistsProblem
    });
    if (!S.save(CACHE_KEY, data)) console.warn('Song years: could not cache the last read');
    status = { kind: 'ok', text: '' };
    render();
  }

  async function readFolder(dir) {
    let csv;
    try { csv = await (await dir.getFileHandle('guesses.csv')).getFile(); }
    catch (e) {
      if (e.name === 'NotFoundError') return fail('There is no guesses.csv in the folder "' + dir.name + '". Choose the spotify-year folder.');
      return fail('Could not read guesses.csv: ' + e.message);
    }
    let art = null;
    try { art = await (await dir.getFileHandle('artist-info.json')).getFile(); }
    catch (e) { if (e.name !== 'NotFoundError') console.warn('artist-info.json:', e); }
    await readFiles(csv, art, 'folder', dir.name);
  }

  function fail(text) {
    status = { kind: 'error', text };
    render();
  }

  // Pick the spotify-year folder (first time, or to switch).
  async function choose() {
    if (!canRemember) { $('songs-file').click(); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ id: 'spotify-year', mode: 'read' }); }
    catch (e) {
      if (e.name !== 'AbortError') fail('Could not open the folder picker: ' + e.message);
      return;
    }
    await saveHandle('folder', dir);
    await forgetHandle('guesses');   // the single-file handle from before folders were supported
    await readFolder(dir);
  }

  async function ensurePermission(handle, interactive) {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted' && interactive) perm = await handle.requestPermission({ mode: 'read' });
    return perm === 'granted';
  }

  // Re-read the remembered folder (or the older single-file handle).
  // interactive = a click, which may ask for permission.
  async function refresh(interactive) {
    if (!canRemember) { if (interactive) $('songs-file').click(); return; }
    const dir = await getHandle('folder');
    const file = dir ? null : await getHandle('guesses');
    const handle = dir || file;
    if (!handle) { if (interactive) choose(); return; }
    if (!(await ensurePermission(handle, interactive))) {
      status = interactive
        ? { kind: 'error', text: 'Permission to read "' + handle.name + '" was not given, so the data below was not refreshed.' }
        : { kind: 'warn', text: 'Click Refresh to read the latest from "' + handle.name + '". Your browser asks once per session.' };
      render();
      return;
    }
    try {
      if (dir) await readFolder(dir);
      else await readFiles(await file.getFile(), null, 'file');
    } catch (e) {
      if (e.name === 'NotFoundError') {
        await forgetHandle(dir ? 'folder' : 'guesses');
        fail('"' + handle.name + '" is no longer where it was (moved, renamed or deleted). Choose the spotify-year folder again.');
      } else {
        fail('Could not read "' + handle.name + '": ' + e.message);
      }
    }
  }

  // ---------- stats ----------
  const absMean = rows => rows.reduce((a, r) => a + Math.abs(r.delta), 0) / rows.length;
  const round1 = v => Math.round(v * 10) / 10;
  const fmtYears = v => round1(v) + (round1(v) === 1 ? ' year' : ' years');
  const pct = (n, d) => Math.round(n / d * 100) + '%';
  const chrono = (a, b) => (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);
  const near = rows => rows.filter(r => Math.abs(r.delta) <= NEAR).length;
  const guesses = n => U.plural(n, 'guess', 'guesses');

  function groupBy(rows, keyFn) {
    const m = new Map();
    rows.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  }

  // ---------- rendering ----------
  function render() {
    if (!visible) return;
    renderSource();
    const wrap = $('songs-body');
    wrap.replaceChildren();
    $('songs-stats').replaceChildren();

    if (!data) {
      wrap.append(U.el('div', { class: 'panel songs-intro' },
        U.el('h2', { text: 'Connect your spotify-year folder' }),
        U.el('p', { text: 'This tab reads guesses.csv from your Spotify year overlay, plus artist-info.json if you have run Get-ArtistInfo.ps1, and charts how your guesses compare with the real release years. It only reads those files and never changes them.' }),
        U.el('p', { class: 'hint', text: canRemember
          ? 'Choose the folder once (C:\\Users\\WilliamTappa\\dev\\spotify-year). After that, this tab reads the latest files each time you open it.'
          : 'This browser cannot remember folders, so select guesses.csv (and artist-info.json, if you have it) each time you want fresh numbers. Edge or Chrome can remember the folder.' }),
        U.el('button', { type: 'button', class: 'primary-btn', text: canRemember ? 'Choose the spotify-year folder' : 'Choose the files', onclick: choose })));
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
    renderArtistBreakdowns(wrap, rows);
    renderRepeats(wrap, rows);
    renderArtists(wrap, rows);
    renderRecent(wrap, rows);
  }

  function renderSource() {
    const bar = $('songs-source');
    bar.replaceChildren();
    if (!data && !status) { bar.hidden = true; return; }
    bar.hidden = false;
    const info = U.el('div', { class: 'source-info' });
    const line = (text, cls) => { if (text) info.append(U.el('p', { class: 'source-line' + (cls ? ' ' + cls : ''), text })); };
    if (data) {
      line((data.via === 'folder' ? 'From the "' + data.folderName + '" folder, read ' : 'From ' + data.fileName + ', read ') +
        U.fmtStamp(new Date(data.readAt).toISOString()) +
        ' (guesses.csv last saved ' + U.fmtStamp(new Date(data.fileModified).toISOString()) + ').');
      // CLAIMS: coverage of the read. COUNTS: rows parsed vs rows in the file after the header.
      line(data.skipped.length
        ? 'Read ' + data.rows.length + ' of ' + data.totalRows + ' rows. Skipped: ' +
          data.skipped.slice(0, 5).map(s => 'line ' + s.line + ' (' + s.reason + ')').join('; ') +
          (data.skipped.length > 5 ? '; and ' + (data.skipped.length - 5) + ' more.' : '.')
        : 'Read all ' + U.plural(data.totalRows, 'row') + '.', 'muted');
      line(artistCoverage(), 'muted');
      if (data.artistsProblem) line(data.artistsProblem, 'warn');
      if (data.via === 'file') line(canRemember
        ? 'Connected to guesses.csv only. Choose the spotify-year folder instead to add genres and other artist details.'
        : 'Read guesses.csv only. Select artist-info.json along with it to add genres and other artist details.', 'warn');
    }
    if (status && status.text) info.append(U.el('p', { class: 'source-line ' + status.kind, role: status.kind === 'error' ? 'alert' : null, text: status.text }));
    const actions = U.el('div', { class: 'source-actions' },
      data || (status && status.kind === 'warn') ? U.el('button', { type: 'button', class: 'ghost-btn', text: 'Refresh', onclick: () => refresh(true) }) : null,
      U.el('button', { type: 'button', class: 'ghost-btn', text: data ? 'Choose a different folder' : 'Choose the spotify-year folder', onclick: choose }));
    bar.append(info, actions);
  }

  // CLAIMS: how many of the CSV's artists have MusicBrainz details.
  // COUNTS: distinct artist strings in the parsed rows, bucketed by infoFor().
  function artistCoverage() {
    const names = Array.from(new Set(data.rows.map(r => r.artist)));
    if (!data.artists) {
      return data.via === 'file' ? '' : 'No artist-info.json in the folder yet. Run Get-ArtistInfo.ps1 there to add genres, then refresh.';
    }
    const b = groupBy(names, n => { const r = infoFor(n); return r.bucket === 'found' ? (r.info.genres && r.info.genres.length ? 'genre' : 'nogenre') : r.bucket; });
    const n = k => (b.get(k) || []).length;
    const found = n('genre') + n('nogenre');
    let s = 'Artist details for ' + found + ' of ' + names.length + ' artists (' + n('genre') + ' with a genre).';
    if (n(NOT_LOOKED_UP)) s += ' ' + U.plural(n(NOT_LOOKED_UP), 'artist') + ' new since the last lookup; run Get-ArtistInfo.ps1 again.';
    if (n(FAILED)) s += ' ' + n(FAILED) + ' failed last time and will be retried when you run it.';
    if (n(NO_MATCH)) s += ' ' + n(NO_MATCH) + ' not found on MusicBrainz.';
    return s;
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
    const nearN = near(rows);
    // CLAIMS: "Average miss" = typical distance from the right year. COUNTS: mean |guess - actual|, exact guesses included as 0.
    const avg = absMean(rows);
    // CLAIMS: "Lean" = whether guesses run older or newer than the truth. COUNTS: mean of guess - actual.
    const bias = rows.reduce((a, r) => a + r.delta, 0) / n;
    const lean = Math.abs(bias) < 0.5 ? 'None' : fmtYears(Math.abs(bias)) + (bias > 0 ? ' newer' : ' older');
    const first = rows[0].date, last = rows[rows.length - 1].date;
    $('songs-sub').textContent = guesses(n) + ' from ' + U.fmtMed(first) + ' to ' + U.fmtMed(last) + '.';
    $('songs-stats').replaceChildren(
      stat('Guesses', String(n), U.plural(new Set(rows.map(r => r.artist)).size, 'artist')),
      stat('Exact', pct(exact, n), exact + ' of ' + n),
      stat('Within ' + NEAR + ' years', pct(nearN, n), nearN + ' of ' + n + ', exact included'),
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
    return { body, table: !!tableMode[id], el };
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
    const byDay = groupBy(rows, r => r.date);
    const days = Array.from(byDay.keys()).sort();
    const title = 'Average miss by day';
    // Weekends are left off the axis, like the cube chart. Weekend guesses still
    // count everywhere else on this page, and the subtitle says how many days are off the chart.
    const weekdays = days.filter(d => !C.isWeekend(U.dayNum(d)));
    const weekendDays = days.length - weekdays.length;
    if (weekdays.length < 2 && !weekendDays) return;   // one point is not a trend; the tiles cover it
    const sub = 'Years off, averaged over each weekday you played. Lower is better. Weekends are left off the axis, so Friday runs straight into Monday; gaps are weekdays with no guesses.' +
      (weekendDays ? ' ' + U.plural(weekendDays, 'weekend day') + ' with guesses ' + (weekendDays === 1 ? 'is' : 'are') + ' not on the chart; see the table.' : '');
    const c = card(wrap, 'daily', title, sub);
    if (c.table) {
      return C.table(c.body, ['Date', 'Guesses', 'Average miss', 'Within ' + NEAR + ' years'],
        days.slice().reverse().map(d => { const l = byDay.get(d); return [U.fmtMed(d), String(l.length), fmtYears(absMean(l)), pct(near(l), l.length)]; }));
    }
    if (!weekdays.length) {
      c.body.append(U.el('p', { class: 'chart-empty', text: 'Every guess so far was on a weekend, so there is nothing to plot on the weekday axis.' }));
      return;
    }
    // CLAIMS: "Average miss by day". COUNTS: mean |guess - actual| over that day's guesses.
    const pts = weekdays.map(d => ({ d: U.dayNum(d), y: round1(absMean(byDay.get(d))) }));
    C.line(c.body, {
      d0: U.dayNum(days[0]), d1: U.dayNum(days[days.length - 1]), skipWeekends: true,
      ariaLabel: title + ' chart, weekdays only. Use Show table for the values.',
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
    C.hbars(c.body, items, v => guesses(v));
  }

  function renderDecades(wrap, rows) {
    const byDec = groupBy(rows, r => Math.floor(r.actual / 10) * 10);
    const decs = Array.from(byDec.keys()).sort((a, b) => a - b);
    // CLAIMS: average miss for songs released in each decade. COUNTS: mean |guess - actual| grouped by decade of the actual year.
    const items = decs.map(d => ({ label: d + 's', value: round1(absMean(byDec.get(d))), n: byDec.get(d).length }));
    const c = card(wrap, 'decades', 'Average miss by decade',
      'Grouped by when the song actually came out, oldest first. Shorter bars mean you know that era better. Decades with only a guess or two can swing a lot.');
    if (c.table) return C.table(c.body, ['Decade', 'Guesses', 'Average miss'], items.map(i => [i.label, String(i.n), fmtYears(i.value)]));
    C.hbars(c.body, items, (v, i) => fmtYears(v) + ' (' + guesses(i.n) + ')');
  }

  // Average miss per bucket; known buckets by guess count, the don't-know ones last.
  function bucketItems(rows, bucketFn, limit) {
    const by = groupBy(rows, r => bucketFn(r.artist));
    const all = Array.from(by, ([label, list]) => ({
      label, value: round1(absMean(list)), n: list.length, nearN: near(list),
      artists: new Set(list.map(r => r.artist)).size, unknown: UNKNOWN_BUCKETS.includes(label) || /not on file/.test(label)
    }));
    const known = all.filter(i => !i.unknown).sort((a, b) => b.n - a.n || a.value - b.value);
    const unknown = all.filter(i => i.unknown).sort((a, b) => b.n - a.n);
    const shownKnown = limit ? known.slice(0, limit) : known;
    return { items: shownKnown.concat(unknown), knownTotal: known.length, all: known.concat(unknown) };
  }

  function renderArtistBreakdowns(wrap, rows) {
    if (!data.artists) {
      const c = card(wrap, 'genre', 'Accuracy by genre', '', { noToggle: true });
      c.body.append(U.el('p', { class: 'chart-empty', text: data.via === 'file'
        ? 'Genre, band or solo, and country need artist-info.json from the spotify-year folder. ' + (canRemember ? 'Choose the folder (not just guesses.csv) with the button at the top.' : 'Select it along with guesses.csv.')
        : 'Genre, band or solo, and country come from artist-info.json, which is not in the folder yet. Run Get-ArtistInfo.ps1 in the spotify-year folder, then click Refresh.' }));
      return;
    }
    const tableCols = ['Group', 'Guesses', 'Artists', 'Average miss', 'Within ' + NEAR + ' years'];
    const toRow = i => [i.label, String(i.n), String(i.artists), fmtYears(i.value), pct(i.nearN, i.n)];
    const tip = (v, i) => fmtYears(v) + ' (' + guesses(i.n) + ')';

    // Genre family
    const g = bucketItems(rows, genreBucket);
    const gc = card(wrap, 'genre', 'Average miss by genre',
      'Each artist counts in one genre family, from its most-voted MusicBrainz genre. Ordered by number of guesses; artists without genre details are listed last, by reason.');
    if (gc.table) C.table(gc.body, tableCols, g.all.map(toRow));
    else C.hbars(gc.body, g.items, tip);

    // Band vs solo
    const t = bucketItems(rows, typeBucket);
    const tc = card(wrap, 'type', 'Bands against solo artists', 'Average miss by whether MusicBrainz lists the artist as a group or a person.');
    if (tc.table) C.table(tc.body, tableCols, t.all.map(toRow));
    else C.hbars(tc.body, t.items, tip);

    // Country
    const k = bucketItems(rows, countryBucket, TOP_COUNTRIES);
    const kc = card(wrap, 'country', 'Artist country',
      (k.knownTotal > TOP_COUNTRIES ? 'Top ' + TOP_COUNTRIES + ' of ' + k.knownTotal + ' countries' : 'Every country') +
      ' by number of guesses, with your average miss. From the country MusicBrainz lists for the artist, not where the song was recorded.');
    if (kc.table) C.table(kc.body, tableCols, k.all.map(toRow));
    else C.hbars(kc.body, k.items, tip);
  }

  // Songs guessed more than once. After the first reveal, later guesses test memory.
  function renderRepeats(wrap, rows) {
    const bySong = groupBy(rows, r => r.uri || (r.track + '|' + r.artist).toLowerCase());
    const repeats = Array.from(bySong.values()).filter(l => l.length > 1)
      .sort((a, b) => chrono(b[b.length - 1], a[a.length - 1]));   // most recently re-guessed first
    const title = 'Songs you guessed again';
    if (!repeats.length) {
      const c = card(wrap, 'repeats', title, '', { noToggle: true });
      c.body.append(U.el('p', { class: 'chart-empty', text: 'No song has come up twice yet. When one does, this shows whether you remembered it.' }));
      return;
    }
    // CLAIMS: closer / same / further on the latest guess. COUNTS: |delta| of the latest guess vs the first, per song.
    const verdict = l => {
      const a = Math.abs(l[0].delta), b = Math.abs(l[l.length - 1].delta);
      return b < a ? 'closer' : b > a ? 'further' : 'same';
    };
    const v = groupBy(repeats, verdict);
    const cnt = k => (v.get(k) || []).length;
    const c = card(wrap, 'repeats', title,
      U.plural(repeats.length, 'song') + ' came up more than once. On the latest try you were closer on ' + cnt('closer') +
      ', the same on ' + cnt('same') + ' and further off on ' + cnt('further') +
      '. You had seen the answer after the first guess, so later tries test your memory.', { noToggle: true });
    const list = U.el('ul', { class: 'repeat-list' });
    repeats.forEach(l => {
      const last = l[l.length - 1];
      const vd = verdict(l);
      const sameActual = l.every(r => r.actual === last.actual);
      list.append(U.el('li', { class: 'repeat' },
        U.el('div', { class: 'repeat-head' },
          U.el('span', { class: 'repeat-song', text: last.track }),
          U.el('span', { class: 'repeat-artist', text: last.artist + (sameActual ? ', released ' + last.actual : '') }),
          U.el('span', { class: 'repeat-verdict v-' + vd, text: vd === 'closer' ? 'Got closer' : vd === 'further' ? 'Further off' : 'Same distance' })),
        U.el('ol', { class: 'repeat-tries' }, l.map((r, i) => U.el('li', { class: 'try' + (r.delta === 0 ? ' exact' : Math.abs(r.delta) <= NEAR ? ' near' : '') },
          U.el('span', { class: 'try-n', text: ordinal(i + 1) + ', ' + U.fmtShort(r.date) }),
          U.el('span', { class: 'try-guess', text: String(r.guess) }),
          U.el('span', { class: 'try-off', text: offText(r.delta) + (sameActual ? '' : ' of ' + r.actual) }))))));
    });
    c.body.append(list);
  }

  const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

  function renderArtists(wrap, rows) {
    const by = groupBy(rows, r => r.artist);
    const all = Array.from(by, ([artist, list]) => ({ label: artist, value: list.length, avg: absMean(list), genre: data.artists ? genreBucket(artist) : '' }))
      .sort((a, b) => b.value - a.value || a.avg - b.avg || a.label.localeCompare(b.label));
    const top = all.slice(0, TOP_ARTISTS);
    const c = card(wrap, 'artists', 'Most-guessed artists',
      (all.length > TOP_ARTISTS ? 'Top ' + TOP_ARTISTS + ' of ' + all.length + ' artists' : 'All ' + U.plural(all.length, 'artist')) +
      ' by number of guesses, with your average miss for each. The table lists every artist.');
    if (c.table) {
      return C.table(c.body, data.artists ? ['Artist', 'Guesses', 'Average miss', 'Genre family'] : ['Artist', 'Guesses', 'Average miss'],
        all.map(a => [a.label, String(a.value), fmtYears(a.avg)].concat(data.artists ? [a.genre] : [])));
    }
    C.hbars(c.body, top, (v, i) => guesses(v) + ', off by ' + fmtYears(i.avg) + ' on average');
  }

  function renderRecent(wrap, rows) {
    const latest = rows.slice().reverse();
    const shown = showAllRecent ? latest : latest.slice(0, RECENT_SHOWN);
    const c = card(wrap, 'recent', 'Recent guesses',
      shown.length < latest.length ? 'The latest ' + shown.length + ' of ' + latest.length + ' guesses.' : 'All ' + guesses(latest.length) + ', newest first.',
      { noToggle: true });
    C.table(c.body, ['When', 'Song', 'Artist', 'Guess', 'Actual', 'Off by'],
      shown.map(r => [U.fmtShort(r.date) + ' ' + r.time.slice(0, 5), r.track, r.artist, String(r.guess), String(r.actual), offText(r.delta)]));
    c.body.style.maxHeight = 'none';   // the list is already capped; no scroll box inside the page
    if (latest.length > RECENT_SHOWN) {
      c.el.append(U.el('button', {
        type: 'button', class: 'ghost-btn show-more',
        text: showAllRecent ? 'Show the latest ' + RECENT_SHOWN + ' only' : 'Show all ' + latest.length,
        onclick: () => { showAllRecent = !showAllRecent; render(); }
      }));
    }
  }

  // ---------- init ----------
  function init() {
    data = S.load(CACHE_KEY, null);
    // A cache written before folders were supported has no artist fields.
    if (data && !('via' in data)) Object.assign(data, { via: 'file', folderName: null, artists: null, artistsModified: null, artistsProblem: null });
    $('songs-file').addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      const csv = files.find(f => /\.csv$/i.test(f.name));
      const art = files.find(f => /artist-info\.json$/i.test(f.name));
      if (!csv) { if (files.length) fail('Select guesses.csv (and optionally artist-info.json).'); return; }
      await readFiles(csv, art || null, art ? 'picked' : 'file');
    });
    window.addEventListener('resize', U.debounce(render, 150));
  }

  return {
    init,
    onShow() { visible = true; render(); refresh(false); },
    onHide() { visible = false; },
    // exposed for the test pages
    _normalize: normalize, _parseArtists: parseArtists, _familyOf: familyOf
  };
})();
