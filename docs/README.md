# Filament Spreadsheet

![Filament Spreadsheet](https://raw.githubusercontent.com/packstub/art/main/filament-spreadsheet/banner.jpg)

An inline-editable table for bulk editing Eloquent records in Filament v4 (4.13+) and v5. A sheet page for any resource: edit cells with the keyboard, paste rows from Excel or Google Sheets, fill down, undo, and press Save once; the server validates every cell with your rules, checks your policies row by row, detects conflicts and writes the batch in one transaction. Free and open source (MIT), built on [Tabulator](https://tabulator.info) (MIT).

- Repository: [github.com/packstub/filament-spreadsheet](https://github.com/packstub/filament-spreadsheet)
- Packagist: [packstub/filament-spreadsheet](https://packagist.org/packages/packstub/filament-spreadsheet)
- Support: [GitHub issues](https://github.com/packstub/filament-spreadsheet/issues)

## Features

- **[One Save for hundreds of cells](saving.md)**: edits wait in the browser across pages, then one transaction writes them all.
- **[Rules, policies and conflicts on the server](saving.md)**: your validation rules, the model's policy per row, and a refused row when someone else changed it.
- **[A keyboard grid](editing.md)**: arrows and ranges, type to edit, fill down with Ctrl+D or the handle, undo and redo.
- **[Paste from Excel or Sheets](editing.md)**: a block lands at the selection, each column reading it its own way; extra rows become records.
- **[Seven column types](columns.md)**: text, number, boolean, select (options, enum or relationship), date, date-time and computed formulas.
- **[Add and delete rows](rows.md)**: new rows start from your defaults, deletions go with the next Save, both behind the policy.
- **[Search, sort, filters and pages](browsing.md)**: on the server, with Filament's own filter fields, and unsaved cells kept across pages.
- **[A resource page or your own](first-sheet.md)**: a sheet next to any resource with an Edit as sheet button, or a [standalone page](standalone.md) over your query.
- **[Events and hooks](events.md)**: `RowsSaved`, `RowSaveFailed`, `beforeSave()`, `afterSave()` and `mutateRowBeforeSave()`.
- **[Dark mode, RTL and translations](styling.md)**: English, Romanian, Russian and German; Tabulator (MIT) is bundled, nothing else to install.

## Guides

| Guide | What it covers |
| --- | --- |
| [Installation](installation.md) | Requirements, the package, the config file, the plugin |
| [Your first sheet](first-sheet.md) | A resource page, the `SheetAction`, what the query decides |
| [Columns](columns.md) | Every column type and option, relationships, computed values, read-only cells, rules |
| [Editing](editing.md) | The keyboard map, paste from Excel or Sheets, fill-down, undo |
| [Saving](saving.md) | The batch, errors on cells, conflicts, all-or-nothing versus per-row |
| [Adding and deleting rows](rows.md) | New rows with defaults, deletions, what the policy gates |
| [Search, sort, filters, pagination](browsing.md) | The toolbar, unsaved changes across pages |
| [Authorization](authorization.md) | Policies, closures, read-only mode, greyed rows |
| [Tenancy](tenancy.md) | Resource pages in a tenant panel, standalone pages |
| [Events and hooks](events.md) | `RowsSaved`, `RowSaveFailed`, `beforeSave()`, `afterSave()`, `mutateRowBeforeSave()` |
| [A sheet outside a resource](standalone.md) | `SpreadsheetPage` and the trait in any Livewire component |
| [Styling](styling.md) | The CSS variables, dark mode, RTL, translations |
| [Performance](performance.md) | Page sizes, thousands of rows, what is queried when |
| [Editable columns vs a sheet](comparison.md) | When to use which, and the neighbours: import, export, a Sheets-like document |
| [Upgrading](upgrading.md) | Version notes |

## At a glance

```bash
composer require packstub/filament-spreadsheet
php artisan filament:assets
```

```php
use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\SelectColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Pages\SpreadsheetResourcePage;
use Packstub\Spreadsheet\Spreadsheet;

class ProductsSheet extends SpreadsheetResourcePage
{
    protected static string $resource = ProductResource::class;

    public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet
            ->columns([
                TextColumn::make('sku')->rules(['required', 'unique:products,sku'])->frozen(),
                TextColumn::make('name')->rules(['required']),
                SelectColumn::make('category_id')->relationship('category', 'name'),
                NumberColumn::make('price')->decimals(2)->min(0),
            ])
            ->searchable(['sku', 'name'])
            ->creatable()
            ->deletable();
    }
}
```

## Requirements

PHP 8.3+, Laravel 12 or 13, Filament 4.13+ or 5.

---

These pages are published at [packstub.dev/docs/filament-spreadsheet](https://packstub.dev/docs/filament-spreadsheet) from the package's `docs/` directory. Spotted a mistake? [Open a pull request](https://github.com/packstub/filament-spreadsheet).
