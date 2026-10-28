<?php

namespace Packstub\Spreadsheet;

use Closure;
use Filament\Facades\Filament;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Traits\Conditionable;
use Packstub\Spreadsheet\Columns\Column;
use Packstub\Spreadsheet\Columns\ComputedColumn;
use Packstub\Spreadsheet\Columns\SelectColumn;
use Packstub\Spreadsheet\Enums\FiltersLayout;
use Packstub\Spreadsheet\Enums\SaveMode;
use Packstub\Spreadsheet\Events\RowSaveFailed;
use Packstub\Spreadsheet\Events\RowsSaved;
use Packstub\Spreadsheet\Exceptions\InvalidValue;
use Packstub\Spreadsheet\Exceptions\RolledBack;
use Packstub\Spreadsheet\Exceptions\SaveRejected;

/**
 * The sheet definition: which records, which columns, what may be written and
 * how. The page renders it once as JSON; after that the browser owns the grid
 * and only asks the server for a page of rows or to save a batch.
 *
 * Everything the browser sends is checked here again: a column must be one of
 * the definition's and editable for that record, a value is coerced by its column
 * and validated with Laravel's validator, a record must still be in query() and
 * the policy must allow the update, the create or the delete. A row whose
 * version changed since the user loaded it is refused as a conflict. Values go
 * through forceFill(): the columns listed here are the whitelist, the model's
 * $fillable is not consulted.
 */
class Spreadsheet
{
    use Conditionable;

    protected Builder|Closure|null $query = null;

    /** @var list<Column> */
    protected array $columns = [];

    protected ?int $perPage = null;

    /** @var list<string> */
    protected array $searchable = [];

    /** @var array{0: string, 1: string}|null */
    protected ?array $defaultSort = null;

    /** @var list<Filter> */
    protected array $filters = [];

    protected FiltersLayout|string|null $filtersLayout = null;

    protected bool $creatable = false;

    protected bool $deletable = false;

    protected ?SaveMode $saveMode = null;

    protected bool|Closure $readOnly = false;

    protected ?Closure $authorizeUpdate = null;

    protected ?Closure $authorizeCreate = null;

    protected ?Closure $authorizeDelete = null;

    protected string|false|null $versionColumn = null;

    protected ?Closure $beforeSave = null;

    protected ?Closure $afterSave = null;

    protected ?Closure $mutateRowBeforeSave = null;

    protected ?string $key = null;

    protected bool $prepared = false;

    public static function make(): static
    {
        return new static;
    }

    /* ------------------------------------------------------------------ configuration */

    /** The records in the sheet. Scope it here (tenant, team…): every read and every write goes through it. */
    public function query(Builder|Closure $query): static
    {
        $this->query = $query;

        return $this;
    }

    /** @param  list<Column>  $columns */
    public function columns(array $columns): static
    {
        $this->columns = array_values(array_filter($columns, fn ($column) => $column instanceof Column));
        $this->prepared = false;

        return $this;
    }

    /** Rows per page (default: the config's `per_page`; the user may pick up to `max_per_page`). */
    public function perPage(?int $perPage): static
    {
        $this->perPage = $perPage === null ? null : max(1, $perPage);

        return $this;
    }

    /**
     * Attributes the search box looks in (`like %term%`), a dotted path for a
     * relation's attribute (`category.name`).
     *
     * @param  list<string>  $attributes
     */
    public function searchable(array $attributes): static
    {
        $this->searchable = array_values(array_filter($attributes, 'is_string'));

        return $this;
    }

    public function defaultSort(?string $column, string $direction = 'asc'): static
    {
        $this->defaultSort = $column === null ? null : [$column, strtolower($direction) === 'desc' ? 'desc' : 'asc'];

        return $this;
    }

    /** @param  list<Filter>  $filters */
    public function filters(array $filters): static
    {
        $this->filters = array_values(array_filter($filters, fn ($filter) => $filter instanceof Filter));

        return $this;
    }

    /** Whether rows may be added (the toolbar button, Ctrl+Enter, a paste past the last row). Policy `create` still applies. */
    public function creatable(bool $condition = true): static
    {
        $this->creatable = $condition;

        return $this;
    }

    /** Whether rows may be deleted. Policy `delete` still applies to each. */
    public function deletable(bool $condition = true): static
    {
        $this->deletable = $condition;

        return $this;
    }

    public function saveMode(SaveMode|string|null $mode): static
    {
        $this->saveMode = is_string($mode) ? SaveMode::fromName($mode) : $mode;

        return $this;
    }

