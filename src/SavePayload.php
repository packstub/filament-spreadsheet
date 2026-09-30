<?php

namespace Packstub\Spreadsheet;

/**
 * What one Save sends: the changed cells by record key, the version each changed
 * record had when the user saw it, the new rows by a browser-side temporary key,
 * and the keys to delete. Built from the raw request with every shape checked:
 * a key is a non-empty scalar, a column name a string, and nothing else is kept.
 */
final class SavePayload
{
    /**
     * @param  array<string, array<string, mixed>>  $changed  record key => attribute => value
     * @param  array<string, string|null>  $versions  record key => the version the browser saw
     * @param  array<string, array<string, mixed>>  $created  temporary key => attribute => value
     * @param  list<string>  $deleted  record keys
     */
    public function __construct(
        public readonly array $changed = [],
        public readonly array $versions = [],
        public readonly array $created = [],
        public readonly array $deleted = [],
    ) {}

    /** @param  array<string, mixed>  $raw */
    public static function fromArray(array $raw): self
    {
        $changed = [];
        $versions = [];
        $created = [];
        $deleted = [];

        foreach (self::rows($raw['changed'] ?? null) as $id => $values) {
            $changed[$id] = $values;
        }

        if (is_array($raw['versions'] ?? null)) {
            foreach ($raw['versions'] as $id => $version) {
                if (($id = self::key($id)) !== null && ($version === null || is_scalar($version))) {
                    $versions[$id] = $version === null ? null : (string) $version;
                }
            }
        }

        foreach (self::rows($raw['created'] ?? null) as $temp => $values) {
            if (preg_match('/^[\w-]{1,64}$/', $temp) === 1) {
                $created[$temp] = $values;
            }
        }

        if (is_array($raw['deleted'] ?? null)) {
            foreach ($raw['deleted'] as $id) {
                if (($id = self::key($id)) !== null) {
                    $deleted[$id] = true;
                }
            }
        }

        return new self($changed, $versions, $created, array_map(strval(...), array_keys($deleted)));
    }

    public function isEmpty(): bool
    {
        return $this->changed === [] && $this->created === [] && $this->deleted === [];
    }

    /** Rows this save touches: updates, creates and deletes. */
    public function rowCount(): int
    {
        return count($this->changed) + count($this->created) + count($this->deleted);
    }

    public function version(string $id): ?string
    {
        return $this->versions[$id] ?? null;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return ['changed' => $this->changed, 'versions' => $this->versions, 'created' => $this->created, 'deleted' => $this->deleted];
    }

    /** @return array<string, array<string, mixed>> */
    private static function rows(mixed $raw): array
    {
        $rows = [];

        if (! is_array($raw)) {
            return $rows;
        }

        foreach ($raw as $id => $values) {
            if (($id = self::key($id)) === null || ! is_array($values)) {
                continue;
            }

            $row = [];

            foreach ($values as $column => $value) {
                if (is_string($column) && $column !== '') {
                    $row[$column] = $value;
                }
            }

            $rows[$id] = $row;
        }

        return $rows;
    }

    private static function key(mixed $id): ?string
    {
        if (is_int($id)) {
            return (string) $id;
        }

        if (! is_string($id) || $id === '' || strlen($id) > 191 || preg_match('/[\x00-\x1F\x7F]/', $id) === 1) {
            return null;
        }

        return $id;
    }
}
