<?php

namespace Packstub\Spreadsheet\Support;

use Filament\Schemas\Components\Component;
use Filament\Support\Components\Attributes\ExposedLivewireMethod;
use Livewire\Attributes\Renderless;

/**
 * The server side of a filter's select for Filament 4.16+ and 5.11+, whose select
 * component asks for its options through `callSchemaComponentMethod` with the key
 * the partial gives it (`spreadsheetFilters.<filter>`) instead of the closures older
 * versions take. Never rendered: it only answers those calls, through the same
 * renderless methods as the closures. The labels of chosen values are answered in
 * the browser (the partial's shim), since the server does not hold the choice.
 */
class FilterSelect extends Component
{
    final public function __construct(protected string $filterName) {}

    public static function make(string $filterName): static
    {
        $static = app(static::class, ['filterName' => $filterName]);
        $static->configure();

        return $static;
    }

    public function getFilterName(): string
    {
        return $this->filterName;
    }

    /** @return list<array{value: string, label: string}> */
    #[ExposedLivewireMethod]
    #[Renderless]
    public function getOptionsForJs(): array
    {
        return $this->getLivewire()->spreadsheetFilterOptions($this->filterName);
    }

    /** @return list<array{value: string, label: string}> */
    #[ExposedLivewireMethod]
    #[Renderless]
    public function getSearchResultsForJs(string $search = ''): array
    {
        return $this->getLivewire()->spreadsheetFilterOptions($this->filterName, $search);
    }

    #[ExposedLivewireMethod]
    #[Renderless]
    public function getOptionLabel(): ?string
    {
        return null;
    }

    /** @return list<array{value: string, label: string}> */
    #[ExposedLivewireMethod]
    #[Renderless]
    public function getOptionLabelsForJs(): array
    {
        return [];
    }
}
