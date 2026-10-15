<?php

namespace Packstub\Spreadsheet;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use LogicException;

/**
 * A filter in the toolbar. One class, the same in Kanban, Gantt and Spreadsheet:
 *
 *  - `Filter::select('owner_id')` (or `Filter::make()`): one option, Filament's own select;
 *    `->multiple()` several at once (the default narrows with `whereIn`, `query()` gets a list);
 *    `->searchable()` lets the user type to find an option, with `preload()`,
 *    `getSearchResultsUsing()`, `getOptionLabelUsing()` and `optionsLimit()`.
 *  - `Filter::boolean('is_active')`: a Yes / No select; `query()` gets a bool.
 *  - `Filter::toggle('mine')`: one checkbox with the label; `query()` is required and gets `true`.
 *  - `Filter::dateRange('due_at')`: From / Until date pickers; `query()` gets
 *    `['from' => ?string, 'until' => ?string]` (`Y-m-d`, either side may be null).
 *
 * Applied on the server only. Whatever the browser or the URL sends is checked again
 * here: a plain select takes one of its options and nothing else (per value for a
 * multiple), a searchable select takes any key (its values come from a search, the
 * query decides what matches), a date range takes real calendar dates only.
 */
class Filter
{
    public const SELECT = 'select';

    public const BOOLEAN = 'boolean';

    public const TOGGLE = 'toggle';

    public const DATE_RANGE = 'dateRange';

    protected string|Closure|null $label = null;

    /** @var array<string|int, string>|Closure */
    protected array|Closure $options = [];

    /** The options, resolved once per request (a closure usually runs a query). */
    protected ?array $resolvedOptions = null;

    protected ?Closure $query = null;

    protected bool $multiple = false;

    protected bool|Closure $searchable = false;

    protected bool $preload = true;

    protected ?Closure $searchResults = null;

    protected ?Closure $optionLabel = null;

    protected int $optionsLimit = 50;

    final public function __construct(protected string $name, protected string $type = self::SELECT) {}

    public static function make(string $name): static
    {
        return new static($name);
    }

    public static function select(string $name): static
    {
        return new static($name, self::SELECT);
    }

    /** A Yes / No select; by default it narrows `<name>` to true or false. */
    public static function boolean(string $name): static
    {
        return new static($name, self::BOOLEAN);
    }

    /** One checkbox with the filter's label, no options; `query()` is required and gets `true` when it is on. */
    public static function toggle(string $name): static
    {
        return new static($name, self::TOGGLE);
    }

    /** From / until date pickers; by default they narrow `<name>` to the days between (either side may be left open). */
    public static function dateRange(string $name): static
    {
        return new static($name, self::DATE_RANGE);
    }

    public function label(string|Closure|null $label): static
    {
        $this->label = $label;

        return $this;
    }

    /** @param  array<string|int, string>|Closure  $options */
    public function options(array|Closure $options): static
    {
        $this->options = $options;
        $this->resolvedOptions = null;

        return $this;
    }

    /**
     * How a chosen value narrows the query. Default: `where(<name>, <value>)` for a
     * select (`whereIn` for a multiple one), `where(<name>, true|false)` for a boolean,
     * `where(<name>, >=, from)` and `where(<name>, <, the day after until)` for a date
     * range. The closure gets the value as a string (an option key, `"3"` for an id), a
     * list of strings for `multiple()`, a bool for `boolean()`, `true` for `toggle()`,
     * `['from' => ?string, 'until' => ?string]` for `dateRange()`.
     */
    public function query(Closure $callback): static
    {
        $this->query = $callback;

        return $this;
    }

    /** Several options at once: `query()` gets a list, the default applies `whereIn`. */
    public function multiple(bool $condition = true): static
    {
        $this->multiple = $condition;

        return $this;
    }

    /**
     * Let the user type to find an option (many users, many rooms). With preload()
     * (the default) the options are sent with the component and the search runs on the
     * server through getSearchResultsUsing(), or over the options' labels; without
     * preload nothing is listed until the user types.
     */
    public function searchable(bool|Closure $condition = true): static
    {
        $this->searchable = $condition;

        return $this;
    }

    /** Whether a searchable select sends its options with the component (default) or waits for a search. */
    public function preload(bool $condition = true): static
    {
        $this->preload = $condition;

        return $this;
    }

    /** `fn (string $search): array<string|int, string>`, the options matching a search; default: the options whose label contains it. */
    public function getSearchResultsUsing(?Closure $callback): static
    {
        $this->searchResults = $callback;

        return $this;
    }

