// Todo list. Open tasks are the working list; completed tasks are kept for
// reference, grouped by the day they were finished.
//
// Task: { id, text, done, createdAt, completedAt }
// completedAt is null while open. Tasks finished before this field existed
// have done: true and no completedAt; they are shown as "Completed earlier"
// rather than being given a made-up date.
window.App = window.App || {};

App.todo = (function () {
  const U = App.util;
  const S = App.storage;
  const KEY = 'todos';
  const FILTERS = ['open', 'done', 'all'];
  const $ = id => document.getElementById(id);

  let todos = [];
  let filter = 'open';
  let query = '';
  let editingId = null;

  function save() {
    if (!S.save(KEY, todos)) App.toast('Not saved: browser storage is unavailable');
  }

  // ---------- actions ----------
  function add(text) {
    todos.push({ id: S.newId(), text, done: false, createdAt: new Date().toISOString(), completedAt: null });
    save();
    // A new task is open; make sure it is visible.
    if (filter === 'done') setFilter('open');
    render();
  }

  function toggle(id) {
    const t = todos.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? new Date().toISOString() : null;
    save();
    render();
    App.toast(t.done ? 'Marked done' : 'Moved back to open');
  }

  function remove(id) {
    const t = todos.find(x => x.id === id);
    todos = todos.filter(x => x.id !== id);
    save();
    render();
    if (t) App.toast('Task deleted');
  }

  function rename(id, text) {
    const t = todos.find(x => x.id === id);
    if (t && text && text !== t.text) { t.text = text; save(); }
    editingId = null;
    render();
  }

  function setFilter(f) {
    filter = FILTERS.includes(f) ? f : 'open';
    App.store.setSetting('todoFilter', filter);
  }

  // ---------- rendering ----------
  const matches = t => !query || t.text.toLowerCase().includes(query);

  function render() {
    const open = todos.filter(t => !t.done);
    const done = todos.filter(t => t.done);

    // CLAIMS: counts beside each filter = how many tasks are in that state.
    // COUNTS: the whole list, before search is applied, so a search never hides how many exist.
    document.querySelector('[data-count="open"]').textContent = open.length;
    document.querySelector('[data-count="done"]').textContent = done.length;
    document.querySelector('[data-count="all"]').textContent = todos.length;
    document.querySelectorAll('#todo-filters [data-filter]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));

    $('todo-summary').textContent = !todos.length ? ''
      : !open.length ? 'Everything is done. Completed tasks stay below for reference.'
      : U.plural(open.length, 'open task') + (done.length ? ', ' + done.length + ' completed' : '') + '.';

    const wrap = $('todo-lists');
    wrap.replaceChildren();

    if (!todos.length) {
      wrap.append(emptyMsg('No tasks yet. Add one above.'));
      return;
    }

    const openShown = open.filter(matches).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const doneShown = done.filter(matches);

    if (filter !== 'done') {
      wrap.append(section('Open', openShown, open.length,
        open.length ? null : (done.length ? 'Nothing open. All ' + U.plural(done.length, 'task') + ' are done.' : null)));
    }
    if (filter !== 'open') {
      wrap.append(completedSection(doneShown, done.length));
    }
  }

  function emptyMsg(text, withClear) {
    const p = U.el('p', { class: 'empty', text });
    if (withClear) {
      p.append(' ', U.el('button', { type: 'button', class: 'link-btn', text: 'Clear search', onclick: clearSearch }));
    }
    return p;
  }

  function noMatch(total, kind) {
    return emptyMsg('None of your ' + U.plural(total, kind + ' task') + ' match "' + query + '".', true);
  }

  function section(title, shown, total, emptyText) {
    const sec = U.el('section', { class: 'todo-section', 'aria-label': title + ' tasks' });
    sec.append(U.el('h2', { class: 'todo-section-title' }, title, U.el('span', { class: 'todo-section-count', text: sectionCount(shown.length, total) })));
    if (!total) { sec.append(emptyMsg(emptyText || 'No open tasks.')); return sec; }
    if (!shown.length) { sec.append(noMatch(total, 'open')); return sec; }
    const ul = U.el('ul', { class: 'todo-list' });
    shown.forEach(t => ul.append(item(t)));
    sec.append(ul);
    return sec;
  }

  // "3" normally; "2 of 3" while a search is narrowing the list.
  const sectionCount = (shown, total) => query && shown !== total ? shown + ' of ' + total : String(total);

  function completedSection(shown, total) {
    const sec = U.el('section', { class: 'todo-section todo-done', 'aria-label': 'Completed tasks' });
    sec.append(U.el('h2', { class: 'todo-section-title' }, 'Completed', U.el('span', { class: 'todo-section-count', text: sectionCount(shown.length, total) })));
    if (!total) { sec.append(emptyMsg('No completed tasks yet. Tick a task off and it moves here.')); return sec; }
    if (!shown.length) { sec.append(noMatch(total, 'completed')); return sec; }

    // Group by the local day each task was completed, newest day first.
    const groups = new Map();
    shown.slice()
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
      .forEach(t => {
        const k = t.completedAt ? U.ymd(new Date(t.completedAt)) : 'unknown';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      });
    groups.forEach((list, k) => {
      sec.append(U.el('h3', { class: 'todo-group', text: groupLabel(k) }));
      const ul = U.el('ul', { class: 'todo-list' });
      list.forEach(t => ul.append(item(t)));
      sec.append(ul);
    });
    return sec;
  }

  function groupLabel(k) {
    if (k === 'unknown') return 'Completed earlier (date not recorded)';
    const t = U.today();
    if (k === t) return 'Today';
    if (k === U.addDays(t, -1)) return 'Yesterday';
    return U.fmtMed(k);
  }

  function item(t) {
    const li = U.el('li', { class: 'todo-item' + (t.done ? ' is-done' : '') });

    const check = U.el('button', {
      type: 'button', class: 'todo-check', role: 'checkbox', 'aria-checked': String(t.done),
      'aria-label': (t.done ? 'Mark as not done: ' : 'Mark as done: ') + t.text,
      onclick: () => toggle(t.id)
    });
    check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>';

    const body = U.el('div', { class: 'todo-body' });
    if (editingId === t.id) {
      const input = U.el('input', { type: 'text', class: 'todo-edit', value: t.text, maxlength: '200', 'aria-label': 'Edit task' });
      let finished = false;
      const finish = commit => {
        if (finished) return;
        finished = true;
        if (commit) rename(t.id, input.value.trim());
        else { editingId = null; render(); }
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      body.append(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      body.append(U.el('span', { class: 'todo-text', text: t.text }));
    }
    body.append(U.el('span', { class: 'todo-meta', text: meta(t) }));

    const actions = U.el('div', { class: 'todo-actions' },
      t.done ? null : U.el('button', {
        type: 'button', class: 'delete-x', text: 'Edit', 'aria-label': 'Edit task: ' + t.text,
        onclick: () => { editingId = t.id; render(); }
      }),
      U.el('button', {
        type: 'button', class: 'delete-x', text: 'Delete', 'aria-label': 'Delete task: ' + t.text,
        onclick: () => remove(t.id)
      }));

    li.append(check, body, actions);
    return li;
  }

  function meta(t) {
    const added = 'Added ' + U.fmtMed(U.ymd(new Date(t.createdAt)));
    if (!t.done) return added;
    return t.completedAt ? added + ', done at ' + U.fmtClock(t.completedAt) : added;
  }

  function clearSearch() {
    $('todo-search').value = '';
    query = '';
    render();
    $('todo-search').focus();
  }

  // ---------- init ----------
  function init() {
    todos = S.load(KEY, []);
    // Tasks saved before completedAt existed: leave done ones without a date.
    todos.forEach(t => { if (!('completedAt' in t)) t.completedAt = null; });
    filter = FILTERS.includes(App.store.getSetting('todoFilter')) ? App.store.getSetting('todoFilter') : 'open';

    $('todo-form').addEventListener('submit', e => {
      e.preventDefault();
      const input = $('todo-text');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      add(text);
    });

    document.querySelectorAll('#todo-filters [data-filter]').forEach(b =>
      b.addEventListener('click', () => { setFilter(b.dataset.filter); render(); }));

    $('todo-search').addEventListener('input', e => {
      query = e.target.value.trim().toLowerCase();
      render();
    });

    render();
  }

  return { init };
})();