    /** Show only: nothing is written, the server refuses every save. A bool or a closure. */
    public function readOnly(bool|Closure $condition = true): static
    {
        $this->readOnly = $condition;

        return $this;
    }

    /** Whether a record may be changed: `fn (Model $record): bool`. Default: the model's policy (`update`), when it has one. */
    public function authorizeUpdate(?Closure $callback): static
    {
        $this->authorizeUpdate = $callback;

        return $this;
    }

    /** Whether rows may be added: `fn (): bool`. Default: the model's policy (`create`), when it has one. */
    public function authorizeCreate(?Closure $callback): static
    {
        $this->authorizeCreate = $callback;

        return $this;
    }

    /** Whether a record may be deleted: `fn (Model $record): bool`. Default: the model's policy (`delete`), when it has one. */
    public function authorizeDelete(?Closure $callback): static
    {
        $this->authorizeDelete = $callback;

        return $this;
    }

    /**
     * The attribute compared before a row is written (`updated_at` by default, see
     * the config): a row whose value changed since the user loaded it is refused
     * as a conflict. `false` turns the check off.
     */
    public function versionColumn(string|false|null $column): static
    {
        $this->versionColumn = $column;

        return $this;
    }

    /** Runs before anything is written: `fn (SavePayload $payload)`. Throw SaveRejected to refuse the whole save with a message. */
    public function beforeSave(?Closure $callback): static
    {
        $this->beforeSave = $callback;

        return $this;
    }

    /** Runs inside the transaction once every row is written: `fn (Collection $records)` (updated and created). An exception rolls the save back. */
    public function afterSave(?Closure $callback): static
    {
        $this->afterSave = $callback;

        return $this;
    }

    /** Shapes a row's data before it is written: `fn (array $data, ?Model $record): array` (`$record` is null for a new row). */
    public function mutateRowBeforeSave(?Closure $callback): static
    {
        $this->mutateRowBeforeSave = $callback;

        return $this;
    }

    /** Names the sheet in `RowsSaved` / `RowSaveFailed` (`$spreadsheet`); defaults to the page's class. */
    public function key(?string $key): static
    {
        $this->key = $key;

        return $this;
    }

    /* ------------------------------------------------------------------ reading the definition */

    public function hasQuery(): bool
    {
        return $this->query !== null;
    }

    /**
     * The columns shown, hidden ones left out.
     *
     * @return list<Column>
     */
    public function getColumns(): array
    {
        $this->prepare();

        return array_values(array_filter($this->columns, fn (Column $column) => ! $column->isHidden()));
    }

    public function getColumn(string $name): ?Column
    {
        foreach ($this->getColumns() as $column) {
            if ($column->getName() === $name) {
                return $column;
            }
        }

        return null;
    }

    public function getPerPage(): int
    {
        return $this->clampPerPage($this->perPage ?? (int) config('packstub-spreadsheet.per_page', 100));
    }

    public function getMaxPerPage(): int
    {
        return max(1, (int) config('packstub-spreadsheet.max_per_page', 1000));
    }

    /** The most rows (updates, creates and deletes) one save may carry; the browser stops a paste from creating more. */
    public function getMaxRowsPerSave(): int
    {
        return max(1, (int) config('packstub-spreadsheet.max_rows_per_save', 2000));
    }

    /** @return list<string> */
    public function getSearchable(): array
    {
        return $this->searchable;
    }

    /** @return array{column: string, direction: string} */
    public function getDefaultSort(): array
    {
        [$column, $direction] = $this->defaultSort ?? [$this->newModel()->getKeyName(), 'asc'];

        return ['column' => $column, 'direction' => $direction];
    }

    /** @return list<Filter> */
    public function getFilters(): array
    {
        return $this->filters;
    }

    /** Where the filters are shown: in a dropdown behind a funnel button (default), inline in the toolbar, or on a row above the grid. */
    public function filtersLayout(FiltersLayout|string $layout): static
    {
        $this->filtersLayout = $layout;

        return $this;
    }

    public function getFiltersLayout(): FiltersLayout
    {
        return FiltersLayout::fromConfig($this->filtersLayout ?? config('packstub-spreadsheet.filters_layout'));
    }

    public function isCreatable(): bool
    {
        return $this->creatable && ! $this->isReadOnly();
    }

    public function isDeletable(): bool
    {
        return $this->deletable && ! $this->isReadOnly();
    }

    public function getSaveMode(): SaveMode
    {
        $mode = config('packstub-spreadsheet.save_mode');

        return $this->saveMode ?? ($mode instanceof SaveMode ? $mode : SaveMode::fromName($mode));
    }

