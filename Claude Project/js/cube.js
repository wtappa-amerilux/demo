// Cube timer and solve log. Timed solves are dated today; past solves can be
// logged against any earlier date from the form.
window.App = window.App || {};

App.cube = (function () {
  const U = App.util;
  const CS = App.cubeStats;
  const store = App.store;
  const $ = id => document.getElementById(id);

  const HOLD_MS = 300;     // how long to hold before the timer is armed
  const DAYS_SHOWN = 14;   // solve-log days rendered before "Show all"

  let state = 'idle';      // idle | holding | ready | running
  let holdTimer = null;
  let startedAt = 0;
  let raf = 0;
  let lastId = null;
  let showAllDays = false;
  let active = false;      // true while the cube view is on screen

  function setState(s) {
    state = s;
    $('timer').dataset.state = s;
    $('timer-hint').textContent = {
      idle: 'Hold to get ready',
      holding: 'Keep holding',
      ready: 'Let go to start',
      running: ''
    }[s];
  }

  // ---------- timer input ----------
  function press() {
    if (state === 'running') { stop(); return; }
    if (state !== 'idle') return;
    setState('holding');
    $('timer-time').textContent = '0.00';
    holdTimer = setTimeout(() => setState('ready'), HOLD_MS);
  }

  function release() {
    clearTimeout(holdTimer);
    if (state === 'ready') start();
    else if (state === 'holding') setState('idle');
  }

  function start() {
    setState('running');
    startedAt = performance.now();
    const tick = () => {
      $('timer-time').textContent = U.fmtMs(performance.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop(byKey) {
    cancelAnimationFrame(raf);
    const ms = Math.round(performance.now() - startedAt);
    $('timer-time').textContent = U.fmtMs(ms);
    setState('idle');
    // The key that stopped the timer must not re-arm it before it is released.
    suppressUntilKeyup = !!byKey;
    const solve = store.addSolve({ date: U.today(), ms });
    if (!solve) { App.toast('Solve not saved: browser storage is unavailable'); return; }
    lastId = solve.id;
    renderLast();
  }

  let suppressUntilKeyup = false;

  function typingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function onKeyDown(e) {
    if (!active || typingTarget(e.target)) return;
    if (state === 'running') { e.preventDefault(); stop(true); return; }
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (e.repeat || suppressUntilKeyup) return;
    press();
  }

  function onKeyUp(e) {
    if (!active || typingTarget(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (suppressUntilKeyup) { suppressUntilKeyup = false; return; }
      release();
    } else {
      suppressUntilKeyup = false;
    }
  }

  // ---------- last solve quick actions ----------
  function renderLast() {
    const box = $('last-solve');
    const s = lastId && store.listSolves().find(x => x.id === lastId);
    if (!s) { box.hidden = true; return; }
    box.hidden = false;
    $('last-solve-text').textContent = 'Last solve ' + CS.fmtSolve(s);
    box.querySelectorAll('[data-last]').forEach(b => {
      if (b.dataset.last !== 'delete') b.setAttribute('aria-pressed', String(s.penalty === b.dataset.last));
    });
  }

  function lastAction(kind) {
    const s = store.listSolves().find(x => x.id === lastId);
    if (!s) return;
    if (kind === 'delete') {
      store.deleteSolve(s.id);
      lastId = null;
      $('timer-time').textContent = '0.00';
      App.toast('Solve deleted');
    } else {
      store.updateSolve(s.id, { penalty: s.penalty === kind ? 'none' : kind });
    }
    renderLast();
  }

  // ---------- stats ----------
  function stat(label, value, note) {
    return U.el('div', { class: 'stat' },
      U.el('p', { class: 'stat-label', text: label }),
      U.el('p', { class: 'stat-value', text: value }),
      note ? U.el('p', { class: 'stat-note', text: note }) : null);
  }

  function avgNote(a, all, n) {
    if (a.status === 'short') return U.plural(n - a.have, 'more solve') + ' needed';
    if (a.status === 'dnf') return CS.dnfCount(all.slice(-n)) + ' DNFs in the last ' + n + ', so the average is a DNF';
    return null;
  }

  function renderStats() {
    const all = store.listSolves();
    const todays = all.filter(s => s.date === U.today());
    const wrap = $('cube-stats');
    if (!all.length) {
      wrap.replaceChildren(stat('Solves', '0', 'Your first timed solve will show up here.'));
      return;
    }
    // CLAIMS: "Best single" = fastest completed solve ever logged.
    // COUNTS: min effective time (+2 applied, DNF excluded) over every solve.
    const best = CS.best(all);
    // CLAIMS: "Current ao5 / ao12" = average of your most recent 5 / 12 solves.
    // COUNTS: last 5 / 12 by solve date then time recorded, best and worst dropped.
    const a5 = CS.averageOf(all, 5);
    const a12 = CS.averageOf(all, 12);
    // CLAIMS: "Today" mean = mean of today's completed solves.
    // COUNTS: solves dated today, DNFs excluded from the mean and reported separately.
    const tMean = CS.meanCompleted(todays);
    const tDnf = CS.dnfCount(todays);

    wrap.replaceChildren(
      stat('Best single', best == null ? 'DNF' : U.fmtMs(best), best == null ? 'Every solve so far is a DNF.' : null),
      stat('Current ao5', CS.fmtAverage(a5) || '--', avgNote(a5, all, 5)),
      stat('Current ao12', CS.fmtAverage(a12) || '--', avgNote(a12, all, 12)),
      stat('Today', todays.length ? (tMean == null ? 'DNF' : U.fmtMs(tMean)) : '--',
        todays.length
          ? 'Mean of ' + U.plural(todays.length - tDnf, 'completed solve') + (tDnf ? ', plus ' + tDnf + ' DNF' : '')
          : 'No solves today yet'),
      stat('All solves', String(all.length), U.plural(new Set(all.map(s => s.date)).size, 'day') + ' with solves'));
  }

  // ---------- solve log ----------
  function renderLog() {
    const wrap = $('solve-days');
    const byDay = CS.byDay(store.listSolves());
    const dates = Array.from(byDay.keys()).sort().reverse();
    wrap.replaceChildren();
    if (!dates.length) {
      wrap.append(U.el('p', { class: 'empty', text: 'No solves logged yet. Time one above, or log a past solve.' }));
      return;
    }
    wrap.append(U.el('h2', { text: 'Solve log', style: 'margin-bottom:0.75rem' }));
    const shown = showAllDays ? dates : dates.slice(0, DAYS_SHOWN);
    shown.forEach(d => {
      const list = byDay.get(d);
      const best = CS.best(list);
      const mean = CS.meanCompleted(list);
      const dnf = CS.dnfCount(list);
      const summary = U.plural(list.length, 'solve') +
        (best == null ? ', all DNF' : ', best ' + U.fmtMs(best) + ', mean ' + U.fmtMs(mean)) +
        (dnf && best != null ? ' (' + dnf + ' DNF left out)' : '');
      const table = U.el('table', { class: 'solve-table' });
      list.forEach((s, i) => table.append(solveRow(s, i + 1)));
      wrap.append(U.el('section', { class: 'solve-day' },
        U.el('div', { class: 'solve-day-head' },
          U.el('h3', { text: d === U.today() ? 'Today' : U.fmtMed(d) }),
          U.el('p', { text: summary })),
        table));
    });
    if (dates.length > DAYS_SHOWN) {
      wrap.append(U.el('button', {
        type: 'button', class: 'ghost-btn show-more',
        text: showAllDays ? 'Show the latest ' + DAYS_SHOWN + ' days only' : 'Showing ' + DAYS_SHOWN + ' of ' + dates.length + ' days. Show all',
        onclick: () => { showAllDays = !showAllDays; renderLog(); }
      }));
    }
  }

  function solveRow(s, n) {
    const penBtn = kind => U.el('button', {
      type: 'button', class: 'ghost-btn', text: kind === 'dnf' ? 'DNF' : '+2',
      'aria-pressed': String(s.penalty === kind),
      'aria-label': (kind === 'dnf' ? 'Mark as DNF' : 'Add two-second penalty') + ' for solve ' + n,
      onclick: () => store.updateSolve(s.id, { penalty: s.penalty === kind ? 'none' : kind })
    });
    const note = U.el('input', {
      type: 'text', value: s.note, maxlength: '200', placeholder: 'Add a note', 'aria-label': 'Note for solve ' + n,
      onchange: e => { store.updateSolve(s.id, { note: e.target.value.trim() }); App.toast('Note saved'); }
    });
    return U.el('tr', null,
      U.el('td', { class: 'solve-n', text: String(n) }),
      U.el('td', { class: 'solve-time' + (s.penalty === 'dnf' ? ' dnf' : ''), text: CS.fmtSolve(s), title: s.penalty === 'dnf' ? 'DNF (' + U.fmtMs(s.ms) + ')' : null }),
      U.el('td', { class: 'solve-pen' }, penBtn('+2'), ' ', penBtn('dnf')),
      U.el('td', { class: 'solve-note' }, note),
      U.el('td', { class: 'solve-del' }, U.el('button', {
        type: 'button', class: 'delete-x', text: 'Delete', 'aria-label': 'Delete solve ' + n,
        onclick: () => { if (confirm('Delete this ' + CS.fmtSolve(s) + ' solve?')) store.deleteSolve(s.id); }
      })));
  }

  // ---------- past solve form ----------
  function initPastForm() {
    const dateIn = $('ps-date');
    dateIn.value = U.today();
    dateIn.max = U.today();
    $('past-solve-form').addEventListener('submit', e => {
      e.preventDefault();
      const err = $('ps-error');
      const d = dateIn.value;
      if (!U.isValidYmd(d)) { err.textContent = 'Pick a date for the solve.'; return; }
      if (d > U.today()) { err.textContent = 'Solves can\'t be logged in the future.'; return; }
      const ms = U.parseTime($('ps-time').value);
      if (ms == null) { err.textContent = 'Enter the time as seconds (83.45) or minutes and seconds (1:23.45).'; return; }
      err.textContent = '';
      const saved = store.addSolve({ date: d, ms, penalty: $('ps-penalty').value, note: $('ps-note').value.trim() });
      if (!saved) { err.textContent = 'Not saved: browser storage is unavailable.'; return; }
      $('ps-time').value = '';
      $('ps-note').value = '';
      $('ps-penalty').value = 'none';
      App.toast('Solve added to ' + (d === U.today() ? 'today' : U.fmtMed(d)));
      $('ps-time').focus();
    });
  }

  function render() { renderStats(); renderLog(); renderLast(); }

  function init() {
    const timer = $('timer');
    timer.addEventListener('pointerdown', e => { e.preventDefault(); timer.setPointerCapture(e.pointerId); press(); });
    timer.addEventListener('pointerup', () => release());
    timer.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (state !== 'running') setState('idle'); });
    // Space on the focused button would also fire a click; the key handlers own it.
    timer.addEventListener('click', e => e.preventDefault());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    $('last-solve').addEventListener('click', e => { const k = e.target.dataset && e.target.dataset.last; if (k) lastAction(k); });
    initPastForm();
    store.on(what => { if (what === 'solves') render(); });
    render();
  }

  return {
    init,
    onShow() { active = true; $('ps-date').max = U.today(); render(); },
    onHide() {
      active = false;
      if (state === 'running') { cancelAnimationFrame(raf); $('timer-time').textContent = '0.00'; App.toast('Timer stopped without saving'); }
      clearTimeout(holdTimer);
      setState('idle');
    }
  };
})();
