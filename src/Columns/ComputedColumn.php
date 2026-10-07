<?php

namespace Packstub\Spreadsheet\Columns;

use Closure;
use Illuminate\Database\Eloquent\Model;
use Packstub\Spreadsheet\Formula;

/**
 * A read-only value: a formula over the row's columns (`formula('price * stock')`,
 * recomputed in the browser as the row is edited), computed from the record
 * (`state(fn (Product $product) => $product->price - $product->cost)`), or an
 * attribute or dotted path read as it is.
 */
class ComputedColumn extends Column
{
    protected ?Closure $state = null;

    protected ?Formula $formula = null;

    protected ?int $decimals = null;

    protected bool $sortable = false;

    public function state(Closure $callback): static
    {
        $this->state = $callback;

        return $this;
    }

    /**
     * A formula over the sheet's columns, the same on the server and in the browser:
     * `price * stock`, `round((price - cost) / price * 100, 1)`, `if(stock < 5, 'low', 'ok')`.
     * See Formula for the operators and functions.
     *
     * @throws \InvalidArgumentException on a formula that cannot be read
     */
    public function formula(?string $formula): static
    {
        $this->formula = $formula === null ? null : Formula::parse($formula);

        return $this;
    }

    /** Decimal places a number is rounded to and shown with (right-aligned). */
    public function decimals(?int $decimals): static
    {
        $this->decimals = $decimals === null ? null : max(0, $decimals);

        return $this;
    }

    public function getFormula(): ?Formula
    {
        return $this->formula;
    }

    public function getType(): string
    {
        return 'computed';
    }

    public function isEditable(): bool
    {
        return false;
    }

    public function isReadOnly(): bool
    {
        return true;
    }

    public function isSortable(): bool
    {
        return false;
    }

    public function present(Model $record): mixed
    {
        return $this->state ? $this->presentValue(($this->state)($record)) : parent::present($record);
    }

    /**
     * The formula's value for a row.
     *
     * @param  Closure(string): mixed  $value  a column's value in the row
     */
    public function compute(Closure $value): mixed
    {
        return $this->presentValue($this->formula?->evaluate($value));
    }

    public function presentValue(mixed $value): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }

        $value = parent::presentValue($value);

        if ($this->decimals !== null && (is_int($value) || is_float($value))) {
            return Formula::round((float) $value, $this->decimals);
        }

        return $value;
    }

    public function toArray(): array
    {
        return [
            ...parent::toArray(),
            'formula' => $this->formula?->toArray(),
            'decimals' => $this->decimals,
        ];
    }
}
