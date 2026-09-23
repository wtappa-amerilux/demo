window.App = window.App || {};

App.journal = (function () {
  var KEY = 'journal';
  var entries = [];

  var form, titleInput, bodyInput, list, empty;

  function init() {
    form = document.getElementById('journal-form');
    titleInput = document.getElementById('journal-title');
    bodyInput = document.getElementById('journal-body');
    list = document.getElementById('journal-list');
    empty = document.getElementById('journal-empty');

    entries = App.storage.load(KEY, []);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = bodyInput.value.trim();
      if (!body) return;
      entries.push({
        id: App.storage.newId(),
        title: titleInput.value.trim(),
        body: body,
        createdAt: new Date().toISOString()
      });
      App.storage.save(KEY, entries);
      form.reset();
      render();
    });

    list.addEventListener('click', function (e) {
      var id = e.target.getAttribute('data-delete');
      if (!id || !confirm('Delete this entry?')) return;
      entries = entries.filter(function (x) { return x.id !== id; });
      App.storage.save(KEY, entries);
      render();
    });

    render();
  }

  function render() {
    list.innerHTML = '';
    // Newest first, by the time the entry was written.
    var sorted = entries.slice().sort(function (a, b) {
      return b.createdAt.localeCompare(a.createdAt);
    });

    sorted.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'card';

      var head = document.createElement('div');
      head.className = 'entry-head';

      var title = document.createElement('h3');
      title.className = 'entry-title';
      title.textContent = entry.title || 'Untitled';

      var date = document.createElement('time');
      date.className = 'entry-date';
      date.dateTime = entry.createdAt;
      date.textContent = new Date(entry.createdAt).toLocaleString(undefined, {
        dateStyle: 'medium', timeStyle: 'short'
      });

      var body = document.createElement('p');
      body.className = 'entry-body';
      body.textContent = entry.body;

      var actions = document.createElement('div');
      actions.className = 'entry-actions';
      var del = document.createElement('button');
      del.className = 'btn-ghost';
      del.type = 'button';
      del.textContent = 'Delete';
      del.setAttribute('data-delete', entry.id);
      actions.appendChild(del);

      head.appendChild(title);
      head.appendChild(date);
      li.appendChild(head);
      li.appendChild(body);
      li.appendChild(actions);
      list.appendChild(li);
    });

    empty.hidden = entries.length > 0;
  }

  return { init: init };
})();
