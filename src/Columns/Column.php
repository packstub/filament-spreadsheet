<?php

namespace Packstub\Spreadsheet\Columns;

use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Traits\Conditionable;
use Illuminate\Validation\Rules\Unique;
use Packstub\Spreadsheet\Exceptions\InvalidValue;

/**
 * A column of the sheet: which attribute, how it is read and written, which rules
 * apply. A column reads a record into a plain value for the wire (present()) and
 * reads a value the browser sent back into what the model expects (coerce());
 * every write is coerced, validated and authorised on the server whatever the
 * browser showed.
 */
abstract class Column
{
    use Conditionable;

    protected string|Closure|null $label = null;

    protected ?int $width = null;

    protected bool $frozen = false;

    protected bool|Closure $readOnly = false;

    protected bool|Closure $hidden = false;

    protected bool $sortable = true;

    /** @var array<int, mixed>|string|Closure */
    protected array|string|Closure $rules = [];

    protected mixed $default = null;

    protected ?string $placeholder = null;

    /** @var array<string, string>|Closure */
    protected array|Closure $validationMessages = [];

    protected string|Closure|null $validationAttribute = null;

    final public function __construct(protected string $name) {}

    public static function make(string $name): static
    {
        return new static($name);
    }

    /* ------------------------------------------------------------------ configuration */

    public function label(string|Closure|null $label): static
    {
        $this->label = $label;

        return $this;
    }

    /** Column width in pixels (default: what the content needs, at least 80). */
    public function width(?int $width): static
    {
        $this->width = $width === null ? null : max(40, $width);

        return $this;
    }

    /** Pinned at the start while the sheet scrolls sideways. */
    public function frozen(bool $condition = true): static
    {
        $this->frozen = $condition;

        return $this;
    }

    /** Never editable, or not for some records: a bool or `fn (Model $record): bool`. */
    public function readOnly(bool|Closure $condition = true): static
    {
        $this->readOnly = $condition;

        return $this;
    }

    /** Left out of the sheet (and never written) when true. */
    public function hidden(bool|Closure $condition = true): static
    {
        $this->hidden = $condition;

        return $this;
    }

    /** Whether a header click sorts by this attribute (default yes; a computed column cannot). */
    public function sortable(bool $condition = true): static
    {
        $this->sortable = $condition;

        return $this;
    }

    /**
     * Laravel validation rules for the attribute, or `fn (?Model $record): array`.
     * A `unique` rule (a string or `Rule::unique()`) ignores the record being updated.
     *
     * @param  array<int, mixed>|string|Closure  $rules  a list, a `required|max:5` string, or `fn (?Model $record): array`
     */
    public function rules(array|string|Closure $rules): static
    {
        $this->rules = $rules;

        return $this;
    }

    /**
     * Messages per rule for this column, as a Filament field's: `['required' => 'Every product needs a SKU.']`,
     * or `fn (?Model $record): array`.
     *
     * @param  array<string, string>|Closure  $messages
     */
    public function validationMessages(array|Closure $messages): static
    {
        $this->validationMessages = $messages;

        return $this;
    }

    /** The name the default messages call the column (`"The product code field is required."`); the label by default. */
    public function validationAttribute(string|Closure|null $attribute): static
    {
        $this->validationAttribute = $attribute;

        return $this;
    }

    /** The value a new row starts with: a value or a closure returning one. */
    public function default(mixed $default): static
    {
        $this->default = $default;

        return $this;
    }

    public function placeholder(?string $placeholder): static
    {
        $this->placeholder = $placeholder;

        return $this;
    }

    /* ------------------------------------------------------------------ reading */

    abstract public function getType(): string;

    public function getName(): string
    {
        return $this->name;
    }

    public function getLabel(): string
    {
        $label = $this->label instanceof Closure ? app()->call($this->label) : $this->label;

        return (string) ($label ?? str($this->name)->beforeLast('_id')->beforeLast('_at')->headline());
    }

    public function getWidth(): ?int
    {
        return $this->width;
    }

    public function isFrozen(): bool
    {
        return $this->frozen;
    }

    public function isSortable(): bool
    {
        return $this->sortable && $this->isEditable();
    }

    /** Whether the column can ever be written (a computed column cannot, nor a dotted path through a relation). */
    public function isEditable(): bool
    {
        return ! str_contains($this->name, '.');
    }

    /** Read-only for every record. */
    public function isReadOnly(): bool
    {
        return $this->readOnly === true;
    }

