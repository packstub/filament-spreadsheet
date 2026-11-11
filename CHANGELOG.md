# Changelog

All notable changes to `packstub/filament-spreadsheet` are documented in this file.

## 1.0.0 - Unreleased

The first stable release. The public API (the `Spreadsheet` definition, the columns, `Filter`, the events, the config keys and the pages) now follows semantic versioning; methods marked `@internal` are not part of it.

- `creatable()`, `deletable()` and a column's `frozen()` / `sortable()` take a closure, as Filament's options do
- A column `width()` in `rem`, `em` or `%` as well as pixels
- Choose the page sizes the pager offers: `perPageOptions()` or the `per_page_options` config key
- Screen readers hear "row 58 of 240": the grid has a name, a row count and each row's place
- A date cell no longer takes a five-digit year
- Tabulator 6.7.1 in the bundle; Filament 4.13.3 is the lowest supported 4.x (4.13.0 to 4.13.2 carry security advisories)

## 1.0.0-beta.1 - 2026-10-28

First beta of Filament Spreadsheet: edit hundreds of Eloquent records in a grid and save them in one validated batch. Works with Filament 4.13+ and 5.

- Text, number, boolean, select, date and computed columns, with row formulas
- Paste from Excel, fill-down, undo and keyboard navigation
- One Save: validated per column, conflicts caught, all-or-nothing or per row
- Same filters and look as Kanban and Gantt
- Tested on SQLite, MySQL 8.4 and PostgreSQL 17

Docs: https://packstub.dev/docs/filament-spreadsheet
