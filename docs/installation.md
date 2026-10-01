# Installation

## Requirements

- PHP 8.3 or newer
- Laravel 12 or 13
- Filament 4.13 or newer, or Filament 5

## 1. Require the package

```bash
composer require packstub/filament-spreadsheet
php artisan filament:assets
```

There are no migrations: the sheet reads and writes your own columns. The grid engine ([Tabulator](https://tabulator.info), MIT) is bundled into the package's assets, so there is nothing to install on the JavaScript side; the script and the stylesheet load only on pages that show a sheet. Run `php artisan filament:assets` again after every update of the package: Filament copies the assets into `public/`.

The config file is optional; publish it to change the defaults (rows per page, the save mode, the version column, keyboard shortcuts, date formats):

```bash
php artisan vendor:publish --tag=packstub-spreadsheet-config
```

Registering the plugin on a panel is optional too (the pages work without it): `->plugin(SpreadsheetPlugin::make())`.

## 2. Add a sheet page

A sheet lives on a page. `SpreadsheetResourcePage` sits next to a resource's list and takes the resource's query and abilities; `SpreadsheetPage` is a standalone panel page with its own `query()`. Both ask for one method, `spreadsheet()`. [Your first sheet](first-sheet.md) walks through the resource page; [A sheet outside a resource](standalone.md) through the other.

## 3. Configuration

`config/packstub-spreadsheet.php`:

| Key | Default | What it does |
| --- | --- | --- |
| `per_page` | `100` | Rows per page a sheet opens with (`perPage()` on a definition wins) |
| `max_per_page` | `1000` | The most rows the page-size control offers |
| `max_rows_per_save` | `2000` | The most rows (updates + creates + deletes) one Save may carry; a paste past the last row stops creating rows there |
| `save_mode` | `all_or_nothing` | `all_or_nothing` or `per_row` (see [Saving](saving.md)) |
| `version_column` | `updated_at` | The attribute compared before a row is written; `null` turns the check off |
| `confirm_leave` | `true` | Ask before leaving the page with unsaved changes |
| `frozen_first_column` | `true` | Pin the first column while scrolling sideways |
| `row_height` | `32` | Pixels |
| `keybindings` | `[]` | Overrides: `save`, `fill_down`, `undo`, `redo`, `add_row`, `cut` as `mod+s`-style strings (`mod` is Ctrl or ⌘) |
| `date_format` | `Y-m-d` | PHP format a date cell shows (`format()` on a column wins) |
| `datetime_format` | `Y-m-d H:i` | PHP format a date-time cell shows |
