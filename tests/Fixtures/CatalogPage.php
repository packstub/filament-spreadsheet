<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Pages\SpreadsheetPage;
use Packstub\Spreadsheet\Spreadsheet;

/** A standalone panel page at /admin/catalog with its own query. */
class CatalogPage extends SpreadsheetPage
{
    protected static ?string $slug = 'catalog';

    public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet
            ->query(fn () => Product::query()->where('is_active', true))
            ->columns([TextColumn::make('sku'), NumberColumn::make('stock')->integer()])
            ->perPage(50);
    }
}
