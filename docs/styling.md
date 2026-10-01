# Styling

<!-- TODO screenshot: the sheet in dark mode -->

The stylesheet bundles Tabulator's base CSS and lays Filament's colour variables (`--gray-*`, `--primary-*`, `--danger-*`, `--warning-*`, `--success-*`) over every coloured surface, so the sheet follows your panel's theme and dark mode without compiling the plugin's views. The toolbar uses logical properties: it reads right-to-left with the panel.

## Variables

Restyle it by overriding the `--ps-sheet-*` variables on `.ps-sheet` in your theme:

```css
.ps-sheet {
    --ps-sheet-height: calc(100dvh - var(--topbar-height, 4rem) - 11rem);   /* the grid's height; null from getSpreadsheetHeight() uses this */
    --ps-sheet-dirty: var(--warning-500);       /* the amber corner */
    --ps-sheet-dirty-bg: ...;
    --ps-sheet-error: var(--danger-500);
    --ps-sheet-error-bg: ...;
    --ps-sheet-conflict: #a855f7;
    --ps-sheet-conflict-bg: ...;
    --ps-sheet-locked: ...;                     /* read-only cells */
    --ps-sheet-created-bg: ...;                 /* the number cell of a new row */
    --ps-sheet-range: ...;                      /* the selection */
    --ps-sheet-ring: var(--primary-500);        /* the active cell's border, the fill handle */
    --ps-sheet-bg / -surface / -border / -line / -text / -muted / -soft / -head / -head-text / -hover / -radius / -font
}
```

The dark palette is set under `.dark .ps-sheet`. The grid's height is the window's height minus the top bar and the toolbar by default; `getSpreadsheetHeight()` on the page returns another CSS height (`'32rem'`, `'calc(100dvh - 20rem)'`), which the sheet sets as `--ps-sheet-height` on its root, or set the variable in your theme. The grid scrolls inside that height (never less than `16rem`) and renders only the rows around the visible window, so give it a real height: a percentage of a parent without one would not be a height at all.

## Classes to hook

| Class | On |
| --- | --- |
| `.ps-sheet`, `.ps-sheet-is-dirty`, `.ps-sheet-is-saving`, `.ps-sheet-is-loading`, `.ps-sheet-is-readonly` | the root |
| `.ps-sheet-toolbar`, `.ps-sheet-btn`, `.ps-sheet-btn-primary`, `.ps-sheet-pill-dirty`, `.ps-sheet-pill-errors` | the toolbar |
| `.ps-sheet-cell-dirty`, `.ps-sheet-cell-error`, `.ps-sheet-cell-conflict`, `.ps-sheet-cell-locked` | a cell |
| `.ps-sheet-row-created`, `.ps-sheet-row-deleted`, `.ps-sheet-row-readonly`, `.ps-sheet-row-error` | a row |
| `.ps-sheet-col-<type>`, `.ps-sheet-col-sortable`, `.ps-sheet-col-readonly`, `.ps-sheet-rownum` | a column's cells and header |

Tabulator's own classes (`.tabulator-row`, `.tabulator-cell`, `.tabulator-range`, `.tabulator-editing`…) are there too, scoped under `.ps-sheet`.

## Translations

Strings live in `resources/lang/{en,ro,ru,de}/spreadsheet.php` and are sent to the browser with the sheet. Publish them to change or add a language:

```bash
php artisan vendor:publish --tag=packstub-spreadsheet-translations
```

Plural forms use Laravel's `{0} …|{1} …|[2,*] …` syntax, read the same way in the browser.

## Dates and numbers

A number cell is formatted with `Intl.NumberFormat` in the panel's locale (`app()->getLocale()`), a date cell with the column's PHP `format()` (month and day names in that locale). What is copied to the clipboard is plainer: fixed decimals, ISO dates, `TRUE`/`FALSE`, option labels, so it pastes back cleanly, into this sheet or a spreadsheet.
