<?php

namespace Packstub\Spreadsheet\Columns;

use Carbon\CarbonInterface;

/**
 * A moment (a `datetime` cast). On the wire the value is `Y-m-d H:i:s` in the
 * app's timezone, the way Eloquent reads and writes it; the browser shows it in
 * format() and edits it with a local date-time input.
 */
class DateTimeColumn extends DateColumn
{
    public function getType(): string
    {
        return 'datetime';
    }

    public function getFormat(): string
    {
        return $this->format ?? (string) config('packstub-spreadsheet.datetime_format', 'Y-m-d H:i');
    }

    public function presentValue(mixed $value): mixed
    {
        if ($value instanceof CarbonInterface || $value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }

        $value = Column::presentValue($value);

        if ($value === null || $value === '') {
            return null;
        }

        return static::parseDateTime((string) $value) ?? (string) $value;
    }

    public function coerce(mixed $value): mixed
    {
        $value = Column::coerce($value);

        if ($value === null) {
            return null;
        }

        return static::parseDateTime((string) $value) ?? throw $this->invalid('not_a_datetime');
    }

    protected function typeRules(): array
    {
        return ['date_format:Y-m-d H:i:s'];
    }
}
