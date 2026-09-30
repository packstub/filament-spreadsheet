<?php

namespace Packstub\Spreadsheet\Events;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * One Save wrote something: the updated records, the created ones and the keys
 * deleted, after the transaction committed.
 */
class RowsSaved
{
    use Dispatchable;

    /**
     * @param  Collection<int, Model>  $updated
     * @param  Collection<int, Model>  $created
     * @param  list<string>  $deleted
     */
    public function __construct(
        public readonly Collection $updated,
        public readonly Collection $created,
        public readonly array $deleted = [],
        public readonly ?string $spreadsheet = null,
    ) {}

    /**
     * Every record written, updated and created.
     *
     * @return Collection<int, Model>
     */
    public function records(): Collection
    {
        return $this->updated->merge($this->created);
    }
}
