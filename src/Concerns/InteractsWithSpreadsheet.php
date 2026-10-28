<?php

namespace Packstub\Spreadsheet\Concerns;

use Filament\Schemas\Schema;
use Livewire\Attributes\Locked;
use Livewire\Attributes\Renderless;
use Packstub\Spreadsheet\Exceptions\SaveRejected;
use Packstub\Spreadsheet\Filter;
use Packstub\Spreadsheet\SavePayload;
use Packstub\Spreadsheet\SaveResult;
use Packstub\Spreadsheet\Spreadsheet;
use Packstub\Spreadsheet\Support\FilterSelect;

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
     * A select filter's options (`{value, label}`, at most its limit), or the ones matching a
     * search: what Filament's select asks for when it opens or when the user types.
     *
     * @return list<array{value: string, label: string}>
     */
    #[Renderless]
    public function spreadsheetFilterOptions(mixed $name, mixed $search = null): array
    {
        $filter = is_string($name) ? $this->spreadsheetFilter($name) : null;

        if ($filter === null || ! ($filter->isSelect() || $filter->isBoolean()) || ($search !== null && ! is_string($search))) {
            return [];
        }

        $search = $search === null ? '' : mb_substr(trim($search), 0, 200);

        $options = $search === ''
            ? array_slice($filter->getOptions(), 0, $filter->getOptionsLimit(), preserve_keys: true)
            : $filter->getSearchResults($search);

        return collect($options)->map(fn ($label, $value) => ['value' => (string) $value, 'label' => (string) $label])->values()->all();
    }

    /** The label of a select filter's value (one the listed options do not hold: a searchable filter's pick, a value from the URL). */
    #[Renderless]
    public function spreadsheetFilterOptionLabel(mixed $name, mixed $value = null): ?string
    {
        $filter = is_string($name) ? $this->spreadsheetFilter($name) : null;

        return $filter === null || ! ($filter->isSelect() || $filter->isBoolean()) || ! is_string($value) || $value === '' ? null : $filter->getOptionLabel($value);
    }

    /**
     * The labels of a multiple select filter's values (ones restored from the URL),
     * as the browser's select expects them; a value with no label is left out.
     *
     * @return list<array{value: string, label: string}>
     */
    #[Renderless]
    public function spreadsheetFilterOptionLabels(mixed $name, mixed $values = []): array
    {
        $filter = is_string($name) ? $this->spreadsheetFilter($name) : null;

        if ($filter === null || ! ($filter->isSelect() || $filter->isBoolean()) || ! is_array($values)) {
            return [];
        }

        $labels = [];

        // At most optionsLimit() distinct values: each one not among the options costs a getOptionLabelUsing() call.
        $values = array_slice(array_values(array_unique(array_filter($values, fn ($value) => (is_string($value) && $value !== '' && mb_strlen($value) <= 255) || is_int($value)))), 0, $filter->getOptionsLimit());

        foreach ($values as $value) {
            $label = $filter->getOptionLabel($value);

            if ($label !== null) {
                $labels[] = ['value' => (string) $value, 'label' => $label];
            }
        }

        return $labels;
    }

    /**
     * A schema never rendered, one FilterSelect per select filter, keyed
     * `spreadsheetFilters.<filter>`: Filament 4.16+ and 5.11+ ask a select's options
     * through `callSchemaComponentMethod` with that key (see partials/select).
     * Filament caches it by name on the first call.
     */
    public function spreadsheetFiltersSchema(Schema $schema): Schema
    {
        $components = [];

        foreach ($this->getSpreadsheet()->getFilters() as $filter) {
            if ($filter->isSelect() || $filter->isBoolean()) {
                $components[] = FilterSelect::make($filter->getName())->key($filter->getName());
            }
        }

        return $schema->components($components);
    }

    protected function spreadsheetFilter(string $name): ?Filter
    {
        foreach ($this->getSpreadsheet()->getFilters() as $filter) {
            if ($filter->getName() === $name) {
                return $filter;
            }
        }

        return null;
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
