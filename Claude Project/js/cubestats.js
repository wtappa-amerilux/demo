// The one place cube statistics are defined. The cube screen and the trends
// charts both call these, so a rule change lands everywhere at once.
window.App = window.App || {};

App.cubeStats = (function () {
  // Effective time: +2 adds two seconds, DNF counts as infinitely slow.
  function eff(s) {
    if (s.penalty === 'dnf') return Infinity;
    return s.ms + (s.penalty === '+2' ? 2000 : 0);
  }

  // Fastest completed solve, or null when there are no completed solves.
  // Callers must check list length to tell "no solves" from "all DNF".
  function best(list) {
    let b = Infinity;
    list.forEach(s => { const e = eff(s); if (e < b) b = e; });
    return isFinite(b) ? b : null;
  }

  // Standard (WCA-style) average of the last n solves in the given order:
  // drop the best and worst 5% (1 each for ao5 and ao12), mean the rest.
  // A DNF counts as the worst; if any DNF survives trimming, the average is DNF.
  //   { status: 'short', have }   fewer than n solves
  //   { status: 'dnf' }
  //   { status: 'ok', ms }
  function averageOf(list, n) {
    if (list.length < n) return { status: 'short', have: list.length };
    const times = list.slice(-n).map(eff).sort((a, b) => a - b);
    const trim = Math.ceil(n * 0.05);
    const kept = times.slice(trim, n - trim);
    if (kept.some(t => !isFinite(t))) return { status: 'dnf' };
    return { status: 'ok', ms: kept.reduce((a, b) => a + b, 0) / kept.length };
  }

  // Plain mean of completed solves (DNFs left out), or null if none completed.
  function meanCompleted(list) {
    const done = list.map(eff).filter(isFinite);
    return done.length ? done.reduce((a, b) => a + b, 0) / done.length : null;
  }

  const dnfCount = list => list.filter(s => s.penalty === 'dnf').length;

  // Map of date -> solves on that date (input order kept).
  function byDay(list) {
    const m = new Map();
    list.forEach(s => {
      if (!m.has(s.date)) m.set(s.date, []);
      m.get(s.date).push(s);
    });
    return m;
  }

  // "23.45", "25.45 (+2)", "DNF"
  function fmtSolve(s) {
    if (s.penalty === 'dnf') return 'DNF';
    const t = App.util.fmtMs(eff(s));
    return s.penalty === '+2' ? t + '+' : t;
  }

  function fmtAverage(a) {
    if (a.status === 'short') return null;
    if (a.status === 'dnf') return 'DNF';
    return App.util.fmtMs(a.ms);
  }

  return { eff, best, averageOf, meanCompleted, dnfCount, byDay, fmtSolve, fmtAverage };
})();
