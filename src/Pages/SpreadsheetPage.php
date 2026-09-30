<?php

namespace Packstub\Spreadsheet\Pages;

use Filament\Pages\Page;
use Filament\Support\Enums\Width;
use Packstub\Spreadsheet\Concerns\InteractsWithSpreadsheet;

/** A standalone panel page holding one sheet. Implement spreadsheet(Spreadsheet $spreadsheet) with a query(). */
abstract class SpreadsheetPage extends Page
{
    use InteractsWithSpreadsheet;

    protected string $view = 'packstub-spreadsheet::pages.spreadsheet';

    protected Width|string|null $maxContentWidth = Width::Full;
}
