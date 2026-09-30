<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Pages
    |--------------------------------------------------------------------------
    |
    | Rows per page a sheet opens with (a definition's perPage() wins), the
    | most a user may ask for from the page-size control, and the most rows
    | one Save may carry (updates, creates and deletes together).
    |
    */

    'per_page' => 100,

    'max_per_page' => 1000,

    'max_rows_per_save' => 2000,

    /*
    |--------------------------------------------------------------------------
    | Saving
    |--------------------------------------------------------------------------
    |
    | `all_or_nothing`: one transaction, a single refused row rolls the whole
    | batch back and every error comes back at once. `per_row`: the valid rows
    | commit, the refused ones come back with their errors. The version column
    | compared before a row is written (null: no conflict detection).
    |
    */

    'save_mode' => 'all_or_nothing',

    'version_column' => 'updated_at',

    /*
    |--------------------------------------------------------------------------
    | Grid
    |--------------------------------------------------------------------------
    |
    | Whether leaving the page with unsaved changes asks first, whether the
    | first column is pinned while scrolling sideways, the height of a row in
    | pixels, and the keyboard shortcuts (a browser shortcut string per action;
    | see the docs for the names).
    |
    */

    'confirm_leave' => true,

    'frozen_first_column' => true,

    'row_height' => 32,

    'keybindings' => [
        // 'save' => 'mod+s', 'fill_down' => 'mod+d', 'undo' => 'mod+z', 'redo' => 'mod+y', 'add_row' => 'mod+enter',
    ],

    /*
    |--------------------------------------------------------------------------
    | Formats
    |--------------------------------------------------------------------------
    |
    | PHP date formats for what a date and a date-time cell show (a column's
    | format() wins). On the wire the values are always ISO.
    |
    */

    'date_format' => 'Y-m-d',

    'datetime_format' => 'Y-m-d H:i',

];