    public function isReadOnly(): bool
    {
        return (bool) ($this->readOnly instanceof Closure ? app()->call($this->readOnly) : $this->readOnly);
    }

    public function getVersionColumn(): ?string
    {
        if ($this->versionColumn === false) {
            return null;
        }

        $column = $this->versionColumn ?? config('packstub-spreadsheet.version_column', 'updated_at');

        return is_string($column) && $column !== '' ? $column : null;
    }

    public function hasAuthorizeUpdate(): bool
    {
        return $this->authorizeUpdate !== null;
    }

    public function hasAuthorizeCreate(): bool
    {
        return $this->authorizeCreate !== null;
    }

    public function hasAuthorizeDelete(): bool
    {
        return $this->authorizeDelete !== null;
    }

    public function getKey(): ?string
    {
        return $this->key;
    }

    /** @return class-string<Model> */
    public function getModel(): string
    {
        return $this->newModel()::class;
    }

    /* ------------------------------------------------------------------ authorisation */

    /** Whether the user may change this record now (policy `update`, or authorizeUpdate()). */
    public function canUpdate(Model $record): bool
    {
        if ($this->isReadOnly()) {
            return false;
        }

        return $this->authorizeUpdate ? (bool) ($this->authorizeUpdate)($record) : $this->gate('update', $record);
    }

    /** Whether the user may add rows now (creatable() and policy `create`, or authorizeCreate()). */
    public function canCreate(): bool
    {
        if (! $this->isCreatable()) {
            return false;
        }

        return $this->authorizeCreate ? (bool) ($this->authorizeCreate)() : $this->gate('create', null);
    }

    /** Whether the user may delete this record now (deletable() and policy `delete`, or authorizeDelete()). */
    public function canDelete(Model $record): bool
    {
        if (! $this->isDeletable()) {
            return false;
        }

        return $this->authorizeDelete ? (bool) ($this->authorizeDelete)($record) : $this->gate('delete', $record);
    }

    /**
     * The model's policy, when it has one with that ability; a model without a
     * policy is open, the page's own access check being the gate then.
     */
    protected function gate(string $ability, ?Model $record): bool
    {
        $model = $this->getModel();
        $policy = Gate::getPolicyFor($model);

        if ($policy === null || ! method_exists($policy, $ability)) {
            return true;
        }

        return Gate::forUser($this->user())->allows($ability, $record ?? $model);
    }

    protected function user(): ?Authenticatable
    {
        return Filament::getCurrentOrDefaultPanel()?->auth()->user() ?? auth()->user();
    }

    /* ------------------------------------------------------------------ reading rows */

    /**
     * One page of rows, as plain arrays. The request comes from the browser and is
     * read strictly: a page number, a page size clamped to the config, a sort on a
     * sortable column only, a search term and the filters' values.
     *
     * @param  array<string, mixed>  $request
     * @return array{rows: list<array<string, mixed>>, total: int, page: int, perPage: int, lastPage: int, sort: array{column: string, direction: string}}
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function rows(array $request = []): array
    {
        $this->prepare();

        $perPage = $this->clampPerPage($request['perPage'] ?? null);
        $page = $this->clampPage($request['page'] ?? null, $perPage);
        $sort = $this->resolveSort($request['sort'] ?? null);
        $search = is_string($request['search'] ?? null) ? trim(mb_substr($request['search'], 0, 200)) : '';
        $filters = is_array($request['filters'] ?? null) ? $request['filters'] : [];

        $query = $this->filteredQuery($filters);

        if ($search !== '') {
            $this->applySearch($query, $search);
        }

        $keyName = $query->getModel()->getQualifiedKeyName();
        $query->orderBy($query->qualifyColumn($sort['column']), $sort['direction']);

        if ($query->qualifyColumn($sort['column']) !== $keyName) {
            $query->orderBy($keyName);
        }

        $paginator = $query->paginate($perPage, ['*'], 'page', $page);

        return [
            'rows' => $paginator->getCollection()->map(fn (Model $record) => $this->presentRow($record))->values()->all(),
            'total' => $paginator->total(),
            'page' => $paginator->currentPage(),
            'perPage' => $perPage,
            'lastPage' => max(1, $paginator->lastPage()),
            'sort' => $sort,
        ];
    }

    /**
     * A record as the browser sees it: its key, its version, one value per column,
     * the columns locked for this record and whether it may be changed or deleted.
     *
     * @return array<string, mixed>
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function presentRow(Model $record): array
    {
        $this->prepare();

        $values = [];
        $locked = [];

        $formulas = [];

        foreach ($this->getColumns() as $column) {
            if ($column instanceof ComputedColumn && $column->getFormula() !== null) {
                $formulas[$column->getName()] = $column;
                $values[$column->getName()] = null;

                continue;
            }

            $values[$column->getName()] = $column->present($record);

            if ($column->hasRecordReadOnly() && $column->isReadOnlyFor($record)) {
                $locked[] = $column->getName();
            }
        }

        // Formulas read the row's other values (after casts), a formula column its value once computed.
        $done = [];
        $resolve = function (string $name) use (&$resolve, &$values, &$done, $formulas): mixed {
            if (isset($formulas[$name]) && ! isset($done[$name])) {
                $done[$name] = true;
                $values[$name] = $formulas[$name]->compute($resolve);
            }

            return $values[$name] ?? null;
        };

        foreach (array_keys($formulas) as $name) {
            $resolve($name);
        }

        return [
            'id' => (string) $record->getKey(),
            'version' => $this->version($record),
            'values' => $values,
            'locked' => $locked,
            'readOnly' => ! $this->canUpdate($record),
            'deletable' => $this->canDelete($record),
        ];
    }

    /**
     * The record's version as a string (the raw attribute), null without a version column.
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function version(Model $record): ?string
    {
        $column = $this->getVersionColumn();

        if ($column === null) {
            return null;
        }

        $raw = $record->getAttributes()[$column] ?? null;

        if ($raw instanceof \DateTimeInterface) {
            $raw = $raw->format('Y-m-d H:i:s.u');
        }

        return $raw === null ? null : (string) $raw;
    }

    /* ------------------------------------------------------------------ writing */

