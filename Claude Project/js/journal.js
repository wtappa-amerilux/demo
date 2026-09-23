// Journal: one entry per date. Any past date can be opened (backdating) with
// the arrows, the date picker or the calendar. Changes save automatically.
window.App = window.App || {};

App.journal = (function () {
  const U = App.util;
  const store = App.store;
  const Q = App.QUALITIES;

  let date = U.today();
  let day = null;          // working copy of the open day
  let calMonth = null;     // "YYYY-MM" shown in the calendar
  let dirty = false;       // edits not yet written; only then is a save due
  const $ = id => document.getElementById(id);

  const persist = U.debounce(() => {
    dirty = false;
    const ok = store.saveDay(day);
    // Re-read so a day emptied out (and therefore removed) resets its timestamps.
    day = store.getDay(date);
    setStatus(ok ? 'saved' : 'error');
    renderCalendar();
    renderMeta();
  }, 400);

  function touch() {
    dirty = true;
    setStatus('saving');
    persist();
    renderFace();
  }

  function setStatus(state) {
    const el = $('save-status');
    el.classList.toggle('error', state === 'error');
    if (state === 'saving') el.textContent = 'Saving';
    else if (state === 'error') el.textContent = 'Not saved. This browser is blocking storage or is full.';
    else if (store.hasDay(date)) el.textContent = 'Saved ' + U.fmtStamp(store.getDay(date).updatedAt);
    else el.textContent = 'Nothing logged for this day yet';
  }

  // ---------- open a date ----------
  function open(newDate) {
    if (!U.isValidYmd(newDate)) return;
    if (newDate > U.today()) newDate = U.today();
    if (dirty) persist.flush();   // write pending edits to the day being left
    date = newDate;
    day = store.getDay(date);
    calMonth = date.slice(0, 7);
    renderAll();
  }

  function renderAll() {
    const isToday = date === U.today();
    $('day-picker').value = date;
    $('day-picker').max = U.today();
    $('day-next').disabled = isToday;
    $('day-today').hidden = isToday;
    $('day-title').textContent = isToday ? 'Today' : U.fmtLong(date);

    const unit = store.getSetting('tempUnit');
    $('feels-input').value = day.feelsF == null ? '' : U.displayTemp(day.feelsF, unit);
    document.querySelectorAll('[data-unit]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.unit === unit)));
    $('temp-word').textContent = U.tempWord(day.feelsF);

    $('entry-title').value = day.title;
    $('entry-body').value = day.body;

    renderQualities();
    renderFace();
    renderTags();
    renderNotes();
    renderCalendar();
    renderMeta();
    setStatus('saved');
  }

  // Line under the heading: the full date when the heading says "Today",
  // plus the streak and that day's cube solves.
  function renderMeta() {
    const bits = [];
    if (date === U.today()) bits.push(U.fmtLong(date) + '.');
    const streak = currentStreak();
    if (streak.days >= 2) {
      bits.push(streak.includesToday
        ? streak.days + ' days logged in a row.'
        : streak.days + ' days logged in a row up to yesterday. Log today to keep it going.');
    }
    const solves = store.listSolves().filter(s => s.date === date);
    if (solves.length) {
      const best = App.cubeStats.best(solves);
      bits.push(U.plural(solves.length, 'cube solve') + (best == null ? ', all DNF.' : ', best ' + U.fmtMs(best) + '.'));
    }
    $('day-sub').textContent = bits.join(' ');
    $('day-delete').hidden = !store.hasDay(date);
  }

  // CLAIMS: "N days logged in a row" (ending today, or ending yesterday if today is not logged yet)
  // COUNTS: consecutive calendar days with a saved entry, walking back from today
  //         (or from yesterday when today has no entry). Solves alone do not count.
  function currentStreak() {
    const t = U.today();
    const includesToday = store.hasDay(t);
    let d = includesToday ? t : U.addDays(t, -1);
    let n = 0;
    while (store.hasDay(d)) { n++; d = U.addDays(d, -1); }
    return { days: n, includesToday };
  }

  // ---------- face ----------
  function renderFace() {
    const face = $('face');
    face.replaceChildren();
    const set = Q.filter(q => day.q[q.key]).length;
    face.setAttribute('aria-label', 'Weather face: ' + set + ' of ' + Q.length + ' qualities rated');
    Q.forEach(q => {
      const v = day.q[q.key];
      const b = U.el('button', {
        type: 'button', class: 'sticker',
        title: q.name + ': ' + (v ? v + ' of 5' : 'not rated'),
        'aria-label': q.name + ', ' + (v ? v + ' of 5' : 'not rated') + '. Jump to this quality.',
        onclick: () => {
          const row = document.querySelector('.quality[data-key="' + q.key + '"]');
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.add('flash');
          setTimeout(() => row.classList.remove('flash'), 900);
          const pressed = row.querySelector('[aria-pressed="true"]') || row.querySelector('.q-dot');
          pressed.focus({ preventScroll: true });
        }
      }, U.el('span', { class: 'sticker-label', text: q.name }));
      if (v) { b.dataset.v = v; b.style.setProperty('--c', 'var(--i' + v + ')'); }
      face.append(b);
    });
  }

  function popSticker(key) {
    const i = Q.findIndex(q => q.key === key);
    const st = $('face').children[i];
    if (!st) return;
    st.classList.add('pop');
    setTimeout(() => st.classList.remove('pop'), 160);
  }

  // ---------- qualities ----------
  function renderQualities() {
    const wrap = $('qualities');
    wrap.replaceChildren();
    Q.forEach(q => {
      const v = day.q[q.key];
      const dots = U.el('div', { class: 'q-dots', role: 'group', 'aria-label': q.name });
      for (let i = 1; i <= 5; i++) {
        const b = U.el('button', {
          type: 'button', class: 'q-dot' + (v && i <= v ? ' lit' : ''), text: String(i),
          'aria-pressed': String(v === i),
          'aria-label': q.name + ' ' + i + ' of 5 (1 ' + q.low + ', 5 ' + q.high + ')',
          onclick: () => {
            if (day.q[q.key] === i) delete day.q[q.key];
            else day.q[q.key] = i;
            renderQualities();
            touch();
            popSticker(q.key);
            document.querySelector('.quality[data-key="' + q.key + '"] .q-dot:nth-child(' + i + ')').focus();
          }
        });
        if (v && i <= v) b.style.setProperty('--c', 'var(--i' + v + ')');
        dots.append(b);
      }
      wrap.append(U.el('div', { class: 'quality', 'data-key': q.key },
        U.el('span', { class: 'q-name', text: q.name }),
        U.el('span', { class: 'q-end low', text: q.low }),
        dots,
        U.el('span', { class: 'q-end high', text: q.high })));
    });
  }

  // ---------- tags ----------
  function renderTags() {
    const wrap = $('tag-chips');
    wrap.replaceChildren();
    const tags = store.allTags();
    day.tags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
    tags.forEach(t => {
      const on = day.tags.includes(t);
      wrap.append(U.el('button', {
        type: 'button', class: 'chip', text: t, 'aria-pressed': String(on),
        onclick: () => {
          day.tags = on ? day.tags.filter(x => x !== t) : day.tags.concat(t);
          renderTags();
          touch();
        }
      }));
    });
  }

  function addTag() {
    const input = $('tag-input');
    const t = input.value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t) return;
    if (!day.tags.includes(t)) day.tags = day.tags.concat(t);
    input.value = '';
    renderTags();
    touch();
  }

  // ---------- notes ----------
  function renderNotes() {
    const list = $('notes-list');
    list.replaceChildren();
    if (!day.notes.length) {
      list.append(U.el('li', null, U.el('p', { class: 'notes-empty', text: 'No notes for this day.' })));
      return;
    }
    day.notes.forEach(n => {
      list.append(U.el('li', null,
        U.el('span', { class: 'note-text', text: n.text }),
        U.el('span', { class: 'note-time', text: 'Added ' + U.fmtStamp(n.at) }),
        U.el('button', {
          type: 'button', class: 'delete-x', text: 'Delete', 'aria-label': 'Delete note: ' + n.text,
          onclick: () => { day.notes = day.notes.filter(x => x.id !== n.id); renderNotes(); touch(); }
        })));
    });
  }

  function addNote() {
    const input = $('note-input');
    const text = input.value.trim();
    if (!text) return;
    day.notes = day.notes.concat({ id: App.storage.newId(), text, at: new Date().toISOString() });
    input.value = '';
    renderNotes();
    persist.flush();
  }

  // ---------- calendar ----------
  function renderCalendar() {
    const cal = $('calendar');
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysIn = new Date(y, m, 0).getDate();
    const t = U.today();
    const nextMonth = U.ymd(new Date(y, m, 1));

    const grid = U.el('div', { class: 'cal-grid' });
    const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    dow.forEach((d, i) => grid.append(U.el('span', { class: 'cal-dow', text: d, 'aria-hidden': 'true', title: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i] })));
    for (let i = 0; i < first.getDay(); i++) grid.append(U.el('span', { class: 'cal-day outside' }));

    let logged = 0;
    for (let dnum = 1; dnum <= daysIn; dnum++) {
      const ds = U.ymd(new Date(y, m - 1, dnum));
      const has = store.hasDay(ds);
      if (has) logged++;
      const cls = 'cal-day' + (ds === t ? ' is-today' : '') + (ds === date ? ' is-selected' : '');
      const btn = U.el('button', {
        type: 'button', class: cls, disabled: ds > t,
        'aria-label': U.fmtLong(ds) + (has ? ', logged' : ', not logged') + (ds > t ? ', in the future' : ''),
        'aria-current': ds === date ? 'date' : null,
        onclick: () => open(ds)
      }, U.el('span', { text: String(dnum) }));
      if (has) btn.append(miniFace(store.getDay(ds)));
      grid.append(btn);
    }

    cal.replaceChildren(
      U.el('div', { class: 'cal-head' },
        U.el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shiftMonth(-1) }, chevron('M15 5l-7 7 7 7')),
        U.el('h2', { text: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
        U.el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', disabled: nextMonth > t, onclick: () => shiftMonth(1) }, chevron('M9 5l7 7-7 7'))),
      grid,
      U.el('p', { class: 'cal-legend', text: logged ? U.plural(logged, 'day') + ' logged this month. Pick any past day to fill it in.' : 'Nothing logged this month. Pick any past day to fill it in.' }));
  }

  function chevron(d) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
  }

  function miniFace(d) {
    const f = U.el('span', { class: 'mini-face', 'aria-hidden': 'true' });
    Q.forEach(q => {
      const v = d.q[q.key];
      f.append(U.el('i', { style: v ? '--c:var(--i' + v + ')' : null }));
    });
    return f;
  }

  function shiftMonth(n) {
    const [y, m] = calMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    calMonth = U.ymd(d).slice(0, 7);
    renderCalendar();
  }

  // ---------- init ----------
  function init() {
    $('day-prev').addEventListener('click', () => open(U.addDays(date, -1)));
    $('day-next').addEventListener('click', () => open(U.addDays(date, 1)));
    $('day-today').addEventListener('click', () => open(U.today()));
    $('day-picker').addEventListener('change', e => { if (e.target.value) open(e.target.value); });

    $('feels-input').addEventListener('input', e => {
      const raw = e.target.value;
      const unit = store.getSetting('tempUnit');
      const n = raw === '' ? null : Number(raw);
      day.feelsF = n == null || !isFinite(n) ? null : (unit === 'C' ? U.cToF(n) : n);
      $('temp-word').textContent = U.tempWord(day.feelsF);
      touch();
    });
    document.querySelectorAll('[data-unit]').forEach(b => b.addEventListener('click', () => {
      store.setSetting('tempUnit', b.dataset.unit);
      renderAll();
    }));

    $('entry-title').addEventListener('input', e => { day.title = e.target.value; touch(); });
    $('entry-body').addEventListener('input', e => { day.body = e.target.value; touch(); });

    $('tag-add').addEventListener('click', addTag);
    $('tag-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    $('note-add').addEventListener('click', addNote);
    $('note-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });

    $('day-delete').addEventListener('click', () => {
      if (!confirm('Delete everything logged for ' + U.fmtLong(date) + '? Cube solves on this day are kept.')) return;
      persist.cancel();
      dirty = false;
      store.deleteDay(date);
      day = store.getDay(date);
      renderAll();
      App.toast('Entry deleted');
    });

    // Save before the tab closes if an edit is still waiting on the debounce.
    window.addEventListener('beforeunload', () => { if (dirty) persist.flush(); });

    // Solves logged elsewhere change the summary line.
    store.on(what => { if (what === 'solves') renderMeta(); });

    open(U.today());
  }

  return { init, onShow: () => { if (date > U.today()) open(U.today()); } };
})();
