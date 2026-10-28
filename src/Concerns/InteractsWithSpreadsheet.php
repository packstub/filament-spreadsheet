<?php

namespace Packstub\Spreadsheet\Concerns;

use Filament\Schemas\Contracts\HasSchemas;
use Filament\Schemas\Schema;
use Livewire\Attributes\Locked;
use Livewire\Attributes\Renderless;
use Packstub\Spreadsheet\Enums\FiltersLayout;
use Packstub\Spreadsheet\Exceptions\SaveRejected;
use Packstub\Spreadsheet\Filter;
use Packstub\Spreadsheet\SavePayload;
use Packstub\Spreadsheet\SaveResult;
use Packstub\Spreadsheet\Spreadsheet;

/**
 * The server side of a sheet, for any Livewire component (the plugin's pages use
 * it). Every call is renderless: the browser owns the grid and its unsaved cells,
 * so the server only answers with data and never re-renders it. Nothing here
 * returns a model: every answer is plain arrays, ready for JSON.
 */
trait InteractsWithSpreadsheet
{
    protected ?Spreadsheet $spreadsheetDefinition = null;

    /**
     * Set once the first page of rows has been rendered with the grid: later
     * renders carry no rows (see getSpreadsheetConfig()).
     */
    #[Locked]
    public bool $spreadsheetRendered = false;

    abstract public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet;

    public function getSpreadsheet(): Spreadsheet
    {
        return $this->spreadsheetDefinition ??= $this->configureSpreadsheet($this->spreadsheet(Spreadsheet::make()->key(static::class)));
    }