    /**
     * Write a batch. Every row is authorised, coerced and validated on the server,
     * inside one transaction in both modes, each row written to a savepoint of it:
     * AllOrNothing rolls everything back on the first refused row (all the errors
     * still come back); PerRow rolls a refused row back to its savepoint on its
     * own and keeps the good ones. A refused batch (read-only sheet, too many rows, beforeSave())
     * throws SaveRejected with the message for the user; an exception thrown after
     * the rows (afterSave()'s, say) rolls the whole batch back in both modes and
     * propagates, for the caller to report.
     *
     * @throws SaveRejected
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function save(SavePayload $payload): SaveResult
    {
        $this->prepare();

        if ($this->isReadOnly()) {
            throw new SaveRejected(__('packstub-spreadsheet::spreadsheet.read_only'));
        }

        $max = $this->getMaxRowsPerSave();

        if ($payload->rowCount() > $max) {
            throw new SaveRejected(__('packstub-spreadsheet::spreadsheet.too_many_rows', ['max' => $max]));
        }

        $result = new SaveResult;

        if ($payload->isEmpty()) {
            return $result;
        }

        if ($this->beforeSave) {
            ($this->beforeSave)($payload);
        }

        $updated = new Collection;
        $created = new Collection;
        $deleted = [];
        /** @var list<array{0: ?Model, 1: array<string, mixed>, 2: array<string, string>, 3: ?string}> */
        $failed = [];
        $perRow = $this->getSaveMode() === SaveMode::PerRow;

