# Facelog

A daily log for how the weather *felt*, plus a Rubik's cube timer, a todo list, and
charts built from all of it. Plain HTML, CSS and JavaScript: no install, no build step.

## Run it

Open `index.html` in a browser (double-click it). Fonts load from Google Fonts when
online and fall back to system fonts offline.

## What's in it

- **Journal**: one entry per date. Go back to any past day with the arrows, the date
  picker or the calendar. Each entry holds a feels-like temperature (°F or °C), nine
  weather qualities rated 1 to 5, tags, a title and text, and timestamped notes.
  Changes save automatically. The nine ratings draw that day's "face": a 3x3 cube
  face that also appears in the calendar.
- **Cube timer**: hold space (or touch and hold) until the time turns green, let go
  to start, press any key to stop. Solves get +2 / DNF penalties and notes. Past
  solves can be logged against any earlier date. Stats: best single, current ao5
  and ao12 (standard trimmed averages, DNF rules included), today's mean.
- **Trends**: one date-range filter drives every stat and chart: feels-like
  temperature, a heatmap of the nine qualities, daily best and mean solve times
  (weekdays only: weekends are left off that axis), and tag counts. Every chart
  has a table view.
- **Todo**: simple task list.

## Structure

```
index.html          page shell and all four sections
css/style.css       styles; light and dark follow your system setting
js/util.js          dates, time and temperature formatting, DOM helper
js/storage.js       localStorage wrapper
js/store.js         days, solves, settings, backup; v1 journal migration
js/cubestats.js     best, ao5/ao12, means: the only place these are defined
js/charts.js        SVG line, column, heatmap and bar charts
js/journal.js       journal screen
js/cube.js          timer and solve log
js/trends.js        charts screen
js/todo.js          todo list
js/app.js           navigation, backup download and restore
```

Scripts are classic `<script>` tags, not ES modules, because browsers block modules
on `file://` pages. Load order in `index.html` matters.

## Data

Everything is stored in this browser's localStorage under keys starting with
`notebook:`. It never leaves the machine. Use **Download a backup** in the sidebar
regularly; **Restore from backup** replaces everything with a backup file.

Entries from the first version of the app (`notebook:journal`) are moved into the
new format on first load. Entries written on the same day are joined into one, and
the old key is kept as a backup.
