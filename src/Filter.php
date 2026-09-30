<?php

namespace Packstub\Spreadsheet;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\Eloquent\Builder;

/**
 * A filter in the sheet's toolbar: a small select (`Filter::select()`, the default),
 * a yes/no select (`Filter::boolean()`) or a pair of date inputs (`Filter::dateRange()`).
 * Applied on the server; values the filter did not offer are ignored. The same class
 * as in Kanban and Gantt.
 */
class Filter
{
    public const SELECT = 'select';

    public const BOOLEAN = 'boolean';

    public const DATE_RANGE = 'dateRange';

    protected string|Closure|null $label = null;

    /** @var array<string|int, string>|Closure */
    protected array|Closure $options = [];

    protected ?Closure $query = null;

    final public function __construct(protected string $name, protected string $type = self::SELECT) {}

    public static function make(string $name): static
    {
        return new static($name);
    }

    public static function select(string $name): static
    {
        return new static($name, self::SELECT);
    }

    /** A yes/no select; by default it narrows `<name>` to true or false. */
    public static function boolean(string $name): static
    {
        return new static($name, self::BOOLEAN);
    }

    /** From / until date inputs; by default they narrow `<name>` to the days between (either side may be left open). */
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

        return $this;
    }

    /**
     * How a chosen value narrows the query. Default: `where(<name>, <value>)` for a
     * select, `where(<name>, true|false)` for a boolean, `where(<name>, >=, from)`
     * and `where(<name>, <, the day after until)` for a date range (the closure
     * receives `['from' => ?string, 'until' => ?string]`).
     */
    public function query(Closure $callback): static
    {
        $this->query = $callback;

        return $this;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getType(): string
    {
        return $this->type;
    }

    public function isDateRange(): bool
    {
        return $this->type === self::DATE_RANGE;
    }

    public function isBoolean(): bool
    {
        return $this->type === self::BOOLEAN;
    }

    public function getLabel(): string
    {
        $label = $this->label instanceof Closure ? app()->call($this->label) : $this->label;

        return (string) ($label ?? str($this->name)->beforeLast('_id')->beforeLast('_at')->headline());
    }

    /** @return array<string|int, string> */
    public function getOptions(): array
    {
        if ($this->isBoolean()) {
            return ['1' => __('packstub-spreadsheet::spreadsheet.yes'), '0' => __('packstub-spreadsheet::spreadsheet.no')];
        }

        return $this->options instanceof Closure ? app()->call($this->options) : $this->options;
    }

    public function apply(Builder $query, mixed $value): void
    {
        if ($this->isDateRange()) {
            $this->applyDateRange($query, $value);

            return;
        }

        if (blank($value) || (! is_string($value) && ! is_int($value)) || ! array_key_exists($value, $this->getOptions())) {
            return;
        }

        if ($this->isBoolean()) {
            $value = (string) $value === '1';
        }

        if ($this->query) {
            ($this->query)($query, $value);

            return;
        }

        $query->where($query->qualifyColumn($this->name), $value);
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

    /** A `Y-m-d` string, or null for anything else: the browser cannot inject a raw value. */
    public static function date(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) && strtotime($value) !== false ? $value : null;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'label' => $this->getLabel(),
            'type' => $this->isDateRange() ? self::DATE_RANGE : self::SELECT,
            'options' => $this->isDateRange()
                ? []
                : collect($this->getOptions())->map(fn ($label, $value) => ['value' => (string) $value, 'label' => (string) $label])->values()->all(),
        ];
    }
}
