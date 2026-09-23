# Notebook: journal and todo

A small journal and todo list app in plain HTML, CSS and JavaScript. No install and no build step.

## Run it

Open `index.html` in a browser (double-click it). That's all.

## Structure

```
index.html        page shell, nav, and the two sections
css/style.css     styles (light and dark follow your system setting)
js/storage.js     localStorage wrapper, shared by both sections
js/journal.js     journal: write, list (newest first), delete
js/todo.js        todo: add, check off, delete
js/app.js         navigation between #journal and #todo
```

Scripts are classic `<script>` tags rather than ES modules, because browsers block
modules on `file://` pages. If you later serve the app from a local server, you can
switch to modules.

## Data

Entries and tasks are saved in this browser's localStorage under keys starting with
`notebook:`. They stay on this machine and in this browser only. In a private window,
or with site data blocked, the app shows a warning that nothing will be saved.
