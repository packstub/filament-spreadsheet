<?php

namespace Packstub\Spreadsheet\Tests\Fixtures\ProductResource\Pages;

use Filament\Resources\Pages\ListRecords;
use Packstub\Spreadsheet\Actions\SheetAction;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource;

class ListProducts extends ListRecords
{
    protected static string $resource = ProductResource::class;

    protected function getHeaderActions(): array
    {
        return [SheetAction::make()];
    }
}