    /** `fn (string $value): ?string`, the label of a value that is not among the listed options (one restored from the URL). */
    public function getOptionLabelUsing(?Closure $callback): static
    {
        $this->optionLabel = $callback;

        return $this;
    }

    /** How many options a list or a search shows at most (default 50). */
    public function optionsLimit(int $limit): static
    {
        $this->optionsLimit = max(1, $limit);

        return $this;
    }

    // ------------------------------------------------------------------ reads

    public function getName(): string
    {
        return $this->name;
    }

    /** 'select', 'boolean', 'toggle' or 'dateRange' */
    public function getType(): string
    {
        return $this->type;
    }

    public function isSelect(): bool
    {
        return $this->type === self::SELECT;
    }

    public function isBoolean(): bool
    {
        return $this->type === self::BOOLEAN;
    }

    public function isToggle(): bool
    {
        return $this->type === self::TOGGLE;
    }

    public function isDateRange(): bool
    {
        return $this->type === self::DATE_RANGE;
    }

    public function isMultiple(): bool
    {
        return $this->isSelect() && $this->multiple;
    }

    public function isSearchable(): bool
    {
        return $this->isSelect() && (bool) ($this->searchable instanceof Closure ? app()->call($this->searchable) : $this->searchable);
    }

    public function isPreloaded(): bool
    {
        return $this->preload;
    }

    public function getOptionsLimit(): int
    {
        return $this->optionsLimit;
    }

    public function getLabel(): string
    {
        $label = $this->label instanceof Closure ? app()->call($this->label) : $this->label;

        return (string) ($label ?? str($this->name)->beforeLast('_id')->beforeLast('_at')->headline());
    }

    /** @return array<string|int, string> */
    public function getOptions(): array
    {
        if ($this->isToggle() || $this->isDateRange()) {
            return [];
        }

        if ($this->isBoolean()) {
            return ['1' => __('packstub-spreadsheet::spreadsheet.yes'), '0' => __('packstub-spreadsheet::spreadsheet.no')];
        }

        return $this->resolvedOptions ??= $this->options instanceof Closure ? app()->call($this->options) : $this->options;
    }

    public function hasQuery(): bool
    {
        return $this->query !== null;
    }

    /**
     * A toggle has no default query, so it needs one: checked when the component's
     * config is built (the first render), not the first time a user turns it on.
     *
     * @throws LogicException
     */
    public function assertUsable(): void
    {
        if ($this->isToggle() && ! $this->query) {
            throw new LogicException("Filter [{$this->name}] is a toggle: give it a query() closure, there is no default.");
        }
    }

    /**
     * The options matching what the user typed, at most optionsLimit() of them.
     *
     * @return array<string|int, string>
     */
    public function getSearchResults(string $search): array
    {
        if ($this->searchResults) {
            $results = ($this->searchResults)($search);
        } else {
            $needle = mb_strtolower(trim($search));
            $results = array_filter($this->getOptions(), fn ($label) => $needle === '' || str_contains(mb_strtolower((string) $label), $needle));
        }

        return array_slice($results, 0, $this->optionsLimit, preserve_keys: true);
    }

    /** The label of a value: from the options, else from getOptionLabelUsing(), else null. */
    public function getOptionLabel(string|int $value): ?string
    {
        $options = $this->getOptions();

        if (array_key_exists($value, $options)) {
            return (string) $options[$value];
        }

        $label = $this->optionLabel ? ($this->optionLabel)((string) $value) : null;

        return $label === null ? null : (string) $label;
    }

    // ------------------------------------------------------------------ applying

    /**
     * Narrow the query with what the browser sent, if it is something this filter
     * offers. Anything else is ignored, in whole for a select and per value for a
     * multiple one.
     */
    public function apply(Builder $query, mixed $value): void
    {
        if ($this->isDateRange()) {
            $this->applyDateRange($query, $value);

            return;
        }

        // Nothing chosen: leave the query alone without resolving the options (a query of their own).
        if (blank($value)) {
            return;
        }

        if ($this->isToggle()) {
            if (! $this->isOn($value)) {
                return;
            }

            $this->assertUsable();

            ($this->query)($query, true);

            return;
        }

        if ($this->isMultiple()) {
            $values = $this->known(is_array($value) ? array_values($value) : [$value]);

            if ($values === []) {
                return;
            }

            if ($this->query) {
                ($this->query)($query, $values);

                return;
            }

            $query->whereIn($query->qualifyColumn($this->name), $values);

            return;
        }

        if (is_array($value) || ($values = $this->known([$value])) === []) {
            return;
        }

        $chosen = $this->isBoolean() ? $values[0] === '1' : $values[0];

        if ($this->query) {
            ($this->query)($query, $chosen);

            return;
        }

        $query->where($query->qualifyColumn($this->name), $chosen);
    }