        $work = function () use ($payload, $result, $updated, $created, &$deleted, &$failed, $perRow): void {
            $records = $this->findRecords([...array_keys($payload->changed), ...$payload->deleted], lock: true);

            foreach ($payload->changed as $id => $values) {
                $record = $records[$id] ?? null;
                $errors = [];

                if ($record === null) {
                    $reason = __('packstub-spreadsheet::spreadsheet.missing');
                } elseif (! $this->canUpdate($record)) {
                    $reason = __('packstub-spreadsheet::spreadsheet.cannot_update');
                } elseif ($this->tooManyCells($values)) {
                    $reason = __('packstub-spreadsheet::spreadsheet.too_many_cells');
                } elseif ($this->conflicts($record, $payload->version($id), $values, $result)) {
                    $reason = __('packstub-spreadsheet::spreadsheet.conflict');
                } else {
                    // Every error at once: the cells that could be read are validated even when another could not.
                    $data = $this->coerceRow($values, $record, $errors);
                    $errors = [...$errors, ...$this->validateRow($data, $record, array_keys($data))];
                    $reason = null;
                }

                if ($reason !== null || $errors !== []) {
                    $this->refuse($result, $id, $errors, $reason);
                    $failed[] = [$record, $values, $errors, $reason];

                    continue;
                }

                if (! $this->write($result, $id, $perRow, fn () => $this->persist($record, $data))) {
                    $failed[] = [$record, $values, [], __('packstub-spreadsheet::spreadsheet.row_failed')];

                    continue;
                }

                $updated->push($record);
            }

            foreach ($payload->created as $temp => $values) {
                $errors = [];

                if (! $this->canCreate()) {
                    $this->refuse($result, $temp, [], __('packstub-spreadsheet::spreadsheet.cannot_create'));
                    $failed[] = [null, $values, [], __('packstub-spreadsheet::spreadsheet.cannot_create')];

                    continue;
                }

                if ($this->tooManyCells($values)) {
                    $this->refuse($result, $temp, [], __('packstub-spreadsheet::spreadsheet.too_many_cells'));
                    $failed[] = [null, $values, [], __('packstub-spreadsheet::spreadsheet.too_many_cells')];

                    continue;
                }

                $record = $this->newModel();
                $data = [...$this->defaults(), ...$this->coerceRow($values, $record, $errors)];
                $columns = array_filter(array_map(fn (Column $c) => $c->getName(), $this->editableColumns()), fn (string $name) => ! isset($errors[$name]));
                $errors = [...$errors, ...$this->validateRow($data, null, array_values($columns))];

                if ($errors !== []) {
                    $this->refuse($result, $temp, $errors, null);
                    $failed[] = [null, $values, $errors, null];

                    continue;
                }

                if (! $this->write($result, $temp, $perRow, fn () => $this->persist($record, $data))) {
                    $failed[] = [null, $values, [], __('packstub-spreadsheet::spreadsheet.row_failed')];

                    continue;
                }

                $created->put($temp, $record);
            }

            foreach ($payload->deleted as $id) {
                $record = $records[$id] ?? null;

                if ($record === null) {
                    $reason = __('packstub-spreadsheet::spreadsheet.missing');
                } elseif (! $this->canDelete($record)) {
                    $reason = __('packstub-spreadsheet::spreadsheet.cannot_delete');
                } else {
                    $reason = null;
                }

                if ($reason !== null) {
                    $this->refuse($result, $id, [], $reason);
                    $failed[] = [$record, [], [], $reason];

                    continue;
                }

                if (! $this->write($result, $id, $perRow, fn () => $record->delete(), 'row_delete_failed')) {
                    $failed[] = [$record, [], [], __('packstub-spreadsheet::spreadsheet.row_delete_failed')];

                    continue;
                }

                $deleted[] = $id;
            }

            if (! $perRow && $result->hasFailures()) {
                throw new RolledBack;
            }

            if ($this->afterSave && ($updated->isNotEmpty() || $created->isNotEmpty())) {
                ($this->afterSave)($updated->merge($created->values()));
            }
        };

        try {
            // One transaction in both modes; write() nests a savepoint per row.
            DB::connection($this->newModel()->getConnectionName())->transaction($work);
        } catch (RolledBack) {
            $result->rolledBack = true;
            $result->message = __('packstub-spreadsheet::spreadsheet.not_saved');
            $updated = new Collection;
            $created = new Collection;
            $deleted = [];
        }

        foreach ($failed as [$record, $data, $errors, $reason]) {
            RowSaveFailed::dispatch($record, $data, $errors, $reason, $this->key);
        }

        if ($result->rolledBack) {
            return $result;
        }

