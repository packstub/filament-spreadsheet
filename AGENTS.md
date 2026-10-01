# packstub/filament-spreadsheet

Free (MIT) Filament v4/v5 plugin: spreadsheet-style bulk editing of Eloquent records. The browser owns the sheet (a
page of rows, the unsaved cells in a buffer, a Tabulator grid); Livewire only answers renderless calls
(`spreadsheetRows`, `spreadsheetSave`, `spreadsheetDelete`). Sibling of `plugins/filament-gantt` and
`plugins/filament-kanban`: same scaffold, same `Filter`, same hardening rules.

## Commands

```bash
composer test               # Pest suite
composer test:filter <name>
composer test:js            # browser side's pure parts: node --test tests/js (plain Node, no packages)
composer lint               # Pint
npm run build               # resources/{js,css} → resources/dist (esbuild); commit the result
npm run dev                 # rebuild on change
node tests/browser/run.mjs  # headless Chromium harness (not CI): typing, paste, fill-down, undo, paging, save, failed requests, conflicts, the row window, editor keys, the select list, a date typed on the cell, Ctrl+Enter, the active cell after Add row, keys on a boolean cell, Alt+arrows, a keyboard-only pass
```

CI runs Pint, Pest and the JS suite on Laravel 12/13 × Filament 4.13.0 / 4.* / 5.*, and checks that `npm run build`
leaves `resources/dist` unchanged: **consumers run only `filament:assets`**, so the built bundle is committed.

## Layout

- `src/Spreadsheet.php` (definition; `rows()` reader; `save()` = authorise, conflict check, coerce, validate, write,
  answer; `delete()`), `SavePayload.php` (strict reader of what the browser sends), `SaveResult.php` (plain arrays,
  never a model), `Filter.php`, `Enums/SaveMode.php`, `Events/{RowsSaved,RowSaveFailed}.php`,
  `Exceptions/{SaveRejected,InvalidValue,RolledBack}.php`.
- `src/Columns/Column.php` + `Text|Number|Boolean|Select|Date|DateTime|ComputedColumn.php`: `present()` (record → wire),
  `coerce()` (wire → attribute, throws `InvalidValue` with the cell message), `getRules()` (own rules with `unique`
  ignoring the record + type rules), `toArray()` (what the grid needs). A `SelectColumn::relationship()` loads its
  options once per definition (`prepare()`), from the sheet's model.
- `src/Concerns/InteractsWithSpreadsheet.php` (the Livewire side), `src/Pages/Spreadsheet{,Resource}Page.php`
  (the resource page adds the resource's query and abilities in `configureSpreadsheet()` unless the definition set
  its own), `src/Actions/SheetAction.php`, `src/SpreadsheetPlugin.php`, `src/SpreadsheetServiceProvider.php`.
- `resources/js/sheet.js` — **pure**: TSV, coercion per type (mirrors the PHP columns), the buffer (changes, originals,
  versions, pages, created, deleted, undo/redo, errors/conflicts), payload, result application, paste and fill-down
  planning, `choice()`, keybindings. `resources/js/grid.js` — the only file that knows Tabulator (columns → Tabulator
  defs, events → callbacks, the operations the component needs). `resources/js/spreadsheet.js` — the Alpine component.
  `resources/css/spreadsheet.css` imports Tabulator's base stylesheet and lays Filament tokens over it. `build.mjs`
  bundles both into `resources/dist/spreadsheet.{js,css}` (esbuild, ESM, minified; ~302 KB / 80 KB gzip, 42 KB / 7 KB),
  each headed by Tabulator's copyright and permission notice (read from its `LICENSE` at build time; `InstallTest`
  checks it is there, `LICENSE.md` has the third-party section).
