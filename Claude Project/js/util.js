// Shared helpers: local dates, time formatting, temperature, DOM building.
// Dates are local calendar days as "YYYY-MM-DD" strings. Never toISOString()
// for a date: that is UTC and shifts the day for anyone west of Greenwich
// in the evening.
window.App = window.App || {};

App.util = (function () {
  const pad = n => String(n).padStart(2, '0');

  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());

  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Whole-day number, DST-proof (computed in UTC from the calendar parts).
  function dayNum(s) {
    const [y, m, d] = s.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function fromDayNum(n) {
    const d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  const addDays = (s, n) => fromDayNum(dayNum(s) + n);
  const isValidYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s;

  const fmtLong = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtMed = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const fmtShort = s => parseYmd(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtClock = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtStamp = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // Solve time in ms -> "1:05.23" or "23.45". Non-finite means DNF.
  function fmtMs(ms) {
    if (ms == null || !isFinite(ms)) return 'DNF';
    const cs = Math.round(ms / 10);
    const m = Math.floor(cs / 6000);
    const s = (cs % 6000) / 100;
    return m ? m + ':' + s.toFixed(2).padStart(5, '0') : s.toFixed(2);
  }

  // "1:23.45", "83.45", "83" -> ms. Returns null when unparseable or not positive.
  function parseTime(str) {
    const m = String(str).trim().match(/^(?:(\d+):)?(\d+(?:\.\d{1,3})?)$/);
    if (!m) return null;
    const min = m[1] ? Number(m[1]) : 0;
    const sec = Number(m[2]);
    if (m[1] && sec >= 60) return null;
    const ms = Math.round((min * 60 + sec) * 1000);
    return ms > 0 ? ms : null;
  }

  const fToC = f => (f - 32) * 5 / 9;
  const cToF = c => c * 9 / 5 + 32;
  // Temperatures are stored in F; displayed in the user's unit, whole degrees.
  const displayTemp = (f, unit) => Math.round(unit === 'C' ? fToC(f) : f);

  // How a feels-like temperature reads in words. Thresholds in F.
  function tempWord(f) {
    if (f == null) return '';
    if (f < 10) return 'Brutal';
    if (f < 32) return 'Biting';
    if (f < 45) return 'Raw';
    if (f < 58) return 'Brisk';
    if (f < 70) return 'Mild';
    if (f < 80) return 'Warm';
    if (f < 92) return 'Balmy';
    return 'Oven';
  }

  // Tiny DOM builder. Text always goes in via textContent, never innerHTML.
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.setAttribute('style', v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : String(c)); });
    return e;
  }

  function debounce(fn, ms) {
    let t;
    const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  const plural = (n, word, many) => n + ' ' + (n === 1 ? word : (many || word + 's'));

  return {
    ymd, today, parseYmd, dayNum, fromDayNum, addDays, isValidYmd,
    fmtLong, fmtMed, fmtShort, fmtClock, fmtStamp, fmtMs, parseTime,
    fToC, cToF, displayTemp, tempWord, el, debounce, plural
  };
})();

// Brief confirmation message at the bottom of the screen.
App.toast = (function () {
  let t;
  return function (msg) {
    const box = document.getElementById('toast');
    if (!box) return;
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(t);
    t = setTimeout(() => { box.hidden = true; }, 2600);
  };
})();
