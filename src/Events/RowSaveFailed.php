<?php

namespace Packstub\Spreadsheet\Events;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A row of a Save was refused: a validation error, a denied policy, a conflict
 * or a failed write. `record` is null for a new row; `errors` maps attributes to
 * messages, `reason` is the row-level message when there is one (a conflict, a
 * denied policy).
 */
class RowSaveFailed
{
    use Dispatchable;

    /**
     * @param  array<string, mixed>  $data  what the user sent for the row
     * @param  array<string, string>  $errors
     */
    public function __construct(
        public readonly ?Model $record,
        public readonly array $data,
        public readonly array $errors = [],
        public readonly ?string $reason = null,
        public readonly ?string $spreadsheet = null,
    ) {}
}
