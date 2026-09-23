// Thin wrapper around localStorage. Every access is guarded: localStorage can
// throw in private windows or when site data is blocked, and a failed read must
// not look the same as "no saved data" (see App.storage.available).
window.App = window.App || {};

App.storage = (function () {
  var PREFIX = 'notebook:';
  var available = true;

  try {
    var probe = PREFIX + '__probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch (e) {
    available = false;
  }

  function load(key, fallback) {
    if (!available) return fallback;
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.error('Could not read "' + key + '" from storage', e);
      return fallback;
    }
  }

  function save(key, value) {
    if (!available) return false;
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Could not save "' + key + '" to storage', e);
      return false;
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return { available: available, load: load, save: save, newId: newId };
})();
