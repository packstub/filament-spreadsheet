<?php

namespace Packstub\Spreadsheet\Columns;

/** A boolean attribute: a checkbox in the sheet; a paste accepts 1/0, yes/no, true/false, on/off, y/n. */
class BooleanColumn extends Column
{
    public const TRUTHY = ['1', 'true', 'yes', 'y', 'on', 'da', 'ja', 'oui', 'si', 'sí', 'да'];

    public const FALSY = ['0', 'false', 'no', 'n', 'off', 'nu', 'nein', 'non', 'нет'];

    public function getType(): string
    {
        return 'boolean';
    }

    public function presentValue(mixed $value): mixed
    {
        $value = parent::presentValue($value);

        return $value === null ? null : (bool) $value;
    }

    public function coerce(mixed $value): mixed
    {
        $value = parent::coerce($value);

        if ($value === null) {
            return null;
        }

        if (is_bool($value)) {
            return $value;
        }

        if (is_int($value) || is_float($value)) {
            return $value != 0;
        }

        $word = mb_strtolower(trim((string) $value));

        if (in_array($word, self::TRUTHY, true)) {
            return true;
        }

        if (in_array($word, self::FALSY, true)) {
            return false;
        }

        throw $this->invalid('not_a_boolean');
    }

    protected function typeRules(): array
    {
        return ['boolean'];
    }
}
