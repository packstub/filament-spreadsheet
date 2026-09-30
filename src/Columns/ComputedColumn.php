<?php

namespace Packstub\Spreadsheet\Columns;

use Closure;
use Illuminate\Database\Eloquent\Model;

/** A read-only value computed from the record: `state(fn (Product $product) => $product->price - $product->cost)`. */
class ComputedColumn extends Column
{
    protected ?Closure $state = null;

    protected bool $sortable = false;

    public function state(Closure $callback): static
    {
        $this->state = $callback;

        return $this;
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

    public function presentValue(mixed $value): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }

        return parent::presentValue($value);
    }
}
