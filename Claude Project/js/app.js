// Hash-based navigation: #journal and #todo. Works on file:// with no server,
// and the back/forward buttons move between sections.
(function () {
  var VIEWS = ['journal', 'todo'];
  var DEFAULT_VIEW = 'journal';

  function currentView() {
    var name = location.hash.replace('#', '');
    return VIEWS.indexOf(name) !== -1 ? name : DEFAULT_VIEW;
  }

  function show(name) {
    document.querySelectorAll('.view').forEach(function (el) {
      el.hidden = el.getAttribute('data-view') !== name;
    });
    document.querySelectorAll('.nav-link').forEach(function (el) {
      var active = el.getAttribute('data-view') === name;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('storage-warning').hidden = App.storage.available;
    App.journal.init();
    App.todo.init();
    show(currentView());
    window.addEventListener('hashchange', function () { show(currentView()); });
  });
})();