        // The rows are committed from here on: a listener or a re-read that throws is reported, and the
        // answer still says what was written. Answered as a failure, the browser would keep its buffer and
        // the next Save would create the new rows again and find its own updates in conflict.
        if ($updated->isNotEmpty() || $created->isNotEmpty() || $deleted !== []) {
            try {
                RowsSaved::dispatch($updated->values(), $created->values(), $deleted, $this->key);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        try {
            $fresh = $this->freshRows($updated->merge($created->values()));
        } catch (\Throwable $e) {
            report($e);
            $fresh = [];
        }

        foreach ($updated as $record) {
            $result->saved[(string) $record->getKey()] = $fresh[(string) $record->getKey()] ?? $this->savedRow($record);
        }

        foreach ($created as $temp => $record) {
            $result->created[$temp] = $fresh[(string) $record->getKey()] ?? $this->savedRow($record);
        }

        $result->deleted = $deleted;

        return $result;
    }

    /**
     * Delete records by key, through the same checks as a Save (deletable(),
     * policy, transaction mode). A convenience over save() with only deletes.
     *
     * @param  list<string>  $ids
     *
     * @throws SaveRejected
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function delete(array $ids): SaveResult
    {
        return $this->save(SavePayload::fromArray(['deleted' => $ids]));
    }

    /* ------------------------------------------------------------------ internals */

    /** @internal called by the Livewire trait; its shape may change in a minor */
    public function baseQuery(): Builder
    {
        $query = $this->query instanceof Closure ? app()->call($this->query) : $this->query;

        if (! $query instanceof Builder) {
            throw new \LogicException('The Spreadsheet needs a query(): an Eloquent builder or a closure returning one.');
        }

        return clone $query;
    }

    /**
     * @param  array<string, mixed>  $filters
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function filteredQuery(array $filters = []): Builder
    {
        $query = $this->baseQuery();

        foreach ($this->filters as $filter) {
            $filter->apply($query, $filters[$filter->getName()] ?? null);
        }

        return $query;
    }

    /**
     * The records behind a list of keys that are still in the sheet for this user.
     *
     * @param  list<string>  $ids
     * @return array<string, Model>
     *
     * @internal called by the Livewire trait; its shape may change in a minor
     */
    public function findRecords(array $ids, bool $lock = false): array
    {
        $ids = array_values(array_unique(array_filter($ids, fn ($id) => $id !== '')));

        if ($this->newModel()->getKeyType() === 'int') {
            // An integer key is queried with integers only: anything else is answered as
            // missing rather than sent to the database (Postgres refuses `id in ('abc')`).
            $ids = array_values(array_filter($ids, fn ($id) => $this->isIntegerKey((string) $id)));
        }

        if ($ids === []) {
            return [];
        }

        $records = [];

        $query = $this->baseQuery()->whereKey($ids);

        // A save locks its rows until it commits: two saves of the same row run one after the other, and
        // the second sees the first's version (a conflict) instead of overwriting it.
        if ($lock) {
            $query->lockForUpdate();
        }

        foreach ($query->get() as $record) {
            $records[(string) $record->getKey()] = $record;
        }

        return $records;
    }

    /**
     * A key an integer column can hold: digits only, and within 64 bits (Postgres
     * raises "out of range for type bigint" for `id in ('99999999999999999999999')`,
     * which would fail the whole batch).
     */
    protected function isIntegerKey(string $id): bool
    {
        if (! ctype_digit($id)) {
            return false;
        }

        $digits = ltrim($id, '0') ?: '0';

        return strlen($digits) <= 19 && (string) (int) $digits === $digits;
    }

    /** @return array{column: string, direction: string} */
    protected function resolveSort(mixed $sort): array
    {
        $default = $this->getDefaultSort();

        if (! is_array($sort) || ! is_string($sort['column'] ?? null)) {
            return $default;
        }

        $column = $this->getColumn($sort['column']);

        if ($column === null || ! $column->isSortable()) {
            return $default;
        }

        return ['column' => $column->getName(), 'direction' => strtolower((string) ($sort['direction'] ?? 'asc')) === 'desc' ? 'desc' : 'asc'];
    }

    protected function applySearch(Builder $query, string $term): void
    {
        if ($this->searchable === []) {
            return;
        }

        $operator = $query->getConnection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
        $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $term).'%';

        // `!` escapes the wildcards, with an explicit ESCAPE clause: SQLite has no
        // escape character by default, and a backslash there is a parse error on
        // MySQL (`'\'` never closes the literal). `!` works on all three, so "100%"
        // finds "100% cotton" everywhere.
        $match = fn (Builder $q, string $column, string $boolean) => $q->whereRaw($q->getGrammar()->wrap($q->qualifyColumn($column))." {$operator} ? escape '!'", [$like], $boolean);

        $query->where(function (Builder $q) use ($match): void {
            foreach ($this->searchable as $path) {
                if (str_contains($path, '.')) {
                    // The relation's own constraint is an AND inside the EXISTS; the OR is between the paths.
                    $q->orWhereHas(str($path)->beforeLast('.')->toString(), fn (Builder $r) => $match($r, str($path)->afterLast('.')->toString(), 'and'));
                } else {
                    $match($q, $path, 'or');
                }
            }
        });
    }

    protected function clampPerPage(mixed $perPage): int
    {
        $perPage = is_numeric($perPage) ? (int) $perPage : ($this->perPage ?? (int) config('packstub-spreadsheet.per_page', 100));

        return max(1, min($this->getMaxPerPage(), $perPage));
    }

    /**
     * A page number the paginator can offset: at least 1, and no more than
     * PHP_INT_MAX / perPage (a crafted `page` past that would overflow the
     * offset's multiplication; the browser itself never asks past `lastPage`).
     * Anything that is not a number is page 1.
     */
    protected function clampPage(mixed $page, int $perPage): int
    {
        if (! is_numeric($page)) {
            return 1;
        }

        return (int) max(1, min(intdiv(PHP_INT_MAX, $perPage), $page));
    }

