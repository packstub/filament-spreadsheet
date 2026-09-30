<?php

namespace Packstub\Spreadsheet\Columns;

use Carbon\CarbonInterface;

/**
 * A whole-day attribute (a `date` cast or a `Y-m-d` string). On the wire the value
 * is always `Y-m-d`; the browser shows it in format() and reads pasted dates in
 * that format or ISO.
 */
class DateColumn extends Column
{
    protected ?string $format = null;

    /** PHP date format for display (default: the config's `date_format`). */
    public function format(?string $format): static
    {
        $this->format = $format;

        return $this;
    }

    public function getType(): string
    {
        return 'date';
    }

    public function getFormat(): string
    {
        return $this->format ?? (string) config('packstub-spreadsheet.date_format', 'Y-m-d');
    }

    public function presentValue(mixed $value): mixed
    {
        if ($value instanceof CarbonInterface) {
            return $value->format('Y-m-d');
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        $value = parent::presentValue($value);

        if ($value === null || $value === '') {
            return null;
        }

        return preg_match('/^(\d{4}-\d{2}-\d{2})/', (string) $value, $m) === 1 ? $m[1] : (string) $value;
    }

    public function coerce(mixed $value): mixed
    {
        $value = parent::coerce($value);

        if ($value === null) {
            return null;
        }

        return static::parseDate((string) $value) ?? throw $this->invalid('not_a_date');
    }

    /**
     * "Y-m-d" (a time after it is dropped), a real calendar date in the years
     * 1000–9999. Nothing Carbon would guess at.
     */
    public static function parseDate(string $value): ?string
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/', trim($value), $m) !== 1) {
            return null;
        }

        if ((int) $m[1] < 1000 || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }

        return "{$m[1]}-{$m[2]}-{$m[3]}";
    }

    /**
     * "Y-m-d H:i[:s]" (a T between is fine) as "Y-m-d H:i:s", a date alone as midnight.
     */
    public static function parseDateTime(string $value): ?string
    {
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/', trim($value), $m) !== 1) {
            return null;
        }

        if ((int) $m[1] < 1000 || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])
            || (int) ($m[4] ?? 0) > 23 || (int) ($m[5] ?? 0) > 59 || (int) ($m[6] ?? 0) > 59) {
            return null;
        }

        return sprintf('%s-%s-%s %02d:%02d:%02d', $m[1], $m[2], $m[3], (int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0));
    }

    protected function typeRules(): array
    {
        return ['date_format:Y-m-d'];
    }

    public function toArray(): array
    {
        return [...parent::toArray(), 'format' => $this->getFormat()];
    }
}