    /** Whether the read-only decision depends on the record. */
    public function hasRecordReadOnly(): bool
    {
        return $this->readOnly instanceof Closure;
    }

    public function isReadOnlyFor(Model $record): bool
    {
        if (! $this->isEditable()) {
            return true;
        }

        return (bool) ($this->readOnly instanceof Closure ? ($this->readOnly)($record) : $this->readOnly);
    }

    public function isHidden(): bool
    {
        return (bool) ($this->hidden instanceof Closure ? app()->call($this->hidden) : $this->hidden);
    }

    public function getDefault(): mixed
    {
        return $this->default instanceof Closure ? app()->call($this->default) : $this->default;
    }

    /** The value on the wire for a record (after casts and accessors); a dotted name reads through the relation. */
    public function present(Model $record): mixed
    {
        return $this->presentValue(str_contains($this->name, '.') ? data_get($record, $this->name) : $record->getAttribute($this->name));
    }

    /** A PHP value as the browser should see it. */
    public function presentValue(mixed $value): mixed
    {
        if ($value === null || is_scalar($value)) {
            return $value;
        }

        if ($value instanceof \BackedEnum) {
            return $value->value;
        }

        if ($value instanceof \Stringable) {
            return (string) $value;
        }

        return null;
    }

    /**
     * What the browser sent, as the value to write. Null (or an empty string)
     * clears the attribute. Anything the column cannot read throws InvalidValue
     * with the message for the cell.
     *
     * @throws InvalidValue
     */
    public function coerce(mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_scalar($value)) {
            throw new InvalidValue(__('packstub-spreadsheet::spreadsheet.invalid'));
        }

        return $value;
    }

    /**
     * The rules Laravel validates the attribute with: the column's own (a `unique`
     * ignoring the record), then `nullable`, then the type's. A cleared cell is
     * null (see coerce()) and the type rules must let it through: without
     * `nullable` the validator runs `numeric`, `boolean`, `date_format` or `in` on
     * the null and refuses it. A `required` rule is implicit and still fails on
     * null, so a column that must not be cleared says `required`.
     *
     * @return array<int, mixed>
     */
    public function getRules(?Model $record): array
    {
        $rules = $this->rules instanceof Closure ? ($this->rules)($record) : $this->rules;
        $rules = is_string($rules) ? explode('|', $rules) : array_values((array) $rules);

        foreach ($rules as $i => $rule) {
            if (is_string($rule) && preg_match('/^unique:([^,]+)(?:,([^,]*))?$/', $rule, $m) === 1) {
                // "unique:table" or "unique:table,column" without an ignore: add the record's key.
                $rules[$i] = $record?->exists
                    ? "unique:{$m[1]},".($m[2] ?? '' ?: 'NULL').",{$record->getKey()},{$record->getKeyName()}"
                    : $rule;
            } elseif ($rule instanceof Unique && $record?->exists) {
                $rules[$i] = (clone $rule)->ignore($record);
            }
        }

        return [...$rules, 'nullable', ...$this->typeRules()];
    }

    /**
     * The messages of validationMessages(), keyed by rule.
     *
     * @return array<string, string>
     */
    public function getValidationMessages(?Model $record): array
    {
        $messages = $this->validationMessages instanceof Closure ? ($this->validationMessages)($record) : $this->validationMessages;

        return array_filter((array) $messages, fn ($m, $k) => is_string($m) && is_string($k), ARRAY_FILTER_USE_BOTH);
    }

    /** What the validator calls the column: validationAttribute(), else the label. */
    public function getValidationAttribute(): string
    {
        $attribute = $this->validationAttribute instanceof Closure ? ($this->validationAttribute)() : $this->validationAttribute;

        return $attribute ?? $this->getLabel();
    }

    /**
     * Rules that follow from the type (numeric, a known option…), on top of rules().
     *
     * @return array<int, mixed>
     */
    protected function typeRules(): array
    {
        return [];
    }

    /**
     * What the browser needs to draw and edit the column.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'label' => $this->getLabel(),
            'type' => $this->getType(),
            'width' => $this->width,
            'frozen' => $this->frozen,
            'editable' => $this->isEditable(),
            'readOnly' => $this->isReadOnly(),
            'sortable' => $this->isSortable(),
            'placeholder' => $this->placeholder,
            'default' => $this->isEditable() ? $this->presentValue($this->getDefault()) : null,
        ];
    }

    protected function invalid(string $key, array $replace = []): InvalidValue
    {
        return new InvalidValue(__("packstub-spreadsheet::spreadsheet.{$key}", $replace));
    }
}
