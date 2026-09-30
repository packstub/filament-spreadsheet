<?php

namespace Packstub\Spreadsheet\Tests\Fixtures\ProductResource\Pages;

use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Pages\SpreadsheetResourcePage;
use Packstub\Spreadsheet\Spreadsheet;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource;

/** The resource's sheet at /admin/products/sheet: no query(), no authorize*(), everything from the resource. */
class ProductsSheet extends SpreadsheetResourcePage
{
    protected static string $resource = ProductResource::class;

    /** A page-level gate on top of the resource's, for the SheetAction test. */
    public static bool $accessible = true;

    public static function canAccess(array $parameters = []): bool
    {
        return static::$accessible && parent::canAccess($parameters);
    }

    public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet
            ->columns([
                TextColumn::make('sku')->rules(['required']),
                TextColumn::make('name')->rules(['required']),
                NumberColumn::make('price')->decimals(2),
            ])
            ->creatable()
            ->deletable();
    }
}
