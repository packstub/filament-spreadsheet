<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

use Filament\Support\Contracts\HasLabel;

enum Status: string implements HasLabel
{
    case Draft = 'draft';
    case Live = 'live';
    case Retired = 'retired';

    public function getLabel(): string
    {
        return ucfirst($this->value);
    }
}