    /**
     * Whether the record changed since the browser loaded it. When it did, the
     * result gets the other user's value for every changed column and the current
     * version, so the user can take theirs or save again to win. A row sent without
     * its version while the record has one is a conflict too: the browser always
     * sends the versions it loaded, so a payload without them did not come from the
     * sheet, and the check is the server's, never opt-in from the browser. Without a
     * version column (`versionColumn(false)`, a model without timestamps) there is
     * nothing to compare and the last write wins.
     *
     * @param  array<string, mixed>  $values
     */
    protected function conflicts(Model $record, ?string $seen, array $values, SaveResult $result): bool
    {
        $current = $this->version($record);

        if ($current === null || $seen === $current) {
            return false;
        }

        $theirs = [];

        foreach ($values as $name => $value) {
            if ($column = $this->getColumn($name)) {
                $theirs[$name] = $column->present($record);
            }
        }

        $result->conflicts[(string) $record->getKey()] = $theirs;
        $result->versions[(string) $record->getKey()] = $current;

        return true;
    }

    /**
     * The browser's values as attribute values: only the sheet's editable columns,
     * not locked for this record, each read by its column. Errors land on the cell.
     *
     * @param  array<string, mixed>  $values
     * @param  array<string, string>  $errors
     * @return array<string, mixed>
     */
    protected function coerceRow(array $values, Model $record, array &$errors): array
    {
        $data = [];

        foreach ($values as $name => $value) {
            $column = $this->getColumn($name);

            if ($column === null || ! $column->isEditable() || $column->isReadOnly() || $column->isReadOnlyFor($record)) {
                $errors[$name] = __('packstub-spreadsheet::spreadsheet.not_editable');

                continue;
            }

            try {
                $data[$name] = $column->coerce($value);
            } catch (InvalidValue $e) {
                $errors[$name] = $e->getMessage();
            }
        }

        return $data;
    }

    /**
     * Laravel's validator over the row: the given columns' rules (the column's own,
     * a `unique` ignoring the record, the type's) against the record's attributes
     * with the new values laid over, the columns' own messages and attribute names.
     *
     * @param  array<string, mixed>  $data
     * @param  list<string>  $columns
     * @return array<string, string>
     */
    protected function validateRow(array $data, ?Model $record, array $columns): array
    {
        $rules = [];
        $names = [];
        $messages = [];

        foreach ($columns as $name) {
            if ($column = $this->getColumn($name)) {
                $rules[$name] = $column->getRules($record);
                $names[$name] = $column->getValidationAttribute();

                foreach ($column->getValidationMessages($record) as $rule => $message) {
                    $messages["{$name}.{$rule}"] = $message;
                }
            }
        }

        if ($rules === []) {
            return [];
        }

        $row = $record ? [...$record->attributesToArray(), ...$data] : $data;
        $validator = Validator::make($row, $rules, $messages, $names);
        $errors = [];

        if ($validator->fails()) {
            foreach (array_keys($rules) as $name) {
                if ($message = $validator->errors()->first($name)) {
                    $errors[$name] = $message;
                }
            }
        }

        return $errors;
    }

    /**
     * One row's write, inside its own savepoint (a nested transaction) in both
     * modes: a statement the database refuses (a NOT NULL or a foreign key the
     * rules did not cover) rolls back to the savepoint, is reported and lands on
     * the row, and the batch's transaction stays usable for the later rows' checks
     * (a `unique` rule, a policy that queries), which Postgres would otherwise
     * refuse until the end of the aborted transaction. In PerRow mode any
     * exception is a row error and the other rows go on; in AllOrNothing mode the
     * batch is rolled back at the end (RolledBack) and any exception that is not
     * the database's propagates to roll it back at once.
     */
    protected function write(SaveResult $result, string $key, bool $perRow, Closure $operation, string $failure = 'row_failed'): bool
    {
        try {
            DB::connection($this->newModel()->getConnectionName())->transaction($operation);
        } catch (SaveRejected $e) {
            if (! $perRow) {
                throw $e;
            }

            $result->rowError($key, $e->getMessage());

            return false;
        } catch (\Throwable $e) {
            if (! $perRow && ! $e instanceof QueryException) {
                throw $e;
            }

            report($e);
            $result->rowError($key, __('packstub-spreadsheet::spreadsheet.'.$failure));

            return false;
        }

        return true;
    }

