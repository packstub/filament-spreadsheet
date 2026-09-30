<?php

namespace Packstub\Spreadsheet;

/**
 * What one Save answers: the rows as they are now (after casts and mutators) for
 * what was written, and for what was not, the reason on the cell (`errors`), on
 * the row (`rowErrors`) or as a conflict (`conflicts`: the other user's value per
 * changed column, with the record's current `versions` so the next save can win).
 * Never holds a model: it goes back to the browser as JSON.
 */
final class SaveResult
{
    /** @var array<string, array<string, mixed>> record key => row */
    public array $saved = [];

    /** @var array<string, array<string, mixed>> temporary key => row */
    public array $created = [];

    /** @var list<string> */
    public array $deleted = [];

    /** @var array<string, array<string, string>> key => attribute => message */
    public array $errors = [];

    /** @var array<string, string> key => message */
    public array $rowErrors = [];

    /** @var array<string, array<string, mixed>> record key => attribute => their value */
    public array $conflicts = [];

    /** @var array<string, string|null> record key => current version */
    public array $versions = [];

    /** A message for the whole save (a refused batch, a rolled-back one). */
    public ?string $message = null;

    /** Whether nothing was written because of an error (AllOrNothing). */
    public bool $rolledBack = false;

    public function cellError(string $key, string $column, string $message): void
    {
        $this->errors[$key][$column] = $message;
    }

    public function rowError(string $key, string $message): void
    {
        $this->rowErrors[$key] = $message;
    }

    /** Whether a row (an update, a create or a delete) was refused. */
    public function failed(string $key): bool
    {
        return isset($this->errors[$key]) || isset($this->rowErrors[$key]) || isset($this->conflicts[$key]);
    }

    public function hasFailures(): bool
    {
        return $this->errors !== [] || $this->rowErrors !== [] || $this->conflicts !== [];
    }

    public function ok(): bool
    {
        return ! $this->hasFailures() && $this->message === null;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'ok' => $this->ok(),
            'saved' => (object) $this->saved,
            'created' => (object) $this->created,
            'deleted' => $this->deleted,
            'errors' => (object) $this->errors,
            'rowErrors' => (object) $this->rowErrors,
            'conflicts' => (object) $this->conflicts,
            'versions' => (object) $this->versions,
            'message' => $this->message,
            'rolledBack' => $this->rolledBack,
        ];
    }
}
