// Trends: charts built from saved days and solves. One date-range filter at
// the top scopes every stat and chart below it.
window.App = window.App || {};

App.trends = (function () {
  const U = App.util;
  const CS = App.cubeStats;
  const store = App.store;
  const C = App.charts;
  const $ = id => document.getElementById(id);

  let range = '30';
  const tableMode = {};   // chart id -> showing table instead of chart

  function bounds() {
    const t = U.dayNum(U.today());
    if (range !== 'all') return { d0: t - Number(range) + 1, d1: t };
    // All time starts at the earliest day with either an entry or a solve.
    const firsts = [];
    const days = store.listDays();
    const solves = store.listSolves();
    if (days.length) firsts.push(U.dayNum(days[0].date));
    if (solves.length) firsts.push(U.dayNum(solves[0].date));
    return { d0: firsts.length ? Math.min(...firsts, t) : t, d1: t };
  }

  function stat(label, value, note) {
    return U.el('div', { class: 'stat' },
      U.el('p', { class: 'stat-label', text: label }),
      U.el('p', { class: 'stat-value', text: value }),
      note ? U.el('p', { class: 'stat-note', text: note }) : null);
  }

  // A chart card with a title, subtitle, optional legend and a chart/table toggle.
  function card(id, title, sub, opts) {
    opts = opts || {};
    const body = U.el('div');
    const toggle = U.el('button', {
      type: 'button', class: 'ghost-btn chart-toggle',
      text: tableMode[id] ? 'Show chart' : 'Show table',
      onclick: () => { tableMode[id] = !tableMode[id]; render(); }
    });
    const el = U.el('section', { class: 'panel chart-card' + (opts.plastic ? ' on-plastic' : ''), 'aria-labelledby': id + '-h' },
      U.el('div', { class: 'chart-head' },
        U.el('div', null, U.el('h2', { id: id + '-h', text: title }), U.el('p', { class: 'chart-sub', text: sub })),
        opts.noToggle ? null : toggle),
      opts.legend && !tableMode[id] ? opts.legend : null,
      body);
    $('trend-charts').append(el);
    return { body, table: !!tableMode[id] };
  }

  function emptyCard(title, msg, plastic) {
    $('trend-charts').append(U.el('section', { class: 'panel chart-card' + (plastic ? ' on-plastic' : '') },
      U.el('h2', { text: title }), U.el('p', { class: 'chart-empty', text: msg })));
  }

  function legend(items) {
    return U.el('div', { class: 'legend' }, items.map(i =>
      U.el('span', null, U.el('i', { class: i.kind, style: i.color ? '--c:' + i.color : null }), i.label)));
  }

  function render() {
    const { d0, d1 } = bounds();
    const inRange = ds => { const n = U.dayNum(ds); return n >= d0 && n <= d1; };
    const days = store.listDays().filter(d => inRange(d.date));
    const solves = store.listSolves().filter(s => inRange(s.date));
    const span = d1 - d0 + 1;
    const unit = store.getSetting('tempUnit');
    const rangeText = U.fmtMed(U.fromDayNum(d0)) + ' to ' + U.fmtMed(U.fromDayNum(d1));

    document.querySelectorAll('#range-row [data-range]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === range)));
    $('trends-sub').textContent = 'Showing ' + rangeText + '.';

    // ---- stat tiles (all scoped to the range) ----
    // CLAIMS: "Days logged" = days in this range with a journal entry, out of the days in the range.
    // COUNTS: saved days whose date falls in [d0, d1], over (d1 - d0 + 1) calendar days.
    const temps = days.filter(d => d.feelsF != null);
    // CLAIMS: "Average feels-like" = mean of the feels-like temperatures recorded in this range.
    // COUNTS: mean feelsF over days in range that have one; days without are left out and counted in the note.
    const avgF = temps.length ? temps.reduce((a, d) => a + d.feelsF, 0) / temps.length : null;
    const best = CS.best(solves);
    $('trend-stats').replaceChildren(
      stat('Days logged', String(days.length), 'of ' + U.plural(span, 'day') + ' in this range'),
      stat('Average feels-like', avgF == null ? '--' : U.displayTemp(avgF, unit) + '°' + unit,
        avgF == null ? (days.length ? 'No temperatures recorded in this range' : 'Nothing logged in this range')
          : 'from ' + U.plural(temps.length, 'day')),
      stat('Cube solves', String(solves.length), solves.length ? U.plural(new Set(solves.map(s => s.date)).size, 'day') + ' with solves' : 'None in this range'),
      stat('Best single', solves.length ? (best == null ? 'DNF' : U.fmtMs(best)) : '--', solves.length ? (best == null ? 'Every solve in this range is a DNF' : 'fastest in this range') : null));

    $('trend-charts').replaceChildren();
    renderTemp(days, d0, d1, unit);
    renderFeel(days, d0, d1);
    renderSolveTimes(solves, d0, d1);
    renderSolveCounts(solves, d0, d1);
    renderTags(days);
  }

  function renderTemp(days, d0, d1, unit) {
    const title = 'Feels-like temperature';
    const pts = days.filter(d => d.feelsF != null).map(d => ({ d: U.dayNum(d.date), y: U.displayTemp(d.feelsF, unit), date: d.date }));
    if (!days.length) return emptyCard(title, 'No days logged in this range. Log a day in the journal to start this chart.');
    if (!pts.length) return emptyCard(title, U.plural(days.length, 'day') + ' logged in this range, but none has a feels-like temperature yet.');
    const c = card('temp', title, 'Degrees ' + (unit === 'C' ? 'Celsius' : 'Fahrenheit') + ', one point per logged day. Gaps are days without a temperature.');
    if (c.table) return C.table(c.body, ['Date', 'Feels like', 'In words'], pts.slice().reverse().map(p => [U.fmtMed(p.date), p.y + '°' + unit, U.tempWord(unit === 'C' ? U.cToF(p.y) : p.y)]));
    C.line(c.body, {
      d0, d1, ariaLabel: title + ' chart. Use Show table for the values.',
      series: [{ label: 'feels like', color: 'var(--series-1)', points: pts }],
      yFmt: v => v + '°'
    });
  }

  function renderFeel(days, d0, d1) {
    const title = 'How the weather felt';
    const byDate = new Map(days.map(d => [U.dayNum(d.date), d]));
    const rated = days.filter(d => Object.keys(d.q).length);
    if (!days.length) return emptyCard(title, 'No days logged in this range.', true);
    if (!rated.length) return emptyCard(title, U.plural(days.length, 'day') + ' logged in this range, but no weather qualities rated yet.', true);
    const c = card('feel', title, 'Each column is a day, each row a quality. Brighter squares mean you felt it more. Hover a square for details.', {
      plastic: true,
      legend: U.el('div', { class: 'legend' },
        U.el('span', null, 'less'),
        [1, 2, 3, 4, 5].map(v => U.el('span', null, U.el('i', { class: 'key-box', style: '--c:var(--i' + v + ')' }), String(v))),
        U.el('span', null, 'more'),
        U.el('span', null, U.el('i', { class: 'key-empty' }), 'blank or no entry'))
    });
    if (c.table) {
      return C.table(c.body, ['Date'].concat(App.QUALITIES.map(q => q.name)),
        rated.slice().reverse().map(d => [U.fmtMed(d.date)].concat(App.QUALITIES.map(q => d.q[q.key] ? String(d.q[q.key]) : ''))));
    }
    C.heatmap(c.body, {
      d0, d1, rows: App.QUALITIES, ariaLabel: title + ' heatmap. Use Show table for the values.',
      cell: (key, dn) => { const d = byDate.get(dn); return { v: d ? d.q[key] : null, logged: !!d }; }
    });
  }

  function renderSolveTimes(solves, d0, d1) {
    const title = 'Solve times';
    if (!solves.length) return emptyCard(title, 'No cube solves in this range. Time one on the Cube timer page.');
    const best = [], mean = [], rows = [];
    let allDnfDays = 0;
    CS.byDay(solves).forEach((list, date) => {
      const d = U.dayNum(date);
      // CLAIMS: "Daily best" = fastest completed solve that day. "Daily mean" = mean of that day's completed solves.
      // COUNTS: CS.best / CS.meanCompleted over solves dated that day (+2 applied, DNF excluded).
      const b = CS.best(list), m = CS.meanCompleted(list);
      if (b == null) { allDnfDays++; rows.push([date, 'DNF', 'DNF', String(list.length)]); return; }
      best.push({ d, y: b / 1000 });
      mean.push({ d, y: m / 1000 });
      rows.push([date, U.fmtMs(b), U.fmtMs(m), String(list.length)]);
    });
    const sub = 'Seconds, per day with solves. DNFs are left out of both lines' +
      (allDnfDays ? '; ' + U.plural(allDnfDays, 'day') + ' with only DNFs has no point.' : '.');
    const c = card('solves', title, sub, {
      legend: legend([
        { kind: 'key-line', color: 'var(--series-1)', label: 'Daily best' },
        { kind: 'key-line', color: 'var(--series-2)', label: 'Daily mean' }])
    });
    if (c.table) return C.table(c.body, ['Date', 'Best', 'Mean', 'Solves'], rows.sort((a, b) => b[0].localeCompare(a[0])).map(r => [U.fmtMed(r[0])].concat(r.slice(1))));
    if (!best.length) { c.body.append(U.el('p', { class: 'chart-empty', text: 'Every solve in this range is a DNF, so there is nothing to plot.' })); return; }
    C.line(c.body, {
      d0, d1, ariaLabel: title + ' chart. Use Show table for the values.',
      series: [
        { label: 'daily best', color: 'var(--series-1)', points: best },
        { label: 'daily mean', color: 'var(--series-2)', points: mean }],
      yFmt: (v, full) => full ? U.fmtMs(v * 1000) : String(v)
    });
  }

  function renderSolveCounts(solves, d0, d1) {
    const title = 'Solves per day';
    if (!solves.length) return; // the solve-times card already says there are none
    const pts = [];
    CS.byDay(solves).forEach((list, date) => {
      const dnf = CS.dnfCount(list);
      pts.push({ d: U.dayNum(date), y: list.length, date, detail: dnf ? 'including ' + dnf + ' DNF' : 'solves' });
    });
    const c = card('counts', title, 'Every solve logged on each day, DNFs included.');
    if (c.table) return C.table(c.body, ['Date', 'Solves', 'DNFs'], pts.slice().sort((a, b) => b.d - a.d).map(p => [U.fmtMed(p.date), String(p.y), String(CS.dnfCount(solves.filter(s => s.date === p.date)))]));
    C.columns(c.body, {
      d0, d1, points: pts, color: 'var(--series-1)', ariaLabel: title + ' chart. Use Show table for the values.',
      yFmt: (v, full) => full ? U.plural(v, 'solve') : String(v)
    });
  }

  function renderTags(days) {
    const title = 'Tags';
    const counts = new Map();
    days.forEach(d => d.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    if (!days.length) return;
    if (!counts.size) return emptyCard(title, U.plural(days.length, 'day') + ' logged in this range, none tagged yet.');
    // Every tag used in the range is listed; no cap.
    const items = Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const c = card('tags', title, 'Number of days in this range each tag was used.');
    if (c.table) return C.table(c.body, ['Tag', 'Days'], items.map(i => [i.label, String(i.value)]));
    C.hbars(c.body, items, v => U.plural(v, 'day'));
  }

  const onResize = U.debounce(() => { if (visible) render(); }, 150);
  let visible = false;

  function init() {
    document.querySelectorAll('#range-row [data-range]').forEach(b =>
      b.addEventListener('click', () => { range = b.dataset.range; render(); }));
    window.addEventListener('resize', onResize);
    store.on(() => { if (visible) render(); });
  }

  return {
    init,
    onShow() { visible = true; render(); },
    onHide() { visible = false; }
  };
})();