    protected function applyDateRange(Builder $query, mixed $value): void
    {
        $from = static::date(is_array($value) ? ($value['from'] ?? null) : null);
        $until = static::date(is_array($value) ? ($value['until'] ?? null) : null);

        if ($from === null && $until === null) {
            return;
        }

        if ($this->query) {
            ($this->query)($query, ['from' => $from, 'until' => $until]);

            return;
        }

        $column = $query->qualifyColumn($this->name);

        // Plain ranges, never DATE(column): the column's index stays in use. The last
        // day is included by asking for less than the day after it, which reads a
        // date and a datetime column the same way.
        if ($from !== null) {
            $query->where($column, '>=', $from);
        }

        if ($until !== null) {
            $query->where($column, '<', CarbonImmutable::parse($until, 'UTC')->addDay()->toDateString());
        }
    }

    /**
     * The values this filter accepts among the given ones, as strings (what the
     * browser and the URL send), without duplicates: the option keys, in the options'
     * order, for a plain select; any non-blank scalar for a searchable one (its values
     * come from a search, the query decides).
     *
     * @param  list<mixed>  $values
     * @return list<string>
     */
    protected function known(array $values): array
    {
        $values = array_values(array_unique(array_map('strval', array_filter($values, fn ($value) => (is_int($value) || is_string($value)) && ! blank($value)))));

        if ($values === []) {
            return [];
        }

        if ($this->isSearchable()) {
            return $values;
        }

        return array_map('strval', array_keys(array_intersect_key($this->getOptions(), array_flip($values))));
    }

    /**
     * What the browser holds for a value from the URL: one accepted value ('' for none)
     * for a select or a boolean, the accepted ones for a multiple, on or off for a
     * toggle, `['from' => ?string, 'until' => ?string]` for a date range.
     *
     * @return string|list<string>|bool|array{from: ?string, until: ?string}
     */
    public function state(mixed $value): string|array|bool
    {
        if ($this->isDateRange()) {
            return [
                'from' => static::date(is_array($value) ? ($value['from'] ?? null) : null),
                'until' => static::date(is_array($value) ? ($value['until'] ?? null) : null),
            ];
        }

        if ($this->isToggle()) {
            return ! blank($value) && $this->isOn($value);
        }

        if ($this->isMultiple()) {
            return blank($value) ? [] : $this->known(is_array($value) ? array_values($value) : [$value]);
        }

        return blank($value) || is_array($value) ? '' : ($this->known([$value])[0] ?? '');
    }

    /** The empty state of this filter, what "no choice" looks like in the browser. */
    public function emptyState(): string|array|bool
    {
        return match (true) {
            $this->isDateRange() => ['from' => null, 'until' => null],
            $this->isToggle() => false,
            $this->isMultiple() => [],
            default => '',
        };
    }

    protected function isOn(mixed $value): bool
    {
        return is_bool($value) ? $value : (is_scalar($value) && filter_var($value, FILTER_VALIDATE_BOOLEAN));
    }

    /**
     * A `Y-m-d` string naming a real calendar date, or null for anything else: the
     * browser cannot inject a raw value, and a rolled-over date from a hand-edited
     * URL (`2026-02-30`, which some databases refuse) never reaches the query.
     */
    public static function date(mixed $value): ?string
    {
        return is_string($value)
            && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1
            && (int) $m[1] >= 1000
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1])
                ? $value
                : null;
    }

    /**
     * What the browser needs to draw the filter. A searchable select without preload
     * sends no options (the search fetches them); a date range and a toggle have none.
     *
     * @return array{name: string, label: string, type: string, multiple: bool, searchable: bool, optionsLimit: int, options: list<array{value: string, label: string}>}
     */
    public function toArray(): array
    {
        $searchable = $this->isSearchable();
        $options = ($searchable && ! $this->preload) ? [] : $this->getOptions();

        return [
            'name' => $this->name,
            'label' => $this->getLabel(),
            'type' => $this->type,
            'multiple' => $this->isMultiple(),
            'searchable' => $searchable,
            'optionsLimit' => $this->optionsLimit,
            'options' => collect($options)->take($this->optionsLimit)->map(fn ($label, $value) => ['value' => (string) $value, 'label' => (string) $label])->values()->all(),
        ];
    }
}
