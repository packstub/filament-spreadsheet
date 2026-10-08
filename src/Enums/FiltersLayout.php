<?php

namespace Packstub\Spreadsheet\Enums;

/** Where a sheet's filters are shown; the config's `filters_layout` is the default, `Spreadsheet::filtersLayout()` wins. */
enum FiltersLayout: string
{
    /** Behind a funnel button in the toolbar, with the count of active filters (the default, as a table's). */
    case Dropdown = 'dropdown';

    /** Inline in the toolbar, after the search box. */
    case Toolbar = 'toolbar';

    /** On a row of their own between the toolbar and the grid. */
    case AboveContent = 'above';

    /** The config's `filters_layout`: unset is Dropdown, a value that is no layout is refused (a typo would pass silently). */
    public static function fromConfig(mixed $value): self
    {
        if ($value instanceof self) {
            return $value;
        }

        if ($value === null || $value === '') {
            return self::Dropdown;
        }

        return self::tryFrom((string) $value) ?? throw new \InvalidArgumentException("packstub-spreadsheet.filters_layout [{$value}] is not a filters layout: dropdown, toolbar or above.");
    }
}