    /** What the component adds to the definition (a resource page: its query and its abilities). */
    protected function configureSpreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet;
    }

    /**
     * One page of rows: `{page, perPage, sort: {column, direction}, search, filters}`,
     * every part checked by the definition.
     *
     * @param  array<string, mixed>  $request
     * @return array<string, mixed>
     */
    #[Renderless]
    public function spreadsheetRows(array $request = []): array
    {
        try {
            return ['ok' => true, ...$this->getSpreadsheet()->rows($request)];
        } catch (\Throwable $e) {
            report($e);

            return ['ok' => false, 'message' => __('packstub-spreadsheet::spreadsheet.load_failed')];
        }
    }

    /**
     * One Save: `{changed: {id: {column: value}}, versions: {id: version}, created:
     * {temp: {column: value}}, deleted: [id]}`. Answers with the rows as saved, and
     * per cell, per row or per conflict what was refused. A refused batch answers
     * with its reason; anything else that goes wrong while writing is reported and
     * answered with a generic message: an exception's text is for the log.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    #[Renderless]
    public function spreadsheetSave(array $payload = []): array
    {
        return $this->spreadsheetAnswer(fn (): SaveResult => $this->getSpreadsheet()->save(SavePayload::fromArray($payload)));
    }

    /**
     * Delete rows by key, through the same checks as a Save.
     *
     * @param  array<int, mixed>  $ids
     * @return array<string, mixed>
     */
    #[Renderless]
    public function spreadsheetDelete(array $ids = []): array
    {
        return $this->spreadsheetAnswer(fn (): SaveResult => $this->getSpreadsheet()->delete(array_values($ids)));
    }

    /**
     * The filters' fields hold their state here (Filament's fields need a Livewire
     * path); the browser owns the real state and keeps this one in step
     * (`syncFields()`), never the other way round: a change is dispatched by the
     * field (`Filter::toFormComponent()`) and applied by the Alpine component.
     *
     * @var array<string, mixed>
     */
    public array $spreadsheetFilters = [];

    /**
     * Every field's path exists before the browser entangles it (Livewire refuses a
     * missing one), as a Filament page fills its form on mount. Livewire runs this
     * trait hook on the first request only; later requests carry the browser's state.
     */
    public function mountInteractsWithSpreadsheet(): void
    {
        if (! $this instanceof HasSchemas) {
            throw new \LogicException(static::class.' must implement Filament\\Schemas\\Contracts\\HasSchemas and use Filament\\Schemas\\Concerns\\InteractsWithSchemas: the filters are Filament form components (the Spreadsheet pages do).');
        }

        $this->getSchema('spreadsheetFiltersForm')?->fill();
    }

    /** The filters as Filament's own form components, where filtersLayout() puts them. */
    public function spreadsheetFiltersForm(Schema $schema): Schema
    {
        $sheet = $this->getSpreadsheet();
        $inline = $sheet->getFiltersLayout() === FiltersLayout::Toolbar;

        return $schema
            ->statePath('spreadsheetFilters')
            ->components(array_map(
                fn (Filter $filter) => $filter->toFormComponent($inline, (int) config('packstub-spreadsheet.first_day_of_week', 1), config('packstub-spreadsheet.date_format') ?? 'M j, Y'),
                $sheet->getFilters(),
            ));
    }

    /** @return array<string, mixed> */
    protected function spreadsheetAnswer(\Closure $operation): array
    {
        try {
            $result = $operation();
        } catch (SaveRejected $e) {
            $result = new SaveResult;
            $result->message = $e->getMessage();
            $result->rolledBack = true;
        } catch (\Throwable $e) {
            report($e);

            $result = new SaveResult;
            $result->message = __('packstub-spreadsheet::spreadsheet.failed');
            $result->rolledBack = true;
        }

        $this->spreadsheetSaved($result);

        return $result->toArray();
    }

    /** Hook after every save attempt (log it, notify someone…). */
    protected function spreadsheetSaved(SaveResult $result): void {}

    /**
     * Everything the browser needs to draw the sheet. The first page of rows is
     * queried by the first render that includes the grid only: the grid element is
     * wire:ignore, so a later render (an action's modal, `$refresh`) never reaches
     * it; the browser keeps its own rows and its unsaved cells. A config without
     * rows makes the browser ask for its first page itself.
     *
     * @return array<string, mixed>
     */
    public function getSpreadsheetConfig(?bool $withState = null): array
    {
        $sheet = $this->getSpreadsheet();

        if ($withState ?? ! $this->spreadsheetRendered) {
            $state = $sheet->rows();
            $this->spreadsheetRendered = true;
        } else {
            $state = null;
        }

        $max = $sheet->getMaxPerPage();
        $sizes = array_values(array_filter([25, 50, 100, 200, 500, 1000], fn (int $n) => $n <= $max));

        if (! in_array($sheet->getPerPage(), $sizes, true)) {
            $sizes[] = $sheet->getPerPage();
            sort($sizes);
        }

        return [
            'columns' => array_map(fn ($column) => $column->toArray(), $sheet->getColumns()),
            // A toggle without a query() throws here, at the first render, not the first time a user turns it on.
            'filters' => array_map(fn (Filter $filter) => tap($filter)->assertUsable()->toArray(), $sheet->getFilters()),
            'filtersLayout' => $sheet->getFiltersLayout()->value,
            'perPage' => $sheet->getPerPage(),
            'pageSizes' => $sizes,
            'sort' => $sheet->getDefaultSort(),
            'searchable' => $sheet->getSearchable() !== [],
            'creatable' => $sheet->canCreate(),
            'deletable' => $sheet->isDeletable(),
            'readOnly' => $sheet->isReadOnly(),
            'maxRowsPerSave' => $sheet->getMaxRowsPerSave(),
            'confirmLeave' => (bool) config('packstub-spreadsheet.confirm_leave', true),
            'frozenFirstColumn' => (bool) config('packstub-spreadsheet.frozen_first_column', false),
            'rowHeight' => max(24, (int) config('packstub-spreadsheet.row_height', 32)),
            'keybindings' => array_filter((array) config('packstub-spreadsheet.keybindings', []), 'is_string'),
            'locale' => str_replace('_', '-', app()->getLocale()),
            'height' => $this->getSpreadsheetHeight(),
            'state' => $state,
            'i18n' => __('packstub-spreadsheet::spreadsheet'),
        ];
    }

    /** A CSS height for the grid; null fits it to the window below its top edge. */
    protected function getSpreadsheetHeight(): ?string
    {
        return null;
    }
}