- `tests/js/sheet.test.mjs` (node:test, imports `resources/js/sheet.js` directly: never Tabulator); `tests/browser/`
  (`harness.mjs` turns the real Blade view into a static page with a fake `$wire` and a fake `Livewire` whose `failCommit([methods])` runs the commit hook's `fail` callbacks; `?autoheight` sends `height: null`, the real default; `?hidden` builds the sheet inside `#harness-wrap` with `display:none`, shown by the case; `run.mjs` drives it in Chromium
  through a sibling project's `playwright-core`; screenshots in `tests/browser/screenshots`, ignored). The grid
  renders only the rows around its window: `cell(index, …)` counts the row elements in the DOM, so a case that
  addresses a row further down calls `scrollToRow(id)` and takes the cell with `cellOf(id, field)`; never work
  around it by making the grid taller. A scroll position is compared as the first visible row and its offset
  (`firstVisible()` / `samePlace()`), read in the middle of a page and after `atRest()`, and before the Enter that
  commits a typed cell (Enter moves the active cell down, and Tabulator scrolls a row when the next one is cut off;
  `scrollToRow(id)` leaves the row at the bottom of the window, so a row two further down is out of it and a click
  on it scrolls): `scrollTop` moves with
  Tabulator's estimated heights, and 200 ms after a scroll its range overlay is laid out again, which can move the
  holder (most at the very end of a page).
- `tests/Fixtures/ProductSheet.php` — a plain Livewire component holding a sheet, shaped by static flags;
  `Product` (decimal/int/bool/date/datetime/enum casts, an upper-casing SKU mutator), `Category`, `Status`,
  `ProductPolicy` (static flags), `AdminPanelProvider` + `ProductResource` (`$scope` narrows its query like a tenant)
  with `ListProducts` (`SheetAction`) and `ProductsSheet`, `CatalogPage` (standalone).
- `docs/` — the packstub.dev pages (synced by `docs-sync.yml`); screenshots are `<!-- TODO screenshot -->` comments.

## Conventions

- Everything the browser sends is checked again on the server: `SavePayload::fromArray()` keeps only well-shaped
  keys and rows; `save()` re-checks the column (exists, editable, not read-only, not locked for the record), the
  record (still in `query()`), the policy, the version, the value (`coerce()`) and the rules. `rows()` clamps the
  page size, accepts a sort on a sortable column only, escapes the search. Never trust a column name from the wire.
- No public Livewire method returns a model: `SaveResult::toArray()` and `rows()` are plain arrays. Object-shaped
  maps are cast `(object)` in `toArray()` so an id-keyed map never becomes a JSON list.
- Errors: a `SaveRejected`'s message is shown; any other exception is `report()`ed and answered with the generic
  string (`failed`, `load_failed`, `row_failed`). `Spreadsheet::save()` lets exceptions propagate after the rollback;
  the trait catches them. `write()` runs every row's operation in a savepoint of the batch's transaction (both
  modes) and turns a `QueryException` into a row error (`row_failed`, or `row_delete_failed` for a delete): the
  refused statement rolls back to the savepoint, so the transaction stays usable for the later rows' checks (a
  `unique` rule, a policy that queries; Postgres refuses every statement of an aborted transaction otherwise). In
  PerRow the other rows go on; in AllOrNothing `RolledBack` answers at the end with every row marked. Anything
  that is not a `QueryException` propagates in AllOrNothing.
- `findRecords()` on an integer key type keeps only keys that fit a 64-bit integer (`isIntegerKey()`); the rest are
  answered as missing without a query.
- Every error of a row at once: a cell that fails coercion does not stop the validation of the row's other cells.
  A new row is validated over every editable column; an update over the changed ones (with `unique` ignoring the
  record).
- Versions: the raw `version_column` attribute as a string, compared as strings. `updated_at` has whole seconds
  (two saves within one second cannot be told apart; suggest a `lock_version` column for that).
- Writes use `forceFill()`: the sheet's columns are the whitelist, not `$fillable`. Tenancy needs nothing here:
  Filament's `creating` observer and global scope on the resource's model do it.
