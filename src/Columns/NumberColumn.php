<?php

namespace Packstub\Spreadsheet\Columns;

use Packstub\Spreadsheet\Formula;

/**
 * A numeric attribute. What the browser sends (a number, or a pasted string such
 * as "1 234,50" or "1,234.50") is read locale-safely: with both separators present
 * the last one is the decimal mark; a lone separator is read by the panel's decimal
 * mark (see decimalSeparator()): the locale's own mark is always decimal, the other
 * one is decimal when one or two digits follow it (`0.5`), a thousands separator
 * otherwise (`1.234`). The browser reads it the same way: the mark travels in toArray().
 */
class NumberColumn extends Column
{
    /** The largest whole number a browser holds exactly (Number.MAX_SAFE_INTEGER). */
    public const MAX_SAFE_INTEGER = 9007199254740991;

    protected ?int $decimals = null;

    protected bool $integer = false;

    protected int|float|null $min = null;

    protected int|float|null $max = null;

    /** Whole numbers only. */
    public function integer(bool $condition = true): static
    {
        $this->integer = $condition;

        return $this;
    }

    /** Decimal places shown (and rounded to when saved). */
    public function decimals(?int $decimals): static
    {
        $this->decimals = $decimals === null ? null : max(0, $decimals);

        return $this;
    }

    public function min(int|float|null $min): static
    {
        $this->min = $min;

        return $this;
    }

    public function max(int|float|null $max): static
    {
        $this->max = $max;

        return $this;
    }

    public function getType(): string
    {
        return 'number';
    }

    public function isInteger(): bool
    {
        return $this->integer;
    }

    public function presentValue(mixed $value): mixed
    {
        $value = parent::presentValue($value);

        if ($value === null || $value === '') {
            return null;
        }

        if (is_bool($value)) {
            return (int) $value;
        }

        // A decimal cast gives "12.50": a number on the wire, never a string.
        return $this->integer ? (int) $value : (float) $value;
    }

    public function coerce(mixed $value): mixed
    {
        $value = parent::coerce($value);

        if ($value === null) {
            return null;
        }

        $number = is_bool($value) ? (int) $value : (is_string($value) ? static::parse($value, static::decimalSeparator()) : $value);

        if ($number === null || ! is_numeric($number) || ! is_finite((float) $number)) {
            throw $this->invalid('not_a_number');
        }

        if ($this->integer) {
            if ((float) $number !== floor((float) $number)) {
                throw $this->invalid('not_an_integer');
            }

            // Past 2^53 the browser cannot hold the number exactly, and past PHP_INT_MAX the cast wraps
            // (or warns on PHP 8.5): the same limit as the browser's Number.isSafeInteger().
            if (abs((float) $number) > self::MAX_SAFE_INTEGER) {
                throw $this->invalid('integer_too_large');
            }

            return (int) $number;
        }

        // Half away from zero, the browser's rule too (PHP's round() changed its own in 8.4).
        return $this->decimals === null ? $number + 0 : Formula::round((float) $number, $this->decimals);
    }

    /**
     * The decimal mark a lone separator is read by: the config's `decimal_separator`
     * when it is `,` or `.`, else the app locale's (via intl), else `.`.
     */
    public static function decimalSeparator(): string
    {
        $configured = config('packstub-spreadsheet.decimal_separator');

        if ($configured === ',' || $configured === '.') {
            return $configured;
        }

        $locale = app()->getLocale();

        if (! isset(static::$separators[$locale])) {
            $symbol = class_exists(\NumberFormatter::class)
                ? (new \NumberFormatter($locale, \NumberFormatter::DECIMAL))->getSymbol(\NumberFormatter::DECIMAL_SEPARATOR_SYMBOL)
                : '.';
            static::$separators[$locale] = $symbol === ',' ? ',' : '.';
        }

        return static::$separators[$locale];
    }

    /** @var array<string, string> the locale's decimal mark, resolved once per locale */
    protected static array $separators = [];

    /**
     * A pasted number ("1 234,50", "1,234.50", "-3", "1e3"), or null when it is not
     * one. `$decimal` is the mark a lone separator is read by (`.` by default).
     */
    public static function parse(string $value, string $decimal = '.'): int|float|null
    {
        $value = str_replace(["\u{00A0}", "\u{202F}", ' ', "'"], '', trim($value));

        if ($value === '') {
            return null;
        }

        $comma = strrpos($value, ',');
        $dot = strrpos($value, '.');

        if ($comma !== false && $dot !== false) {
            // Both present: the last one is the decimal mark, the other groups thousands.
            $value = $comma > $dot
                ? str_replace(',', '.', str_replace('.', '', $value))
                : str_replace(',', '', $value);
        } elseif ($comma !== false || $dot !== false) {
            $mark = $comma !== false ? ',' : '.';
            $after = strlen($value) - max($comma, $dot) - 1;
            $single = substr_count($value, $mark) === 1;

            if ($mark === $decimal) {
                // The locale's own mark: decimal when it is alone (several leave the text as it is: not a number).
                $value = $single ? str_replace($mark, '.', $value) : $value;
            } else {
                // The other mark: decimal with one or two digits after it, a thousands separator otherwise.
                $value = ($single && $after > 0 && $after !== 3)
                    ? str_replace($mark, '.', $value)
                    : str_replace($mark, '', $value);
            }
        }

        if (! is_numeric($value)) {
            return null;
        }

        return str_contains($value, '.') || stripos($value, 'e') !== false ? (float) $value : (int) $value;
    }

    protected function typeRules(): array
    {
        $rules = [$this->integer ? 'integer' : 'numeric'];

        if ($this->min !== null) {
            $rules[] = "min:{$this->min}";
        }

        if ($this->max !== null) {
            $rules[] = "max:{$this->max}";
        }

        return $rules;
    }

    public function toArray(): array
    {
        return [
            ...parent::toArray(),
            'integer' => $this->integer,
            'decimal' => static::decimalSeparator(),
            'decimals' => $this->integer ? 0 : $this->decimals,
            'min' => $this->min,
            'max' => $this->max,
        ];
    }
}