    /** @param  array<string, mixed>  $data */
    protected function persist(Model $record, array $data): void
    {
        if ($this->mutateRowBeforeSave) {
            $data = ($this->mutateRowBeforeSave)($data, $record->exists ? $record : null);
        }

        $record->forceFill($data)->save();
    }

    /**
     * A row carrying far more cells than the sheet has columns did not come from
     * the grid: it is refused with one reason instead of one error per unknown key.
     *
     * @param  array<string, mixed>  $values
     */
    protected function tooManyCells(array $values): bool
    {
        return count($values) > max(1, 2 * count($this->getColumns()));
    }

    /** @param  array<string, string>  $errors */
    protected function refuse(SaveResult $result, string $key, array $errors, ?string $reason): void
    {
        foreach ($errors as $column => $message) {
            $result->cellError($key, $column, $message);
        }

        if ($reason !== null && ! isset($result->conflicts[$key])) {
            $result->rowError($key, $reason);
        }
    }

    /** @return array<string, mixed> */
    protected function defaults(): array
    {
        $defaults = [];

        foreach ($this->editableColumns() as $column) {
            $default = $column->getDefault();

            if ($default !== null) {
                $defaults[$column->getName()] = $default;
            }
        }

        return $defaults;
    }

    /** @return list<Column> */
    protected function editableColumns(): array
    {
        return array_values(array_filter($this->getColumns(), fn (Column $column) => $column->isEditable() && ! $column->isReadOnly()));
    }

    /**
     * The rows as they are after the write, re-read so casts, mutators and database
     * defaults show; a record the model's query no longer returns is presented as it is.
     *
     * @param  Collection<int|string, Model>  $records
     * @return array<string, array<string, mixed>>
     */
    protected function freshRows(Collection $records): array
    {
        if ($records->isEmpty()) {
            return [];
        }

        $keys = $records->map(fn (Model $r) => $r->getKey())->all();
        $rows = [];

        // Through query() first, so its with(), withCount() and selects are there as on the page; a row
        // the save moved out of it (a filter column changed) is read on its own.
        foreach ($this->baseQuery()->whereKey($keys)->get() as $record) {
            $rows[(string) $record->getKey()] = $this->presentRow($record);
        }

        $missing = array_values(array_filter($keys, fn ($key) => ! isset($rows[(string) $key])));

        if ($missing !== []) {
            foreach ($this->newModel()->newQuery()->whereKey($missing)->get() as $record) {
                $rows[(string) $record->getKey()] = $this->presentRow($record);
            }
        }

        return $rows;
    }

    /**
     * A saved record as the answer gives it when it could not be read again: the record in memory,
     * or only its key and version when even that cannot be presented.
     *
     * @return array<string, mixed>
     */
    protected function savedRow(Model $record): array
    {
        try {
            return $this->presentRow($record);
        } catch (\Throwable $e) {
            report($e);

            return ['id' => (string) $record->getKey(), 'version' => $this->version($record)];
        }
    }

    /** Give the relationship selects their options once per instance. */
    protected function prepare(): void
    {
        if ($this->prepared) {
            return;
        }

        $this->prepared = true;

        foreach ($this->columns as $column) {
            if ($column instanceof SelectColumn && $column->getRelationshipName() !== null) {
                $column->prepare($this->newModel());
            }
        }

        $this->checkFormulas();
    }

    /** Every name a formula reads is a column of the sheet, and no formula reads itself through another. */
    protected function checkFormulas(): void
    {
        $columns = [];
        foreach ($this->getColumns() as $column) {
            $columns[$column->getName()] = $column;
        }

        $state = [];
        $visit = function (string $name, array $path) use (&$visit, &$state, $columns): void {
            $column = $columns[$name];
            $formula = $column instanceof ComputedColumn ? $column->getFormula() : null;

            if ($formula === null || ($state[$name] ?? null) === 'done') {
                return;
            }

            if (($state[$name] ?? null) === 'visiting') {
                throw new \LogicException('ComputedColumn ['.$path[0].']: the formula reads itself ('.implode(' → ', [...$path, $name]).').');
            }

            $state[$name] = 'visiting';

            foreach ($formula->references() as $ref) {
                if (! isset($columns[$ref])) {
                    throw new \LogicException("ComputedColumn [{$name}]: the formula reads [{$ref}], which is not a column of the sheet (a hidden column is not).");
                }

                $visit($ref, [...$path, $name]);
            }

            $state[$name] = 'done';
        };

        foreach (array_keys($columns) as $name) {
            $visit($name, []);
        }
    }

    protected function newModel(): Model
    {
        return $this->baseQuery()->getModel();
    }
}
