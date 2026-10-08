# Editable columns vs a sheet

Filament gives you several ways to change data in a table. They complement each other; this page is about picking the right one for the job.

## Filament's editable columns

`TextInputColumn`, `SelectColumn`, `ToggleColumn` and `CheckboxColumn` on a list page are the quickest way to fix one value: click, type, leave the cell, saved. They shine for the one-off (flip a toggle, correct a price) and they need no extra page. Each cell saves on its own as you leave it, which is exactly what you want for a quick fix.

## This plugin

A sheet page is for the afternoon when you need to fix three hundred of them: the same cells, but

- edited like a spreadsheet — keyboard, ranges, paste from Excel, fill-down, undo;
- held until **one Save**, so a half-done job is never half-saved, and a mistake is undone before it lands;
- validated together with your column rules, refused per cell with the message where the mistake is;
- checked row by row against your policies, and against a version so two people editing the same rows notice;
- written in one transaction (or per row, your choice), with the rows coming back as saved.

Keep the editable columns on the list page; add a sheet page next to it and a `SheetAction` in the header for the bulk work.

## Neighbours

- **The same idea on Filament 5**: [Spreadsheet Grid](https://github.com/asignua/filament-spreadsheet-grid) turns an existing Filament table into an editable grid, keeping the table's own query, filters and pagination, with paste from Excel, fill-down and one "Save all". This plugin gives the sheet its own page or component, built on [Tabulator](https://tabulator.info), with undo, a version check for conflicts, and support for Filament 4 as well as 5.
- **Outside Filament**: [LaraGrid](https://github.com/unnathianalytics/laragrid) is an Excel-style, keyboard-first grid for plain Laravel and Livewire 4, with read-only and editable modes, live formula columns, footer totals and exports ([live demo](https://grid.laravel.cloud/)). Reach for it in a Livewire app without a panel; inside a Filament panel, this plugin uses the panel's theme, tenancy and policies.
- **Importing a file**: Filament's [`ImportAction`](https://filamentphp.com/docs/actions/import) (CSV, queued, column mapping) and plugins such as [Excel Import](https://filamentphp.com/plugins/eightynine-excel-import) or [Import Wizard](https://filamentphp.com/plugins/waad-mawlood-import-wizard) take a file. This sheet takes a paste: for a few hundred rows from a spreadsheet you already have open, select the top-left cell and Ctrl+V; rows past the end become new records.
- **Exporting**: Filament's `ExportAction` and [Filament Excel](https://filamentphp.com/plugins/pxlrbt-excel) export a table; Ctrl+C on a selection here copies tab-separated text you can paste into a spreadsheet.
- **A spreadsheet document** (free cells, formulas, tabs, stored as JSON): [Univer Sheet](https://filamentphp.com/plugins/yuichi-okada-univer-sheet) is a full spreadsheet editor in a form field. This plugin edits Eloquent records, not documents.
- **A grid form field** (rows × columns inside a form): Filament's [`Repeater::table()`](https://filamentphp.com/docs/forms/repeater#table-layout). A `Spreadsheet` form field on this same grid is planned for a later release.
