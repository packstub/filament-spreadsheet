<?php

namespace Packstub\Spreadsheet\Columns;

/** A string attribute. */
class TextColumn extends Column
{
    protected ?int $maxLength = null;

    public function maxLength(?int $length): static
    {
        $this->maxLength = $length;

        return $this;
    }

    public function getType(): string
    {
        return 'text';
    }

    public function coerce(mixed $value): mixed
    {
        $value = parent::coerce($value);

        if ($value === null) {
            return null;
        }

        return is_bool($value) ? ($value ? '1' : '0') : (string) $value;
    }

    /** `string` and a `max:` rule: `maxLength()`, or 65535 (a TEXT column's bound) so a value is never unbounded before the database. */
    protected function typeRules(): array
    {
        return ['string', 'max:'.($this->maxLength ?? 65535)];
    }

    public function toArray(): array
    {
        return [...parent::toArray(), 'maxLength' => $this->maxLength];
    }
}
