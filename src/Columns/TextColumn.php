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

    protected function typeRules(): array
    {
        return $this->maxLength === null ? ['string'] : ['string', "max:{$this->maxLength}"];
    }

    public function toArray(): array
    {
        return [...parent::toArray(), 'maxLength' => $this->maxLength];
    }
}
