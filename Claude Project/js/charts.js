// Hand-built SVG charts, no library (the app runs offline from file://).
// Conventions: 2px lines, r=4 dots with a surface ring, hairline solid grid,
// columns <= 24px with 4px rounded tops, one y-axis per chart, tooltips that
// enhance but never gate (every chart has a table view in trends.js).
window.App = window.App || {};

App.charts = (function () {
  const U = App.util;
  const NS = 'http://www.w3.org/2000/svg';
  const M = { top: 12, right: 16, bottom: 28, left: 46 };

  function s(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  // Round tick values covering [min, max].
  function niceScale(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / (count || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
    return { lo, hi, ticks };
  }

  // Evenly spaced day ticks that fit the width.
  function dayTicks(d0, d1, width) {
    const n = Math.max(2, Math.floor(width / 84));
    const step = Math.max(1, Math.ceil((d1 - d0 + 1) / n));
    const out = [];
    for (let d = d0; d <= d1; d += step) out.push(d);
    return out;
  }

  function tooltip(host) {
    const tip = U.el('div', { class: 'tooltip', hidden: true });
    host.append(tip);
    return {
      show(x, y, header, rows) {
        tip.replaceChildren(U.el('div', { class: 'tt-date', text: header }),
          ...rows.map(r => U.el('div', { class: 'tt-row' },
            r.color ? U.el('span', { class: 'tt-key', style: '--c:' + r.color }) : null,
            U.el('span', { class: 'tt-val', text: r.value }),
            r.label ? U.el('span', { class: 'tt-lbl', text: r.label }) : null)));
        tip.hidden = false;
        const hw = host.clientWidth;
        const tw = tip.offsetWidth;
        let left = x + 14;
        if (left + tw > hw + host.scrollLeft) left = x - tw - 14;
        tip.style.left = Math.max(host.scrollLeft, left) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
      },
      hide() { tip.hidden = true; }
    };
  }

  function prep(host) {
    host.replaceChildren();
    host.className = 'chart';
    return Math.max(280, host.clientWidth);
  }

  // Line chart on a day axis. Lines break across missing days rather than
  // drawing a slope through days with no data.
  // cfg: { d0, d1, series: [{ label, color, points: [{ d, y }] }], yFmt, ariaLabel }
  function line(host, cfg) {
    const W = prep(host), H = 240;
    const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
    const ys = cfg.series.flatMap(sr => sr.points.map(p => p.y));
    const { lo, hi, ticks } = niceScale(Math.min(...ys), Math.max(...ys), 4);
    const x = d => M.left + (cfg.d1 === cfg.d0 ? iw / 2 : (d - cfg.d0) / (cfg.d1 - cfg.d0) * iw);
    const y = v => M.top + ih - (v - lo) / (hi - lo) * ih;

    const root = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.ariaLabel });
    ticks.forEach(t => {
      root.append(s('line', { class: 'grid', x1: M.left, x2: W - M.right, y1: y(t), y2: y(t) }));
      root.append(s('text', { class: 'tick', x: M.left - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, cfg.yFmt(t)));
    });
    root.append(s('line', { class: 'axis', x1: M.left, x2: W - M.right, y1: M.top + ih, y2: M.top + ih }));
    dayTicks(cfg.d0, cfg.d1, iw).forEach(d => {
      root.append(s('text', { class: 'tick', x: x(d), y: H - 8, 'text-anchor': 'middle' }, U.fmtShort(U.fromDayNum(d))));
    });

    const byDay = new Map();
    cfg.series.forEach((sr, si) => {
      const pts = sr.points.slice().sort((a, b) => a.d - b.d);
      let path = '';
      pts.forEach((p, i) => {
        const gap = i === 0 || p.d - pts[i - 1].d > 1;
        path += (gap ? 'M' : 'L') + x(p.d).toFixed(1) + ',' + y(p.y).toFixed(1);
        if (!byDay.has(p.d)) byDay.set(p.d, []);
        byDay.get(p.d)[si] = p;
      });
      root.append(s('path', { class: 'series-line', d: path, style: 'stroke:' + sr.color }));
      // Dots on every point while sparse; when dense, only on points with no
      // neighbour, which would otherwise be invisible (a line needs two points).
      pts.forEach((p, i) => {
        const alone = (i === 0 || p.d - pts[i - 1].d > 1) && (i === pts.length - 1 || pts[i + 1].d - p.d > 1);
        if (pts.length <= 45 || alone) {
          root.append(s('circle', { class: 'dot', cx: x(p.d), cy: y(p.y), r: 4, style: 'fill:' + sr.color }));
        }
      });
    });

    // Crosshair snaps to the nearest day that has data in any series.
    const cross = s('line', { class: 'crosshair', y1: M.top, y2: M.top + ih, visibility: 'hidden' });
    const ring = s('g', {});
    root.append(cross, ring);
    const hit = s('rect', { class: 'hit', x: M.left, y: M.top, width: iw, height: ih });
    root.append(hit);
    host.append(root);

    const tip = tooltip(host);
    const dataDays = Array.from(byDay.keys()).sort((a, b) => a - b);
    hit.addEventListener('pointermove', ev => {
      const box = root.getBoundingClientRect();
      const px = ev.clientX - box.left;
      let bestD = dataDays[0], bestDist = Infinity;
      dataDays.forEach(d => { const dist = Math.abs(x(d) - px); if (dist < bestDist) { bestDist = dist; bestD = d; } });
      const cx = x(bestD);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      ring.replaceChildren();
      const rows = [];
      cfg.series.forEach((sr, si) => {
        const p = byDay.get(bestD)[si];
        if (p) ring.append(s('circle', { class: 'dot', cx, cy: y(p.y), r: 5, style: 'fill:' + sr.color }));
        rows.push({ color: sr.color, value: p ? cfg.yFmt(p.y, true) : 'none', label: sr.label });
      });
      const topY = Math.min(...rows.map((r, si) => { const p = byDay.get(bestD)[si]; return p ? y(p.y) : M.top + ih; }));
      tip.show(cx, topY, U.fmtMed(U.fromDayNum(bestD)), rows);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); ring.replaceChildren(); tip.hide(); });
  }

  // Columns on a day axis. cfg: { d0, d1, points: [{ d, y, detail }], color, yFmt, ariaLabel }
  function columns(host, cfg) {
    const W = prep(host), H = 200;
    const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
    const max = Math.max(...cfg.points.map(p => p.y), 1);
    const { hi, ticks } = niceScale(0, max, 3);
    const span = cfg.d1 - cfg.d0 + 1;
    const band = iw / span;
    const bw = Math.max(2, Math.min(24, band - 2));
    const x = d => M.left + (d - cfg.d0) * band + band / 2;
    const y = v => M.top + ih - v / hi * ih;

    const root = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.ariaLabel });
    ticks.forEach(t => {
      root.append(s('line', { class: 'grid', x1: M.left, x2: W - M.right, y1: y(t), y2: y(t) }));
      root.append(s('text', { class: 'tick', x: M.left - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, cfg.yFmt(t)));
    });
    dayTicks(cfg.d0, cfg.d1, iw).forEach(d => {
      root.append(s('text', { class: 'tick', x: x(d), y: H - 8, 'text-anchor': 'middle' }, U.fmtShort(U.fromDayNum(d))));
    });

    host.append(root);
    const tip = tooltip(host);
    cfg.points.forEach(p => {
      const x0 = x(p.d) - bw / 2, y0 = y(p.y), h = M.top + ih - y0;
      const r = Math.min(4, bw / 2, h);
      const bar = s('path', {
        class: 'bar', style: 'fill:' + cfg.color,
        d: `M${x0},${y0 + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y0 + h}Z`
      });
      // Hit area is the whole column band, not just the painted bar.
      const hit = s('rect', { class: 'hit', x: x(p.d) - Math.max(band, 12) / 2, y: M.top, width: Math.max(band, 12), height: ih });
      hit.addEventListener('pointerenter', () => {
        bar.classList.add('hover');
        tip.show(x(p.d), y0, U.fmtMed(U.fromDayNum(p.d)), [{ value: cfg.yFmt(p.y, true), label: p.detail || '' }]);
      });
      hit.addEventListener('pointerleave', () => { bar.classList.remove('hover'); tip.hide(); });
      root.append(bar, hit);
    });
    root.append(s('line', { class: 'axis', x1: M.left, x2: W - M.right, y1: M.top + ih, y2: M.top + ih }));
  }

  // Heatmap of rows x every calendar day in range. Days with no entry, and
  // qualities left blank on a logged day, both draw as empty plastic; the
  // tooltip tells them apart.
  // cfg: { d0, d1, rows: [{ key, name, low, high }], cell(rowKey, dayNum) -> {v, logged} }
  function heatmap(host, cfg) {
    const W = prep(host);
    const labelW = 96;
    const n = cfg.d1 - cfg.d0 + 1;
    const avail = W - labelW - 8;
    const cell = Math.max(10, Math.min(28, Math.floor(avail / n)));
    const innerW = labelW + n * cell + 8;
    const H = cfg.rows.length * cell + 30;
    if (innerW > W) host.classList.add('scroll-x');

    const root = s('svg', { width: innerW, height: H, viewBox: `0 0 ${innerW} ${H}`, role: 'img', 'aria-label': cfg.ariaLabel });
    cfg.rows.forEach((r, ri) => {
      root.append(s('text', { class: 'row-label', x: 0, y: ri * cell + cell / 2, 'dominant-baseline': 'middle' }, r.name));
    });
    dayTicks(cfg.d0, cfg.d1, n * cell).forEach(d => {
      root.append(s('text', { class: 'tick', x: labelW + (d - cfg.d0) * cell + cell / 2, y: H - 8, 'text-anchor': 'middle' },
        U.fmtShort(U.fromDayNum(d))));
    });
    host.append(root);
    const tip = tooltip(host);

    for (let d = cfg.d0; d <= cfg.d1; d++) {
      cfg.rows.forEach((r, ri) => {
        const c = cfg.cell(r.key, d);
        const cx = labelW + (d - cfg.d0) * cell, cy = ri * cell;
        const rect = s('rect', {
          class: 'cell' + (c.v ? '' : ' empty'), x: cx, y: cy, width: cell, height: cell, rx: 3,
          style: c.v ? 'fill:var(--i' + c.v + ')' : ''
        });
        rect.addEventListener('pointerenter', () => {
          rect.classList.add('hover');
          const value = c.v ? c.v + ' of 5' : (c.logged ? 'left blank' : 'no entry');
          const label = c.v ? r.name + ' (1 ' + r.low + ', 5 ' + r.high + ')' : r.name;
          tip.show(cx + cell / 2, cy, U.fmtMed(U.fromDayNum(d)), [{ value, label }]);
        });
        rect.addEventListener('pointerleave', () => { rect.classList.remove('hover'); tip.hide(); });
        root.append(rect);
      });
    }
  }

  // Horizontal bars with the value at the tip. items: [{ label, value }]
  function hbars(host, items, fmt) {
    host.replaceChildren();
    host.className = 'hbar-list';
    const max = Math.max(...items.map(i => i.value), 1);
    items.forEach(i => {
      host.append(U.el('div', { class: 'hbar' },
        U.el('span', { class: 'hbar-label', text: i.label, title: i.label }),
        U.el('span', { class: 'hbar-track' },
          U.el('span', { class: 'hbar-fill', style: 'width:' + (i.value / max * 85) + '%' }),
          U.el('span', { class: 'hbar-val', text: fmt(i.value) }))));
    });
  }

  function table(host, headers, rows) {
    host.replaceChildren();
    host.className = 'table-wrap';
    host.append(U.el('table', { class: 'data-table' },
      U.el('thead', null, U.el('tr', null, headers.map(h => U.el('th', { scope: 'col', text: h })))),
      U.el('tbody', null, rows.map(r => U.el('tr', null, r.map(c => U.el('td', { text: c })))))));
  }

  return { line, columns, heatmap, hbars, table };
})();
