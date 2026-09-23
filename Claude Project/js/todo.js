window.App = window.App || {};

App.todo = (function () {
  var KEY = 'todos';
  var todos = [];

  var form, input, list, empty, count;

  function init() {
    form = document.getElementById('todo-form');
    input = document.getElementById('todo-text');
    list = document.getElementById('todo-list');
    empty = document.getElementById('todo-empty');
    count = document.getElementById('todo-count');

    todos = App.storage.load(KEY, []);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      todos.push({
        id: App.storage.newId(),
        text: text,
        done: false,
        createdAt: new Date().toISOString()
      });
      App.storage.save(KEY, todos);
      form.reset();
      render();
    });

    list.addEventListener('change', function (e) {
      var id = e.target.getAttribute('data-toggle');
      if (!id) return;
      todos.forEach(function (t) { if (t.id === id) t.done = e.target.checked; });
      App.storage.save(KEY, todos);
      render();
    });

    list.addEventListener('click', function (e) {
      var id = e.target.getAttribute('data-delete');
      if (!id) return;
      todos = todos.filter(function (t) { return t.id !== id; });
      App.storage.save(KEY, todos);
      render();
    });

    render();
  }

  function render() {
    list.innerHTML = '';
    // Open tasks first, then completed; each group oldest first (order added).
    var sorted = todos.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.createdAt.localeCompare(b.createdAt);
    });

    sorted.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'card todo-item' + (t.done ? ' done' : '');

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'todo-' + t.id;
      box.checked = t.done;
      box.setAttribute('data-toggle', t.id);

      var label = document.createElement('label');
      label.htmlFor = box.id;
      label.textContent = t.text;

      var del = document.createElement('button');
      del.className = 'btn-ghost';
      del.type = 'button';
      del.textContent = 'Delete';
      del.setAttribute('data-delete', t.id);

      li.appendChild(box);
      li.appendChild(label);
      li.appendChild(del);
      list.appendChild(li);
    });

    // Counts come from the full array, not the rendered list.
    var open = todos.filter(function (t) { return !t.done; }).length;
    count.textContent = todos.length
      ? open + ' open of ' + todos.length + ' total'
      : '';

    // Two different empty situations get two different messages.
    if (todos.length === 0) {
      empty.textContent = 'No tasks yet. Add one above.';
      empty.hidden = false;
    } else if (open === 0) {
      empty.textContent = 'All tasks done.';
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }
  }

  return { init: init };
})();