- Browser: `applyEdits()` keeps the version and page in the undo step (a redo of a row's first edit needs them);
  `repaint()` paints classes on existing cells and never `reformat()`s a row (that would rebuild the DOM under an
  open editor); Tab while editing is handled by the component (blur commits synchronously, then move), never by
  Tabulator's edit-next; booleans have no editor (double-click, Enter or Space flip them: `tickCross` stayed open on
  Escape); `selectableRangeColumns` is off (a header click sorts, it must not select the column);
  `selectableRangeClearCells` is off too: Delete, Backspace and Ctrl+X are the component's (`clearSelection()` through
  `S.clearPlan()` / `S.editable()`, Tabulator's cleared locked and computed cells) and `onRangeEdit()` re-checks what the
  fill handle wrote. Sheet shortcuts other than Ctrl+S apply only outside a text field (`input, textarea, select,
  [contenteditable]`) that is not the grid's own editor: a toolbar button is no such field, and every toolbar action
  (`undo()`, `redo()`, `addRow()`, `discard()`, `deleteSelected()`, `runMenu()`, the `save()` tail) ends with
  `refocus()`, which hands the focus back to the grid unless a text field holds it (Ctrl+S from the search box keeps
  the caret there). `refresh()` carries a sequence number (`_req`); a stale answer is dropped, and `save()` bumps it
  too: a page request in flight when a save lands is dropped (`loading` reset) and re-run after the save, so its stale
  rows and versions never cover the saved ones. While `saving` is true the sheet takes no edits: `grid.js` asks
  `saving()` in `editableCell`, and `onEdit`, `onRangeEdit`, `onPaste`, `clearSelection`, `fillDown`, `addRow`,
  `markDeleted`, `undo`, `redo`, `deleteSelected`, `openMenu`, `runMenu` and `discard` return early (a keystroke is
  dropped, never queued; the toolbar's undo/redo disable too), the root carrying `ps-sheet-is-saving` (grid dimmed,
  `cursor: progress`) — `S.applyResult()` forgets the saved cells wholesale, so an edit made meanwhile would have
  been lost with them. Every `$wire` call goes through `call(method, ...params)`, never `this.$wire.x()` directly: on
  Livewire 3 (Filament 4) a failed request leaves the action's promise pending for good (Livewire 4 rejects it), so
  `init()` registers `Livewire.hook('commit', ({ component, commit, fail }) => …)` for its own component
  (`component.id === $wire.$id`; removed in `destroy()`; no `window.Livewire` in a test page is fine) and `call()` races
  the promise against that failure: `requestFailed(commit)` rejects the oldest waiting call per method in
  `commit.calls` (commits of one component go out in order), or everything waiting when the commit does not list its
  calls. `saving` / `loading` are released in a `finally`; a failure leaves the buffer and the undo stack alone and
  shows `offline`; an answer that lands after the failure is ignored (the race is settled). The waiting list is a
  closure variable, not Alpine data (a reactive copy never compares equal). `save()` commits an open editor *before*
  the dirty check (it may be the only change), and the Save button is enabled by `dirty.total || editing`
  (`editing` comes from `grid.js`'s `on.editing`); the holder's `focus()` is wrapped to `preventScroll`, because
  Tabulator focuses it when an editor closes and a page that scrolls under the pointer loses the click that closed
  it. Undo steps: `edit`, `create`/`uncreate`, `delete`/`undelete`, and the
  compound `paste` (`S.applyPaste()`: the edits, the created rows with their temp ids and the cells it could not read,
  replayed together; a paste's new rows stop at `maxRowsPerSave` from the config, `capped` counted in the hint). A
  `pastePlan` invalid entry for a new row carries `created: k` (the index into `plan.created`), resolved to the temp id
  by `applyPaste()`. `removeRows()` of many ids runs under `blockRedraw()`. Anything Tabulator renders from data goes in
  as an element with `textContent` (select option labels via `itemFormatter`, the placeholder), never as a string it
  would `innerHTML`. Data calls await `tableBuilt`.
- Grid height and the row window: Tabulator is built on `.ps-sheet-grid` itself with `height: 'var(--ps-sheet-height)'`
  (never `'100%'`: the parent has no height, the grid would grow to its rows and nothing would be windowed; no
  `height` on `.ps-sheet .tabulator` either, it is the same element). The variable is the stylesheet's default or
  `config.height` (`getSpreadsheetHeight()`), bound on the root by the view. So **a row may have no element**: address
  rows by id through the table (`getRow(id)`, which answers `false` for an unknown id), never by DOM position;
  `grid.scrollTo(id, position)` brings one into view (Tabulator's `scrollToRow` plus a few rounds of correction, its
  estimates stop short of the last row); `addRow()` scrolls to the new row; `grid.edit()` scrolls the active cell back
  before opening its editor, and takes the cell *after* the scroll: a row updated while it had no element (an editor
  committed as it scrolled out, an undo, a save answer) rebuilds its cells when it renders again, and a cell
  component taken earlier is a deleted one. Ctrl+ArrowDown / Ctrl+ArrowUp (with Shift too) are Tabulator's jump,
  followed by `grid.js`'s `jumped()` (which does not look at Alt, as Tabulator's keybinding does not: a handler that
  skipped Ctrl+Alt+Arrow left the jump out of view; in an open editor it does nothing, the arrows are the editor's, see Editor keys below): it lays the range overlay out at once (`modules.selectRange.layoutRanges()`,
  otherwise the overlay's old place holds the scroll height for 200 ms and the holder moves again when it lets go)
  and then `scrollTo()`s the row the range moved to. `ResizeTableModule` is registered: a sheet built while hidden
  (a tab, a collapsed section) redraws when it becomes visible, and on a size change; it leaves the inline
  `height: var(--ps-sheet-height)` alone and does not redraw at rest (the harness counts `renderComplete`). Marks on a row out of the window need nothing: `updateRows()` updates the data and the
  formatters paint when the row renders. `rowOffset` and the page an edit is recorded under come from `_applied`
  (below), not from `page`: rows render lazily, also while another page is being asked for.
- Page state: `applyPage(r, request)` keeps `_applied = { page, perPage, sort, query }`, what the rows on screen are
  (`query` is `queryKey(request)`: the search and filters the answer was asked with, not the ones typed since). When
  all four equal the previous `_applied` the rows are the same ones read again and the scroll is kept
  (`grid.setRows(rows, false)`: `replaceData`, then the row that was at the top of the window is put back with its
  offset, Tabulator's own re-render in position drifts by several rows) and so is the range: `replaceData` resets it
  to the first cell of the page, where the next keystroke would be written with the user looking at row 58, so
  `setRows()` takes `api.selection()` before and `restoreRange(kept)` puts the last range's bounds back right after
  `replaceData`, *before* `restoreTop()` and only there (after it, the first ~130 ms of typing go to row 1; a second
  restore after it would undo a move the user made meanwhile). Rows are found by id, a row that is gone by the
  position it had (clamped); no rows, no restore. `restoreTop()` calls `layoutRanges()` in each round: the overlay
  left where its rows were (Tabulator lays it out 200 ms after a scroll) holds the scroll height open under the last
  row, and the holder moving when it lets go makes a click miss its cell (the focus then stays on the cell element
  and is lost with it). The sheet keeps one range (`selectableRange: 1`: a Ctrl+click moves it); anything else opens at the top
  (`setRows(rows, true)`: `setData`, which renders from the first row; setting `scrollTop = 0` after `replaceData`
  leaves the old window's rows on screen). `discard()` re-renders with `renderPage()` (no `top`), the scroll kept. `setPage()`,
  `setPerPage()` and `sortBy()` set the asked-for state at once; when the latest request throws or answers
  `ok: false`, `refresh()` calls `restoreApplied()` (and `redrawHeader()` if the sort moved). The search text and the
  filters are not restored. Before `applyPage()`, `refresh()` commits an open editor (`grid.focus()`, one tick, `seq`
  checked again): `replaceData` under an open editor throws inside Tabulator and loses the text.
- Focus: Tabulator focuses the holder when an editor closes, before the browser has focused what was clicked. The
  wrapped `holder.focus` drops that call while a `mousedown` outside the grid is being handled (`outside`, a capture
  listener on `document`, reset on the next tick, removed in `destroy()`; a select editor's option list, which Tabulator
  appends to the body as `.tabulator-popup-container`, counts as inside; when that tick is over an outside
  pointer-down reports `on.editing(isEditing())`, because with the holder not focused there is no `focusout` and an
  unchanged date editor fires no edit event, so `editing` would stay true and Save enabled); `api.focus()` calls the original, so
  `refocus()` after a toolbar click still works. The leave guard is `unsaved()`: `dirty.total` or an open editor.
  `updateRows()` and `scrollTo()` do nothing after `destroy()` (an editor that commits while the sheet is removed).
- Editor keys (`grid.js`): `editorKeys` is a **capture-phase** `keydown` listener on the grid element (removed in
  `destroy()`), a no-op unless an editor is open. PageUp / PageDown / Home / End stop there: Tabulator's bindings page
  or jump the grid (`scrollPageUp`, `scrollToStart`, …), macOS scrolls the holder on Home / End, and a row leaving the
  window commits its editor; a bubble-phase guard is too late (Tabulator's input editor stops Home / End itself, the
  browser's scroll stays). Plain Home / End put the caret at the start / end of a `type=text` input by hand; with a
  modifier they are the field's. ArrowUp / ArrowDown in an `editor: 'input'` cell (text, number) blur the input (the
  commit is synchronous) and `navigate()`, like the component's Tab: the selection moves, no editor opens (Tabulator's
  `navUp` / `navDown` would open the next row's); with Alt the key is only kept from Tabulator, with Shift / Ctrl / Meta
  nothing is done. The list editor is left alone (its arrows walk the options). The component's own `keydown` listener
  is a capture listener on the root, so it still sees every key first (Enter, Tab, Ctrl+S). `isoEditor` (date,
  date-time): Chromium fires `change` on every key that alters the value (a digit, Backspace, an arrow stepping a
  segment), so `change` commits only while `keyed` is false: any key but Enter / Escape / Tab sets it, a `pointerdown`
  on the field (the calendar button) clears it; Enter, Tab (the component's blur) and blur commit, Escape cancels. It
  stops ArrowUp / ArrowDown itself, at the target, so they step the segment and never reach `navUp` / `navDown`
  (`editorKeys` cannot stop them in the capture phase: the input's own listener would not run and `keyed` would stay
  false). The harness types 11/11/2027: the segment order follows the system locale. `done` cancels when the field
  reads `''` with `validity.badInput` (a part missing: one segment cleared, a year not typed yet), so a blur, Enter or
  Ctrl+S on a half-typed date keeps the cell's value; every part cleared reads `''` without `badInput` and commits
  null (the harness clears parts until `badInput` is false: their number follows the locale).
- Select editor (`grid.js`): Tabulator's list editor re-filters by the field's text on every `keyup` but the arrows,
  Enter and Escape, so `listKeyup`, a **capture-phase** `keyup` listener on the grid element (removed in `destroy()`),
  stops a deny-list of keys while a list editor is open (`listOpen()`): F2 (the key that opened it), Shift, Control,
  Alt, Meta, CapsLock, Home, End, PageUp, PageDown. A deny-list, not "anything that is not one character": an IME
  reports `Process`. `currentCell` is `false`, not null, when nothing is edited (`?.` does not guard it). The list
  editor ignores `selectContents` and leaves the caret after the label, so a `cellEditing` handler selects the
  label one tick later (the editor is built after that event) for F2 / Enter / a double-click; `api.edit(initial)`
  sets `typedOpen` around `cell.edit(true)` and keeps its typed text. Tabulator's own rule stays: Enter after typed
  text resolves the text (cancel when it is no option, null when it is empty, `allowEmpty`), it does not pick the one
  option left; ArrowDown + Enter pick it.
- A cell without an editor (boolean, computed: `editor: false`): Tabulator's `editCell` / `cell.edit()` throws there
  (`column.modules.edit` is undefined), and two paths reach it. Enter (`spreadsheet.js` `onKeydown`): Tabulator's range
  module calls `editCell` on the active cell, so the component stops Enter, with any modifier, on a computed cell and
  on a boolean in a read-only sheet; an editable boolean is flipped by `toggleActive()` further down on a plain Enter
  and stops there with Ctrl / Meta (reachable when `add_row` is bound to another key; the harness's `?addrow=<key>`).
  F2 and typing (`grid.js` `api.edit()`): a boolean passes `editableCell()`, so `edit()` also returns false when the
  column's definition has no `editor`. Nothing else calls `cell.edit()`; a double-click is bound by Tabulator only on
  columns with an editor (the boolean's is the column's own `cellDblClick`).
- Alt+ArrowLeft / Alt+ArrowRight are the browser's (Back / Forward on Windows and Linux, a word step in a text field on
  macOS): Tabulator's keybindings do not look at Alt, so they moved the active cell and prevented the default.
  `altArrows`, a **capture-phase** `keydown` listener on the grid element (removed in `destroy()`), stops the
  propagation only, with Shift too, never with Ctrl / Meta (Ctrl+Alt+Arrow is still Tabulator's jump, see `jumped()`).
  The key therefore does not bubble past the grid: a page listener for it has to be a capture one.
- A key the component acts on is the component's alone: every such branch of `onKeydown` calls `own()`
  (`preventDefault` + `stopPropagation`, in the capture phase on the root, so neither the target nor Tabulator sees
  the key). Tabulator has two keydown handlers of its own: the range module's on the holder (Enter, with any modifier,
  calls `editCell` on the active cell; Delete / Backspace are switched off) and the Keybindings module's on the table
  element (Tab, the arrows with Shift / Ctrl / Meta, PageUp / PageDown / Home / End, Ctrl+C; no History module, so no
  Ctrl+Z / Ctrl+Y). Ctrl+Enter (add row) that still reached the first opened an editor on the old cell, which the
  scroll to the new row took out of the window (keyboard dead), and threw on a computed cell. The shortcuts are
  configurable, so all of them stop, not only the ones that collide with the defaults. Two keys are shared on
  purpose: Enter in an open editor (the editor's own listener commits, the component moves down a tick later) and
  the add-row key when it is an Enter pressed in an open editor (the editor commits, a select taking its highlighted
  option, and `addRow()` runs a tick later; bound to another key, `addRow()` commits the editor by `grid.focus()`).
  What the component does not handle is Tabulator's: Tab and the arrows outside an editor, Ctrl+C.
- Characters that are key codes (`grid.js` `characterKeys`): Tabulator's Keybindings reads a one-character `e.key` as
  its char code, and `! " # $ % & ' (` are 33–40, the codes of PageUp, PageDown, End, Home and the arrows. Unshifted
  (AZERTY's `(` and `&`, QWERTZ's `#`) the key paged the grid, jumped to its end or opened the next row's editor, in
  an open editor too (the character not typed: the actions `preventDefault`). A bubble-phase `keydown` listener on
  the holder (removed in `destroy()`) stops those eight characters there, after the editor has had them; the harness
  sends them as synthetic keydowns without Shift (Playwright's US layout cannot press them unshifted).
- Typing on a selected cell (`grid.edit(initial)`): a text, number or select editor gets the character as its text
  and the key is the component's. A date / date-time field has no text to set: `api.edit()` returns `'native'` for
  a digit, and the component only stops the propagation, so the browser's default action puts the digit into the
  field's first part (the field is focused by then; it never sees the keydown). `edit()` dispatches `ps-keyed` on
  the input first, which sets `isoEditor`'s `keyed`: without it the `change` that digit fires would commit at once,
  as a picked date. Any other first key on a date cell opens the editor and types nothing (`true`, prevented).
- Add row (`addRow()`, button and shortcut): `grid.select(temp, first)` puts the one-cell range on the new row's
  first editable column (`S.editable()`; the first column when none is) as soon as `addRows()` resolves, then
  `scrollTo(temp, 'bottom')`; a range holds row and column positions, so the row needs no element yet. The harness
  waits for the active cell to be the new row's before it types (`onNewRow()`). `grid.removeRows()` takes the
  selection before and, when Tabulator is left without an active cell (the range was on the last rows: the undo of
  a create, a new row deleted), `restoreRange()`s it onto the row now at that place; `performSave()` remembers a
  created row holding the active cell and `select()`s the saved row under its real id once it is added.
- In the Blade view, an element with `x-show` binds `:style` with the object syntax; nothing stored is interpolated
  into `wire:click` / `x-on:` expressions.
- Render once: `$spreadsheetRendered` (`#[Locked]`) makes `getSpreadsheetConfig()` skip `rows()` after the render
  that included the grid; the grid element is `wire:ignore`. Tests that want the rows call
  `getSpreadsheetConfig(withState: true)`.
- Every change needs a test (Pest for the server, `tests/js` for the pure browser parts, a case in
  `tests/browser/run.mjs` for an interaction); `CHANGELOG.md` stays current. Strings in
  `resources/lang/{en,ro,ru,de}` (same keys, same order: `InstallTest` checks). Rebuild and commit `resources/dist`
  after any change under `resources/js` or `resources/css`.
