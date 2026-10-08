<?php

namespace Packstub\Spreadsheet\Enums;

/**
 * What one Save does with a batch that has a bad row in it.
 */
enum SaveMode: string
{
    /** One transaction for the whole batch: a single refused row rolls everything back and every error comes back at once. */
    case AllOrNothing = 'all_or_nothing';

    /** Each row in its own savepoint: the valid rows are committed, the refused ones come back with their errors. */
    case PerRow = 'per_row';

    /** The config's `save_mode`: unset is AllOrNothing, a value that is no mode is refused (a typo would pass silently). */
    public static function fromName(?string $name): self
    {
        if ($name === null || $name === '') {
            return self::AllOrNothing;
        }

        return self::tryFrom($name) ?? throw new \InvalidArgumentException(
            "Unknown spreadsheet save mode [{$name}]: use 'all_or_nothing' or 'per_row'.",
        );
    }
}
