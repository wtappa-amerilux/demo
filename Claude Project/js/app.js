// Hash-based navigation (#journal, #cube, #trends, #todo). Works on file://
// with no server, and back/forward move between sections.
(function () {
  const VIEWS = ['journal', 'cube', 'trends', 'todo'];
  const DEFAULT_VIEW = 'journal';
  const hooks = { journal: App.journal, cube: App.cube, trends: App.trends };
  let current = null;

  function viewFromHash() {
    const name = location.hash.replace('#', '');
    return VIEWS.indexOf(name) !== -1 ? name : DEFAULT_VIEW;
  }

  function show(name) {
    if (current && hooks[current] && hooks[current].onHide) hooks[current].onHide();
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.dataset.view !== name; });
    document.querySelectorAll('.nav-link').forEach(el => {
      const active = el.dataset.view === name;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    current = name;
    if (hooks[name] && hooks[name].onShow) hooks[name].onShow();
    document.title = { journal: 'Journal', cube: 'Cube timer', trends: 'Trends', todo: 'Todo' }[name] + ' | Facelog';
  }

  function exportData() {
    const data = App.store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'facelog-backup-' + App.util.today() + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    App.toast('Backup downloaded');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) { alert('That file is not valid JSON, so nothing was restored.'); return; }
      const when = data && data.exportedAt ? ' from ' + new Date(data.exportedAt).toLocaleString() : '';
      const nDays = data && data.days ? Object.keys(data.days).length : 0;
      const nSolves = data && Array.isArray(data.solves) ? data.solves.length : 0;
      if (!confirm('Replace everything in this browser with the backup' + when + ' (' + nDays + ' days, ' + nSolves + ' solves)? What is here now will be lost.')) return;
      const err = App.store.importAll(data);
      if (err) { alert(err + ' Nothing was changed.'); return; }
      location.reload();
    };
    reader.onerror = () => alert('Could not read that file, so nothing was restored.');
    reader.readAsText(file);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('storage-warning').hidden = App.storage.available;
    App.store.load();
    App.journal.init();
    App.cube.init();
    App.trends.init();
    App.todo.init();

    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-file').addEventListener('change', e => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = '';
    });

    show(viewFromHash());
    window.addEventListener('hashchange', () => show(viewFromHash()));
  });
})();
