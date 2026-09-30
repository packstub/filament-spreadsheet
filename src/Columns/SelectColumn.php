<?php

namespace Packstub\Spreadsheet\Columns;

use BackedEnum;
use Closure;
use Filament\Support\Contracts\HasLabel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Validation\Rule;

/**
 * One of a list: an array of options, a closure returning one, a backed enum
 * class, or the records of a BelongsTo relation. The key is stored, the label
 * shown; a paste matches by label or key.
 */
class SelectColumn extends Column
{
    /** @var array<string|int, string>|Closure|class-string<BackedEnum>|null */
    protected array|Closure|string|null $options = null;

    protected ?string $relationship = null;

    protected ?string $titleAttribute = null;

    protected ?Closure $modifyRelationshipQuery = null;

    /** @var array<string, string>|null evaluated once per instance */
    protected ?array $optionsCache = null;

    /**
     * @param  array<string|int, string>|Closure|class-string<BackedEnum>  $options  value => label, `fn (): array`, or an enum class (cases' values, labels from HasLabel)
     */
    public function options(array|Closure|string $options): static
    {
        $this->options = $options;
        $this->optionsCache = null;

        return $this;
    }

    /**
     * Options from a BelongsTo relation of the model: the attribute is the foreign
     * key (`category_id`), the related records' keys are the options, their
     * `$titleAttribute` the labels. The closure narrows the related query
     * (`fn (Builder $query) => $query->where('active', true)`).
     */
    public function relationship(string $name, string $titleAttribute = 'name', ?Closure $modifyQueryUsing = null): static
    {
        $this->relationship = $name;
        $this->titleAttribute = $titleAttribute;
        $this->modifyRelationshipQuery = $modifyQueryUsing;
        $this->optionsCache = null;

        return $this;
    }

    public function getType(): string
    {
        return 'select';
    }

    public function getRelationshipName(): ?string
    {
        return $this->relationship;
    }

    /**
     * The options as strings: value => label.
     *
     * @param  Model|null  $model  the sheet's model, needed to read a relationship's options
     * @return array<string, string>
     */
    public function getOptions(?Model $model = null): array
    {
        if ($this->optionsCache !== null) {
            return $this->optionsCache;
        }

        $options = [];

        if ($this->relationship !== null && $model === null) {
            // Not prepared yet (see prepare()): nothing to cache.
            return [];
        }

        if ($this->relationship !== null) {
            $relation = $model->{$this->relationship}();

            if (! $relation instanceof BelongsTo) {
                throw new \LogicException("SelectColumn [{$this->name}]: relationship [{$this->relationship}] must be a BelongsTo.");
            }

            $query = $relation->getRelated()->newQuery();

            if ($this->modifyRelationshipQuery) {
                $query = ($this->modifyRelationshipQuery)($query) ?? $query;
            }

            $options = $query->orderBy($this->titleAttribute)->pluck($this->titleAttribute, $relation->getOwnerKeyName())->all();
        } elseif (is_string($this->options) && enum_exists($this->options)) {
            foreach ($this->options::cases() as $case) {
                $options[$case->value] = $case instanceof HasLabel ? (string) $case->getLabel() : (string) $case->name;
            }
        } elseif ($this->options instanceof Closure) {
            $options = app()->call($this->options);
        } elseif (is_array($this->options)) {
            $options = $this->options;
        }

        $strings = [];

        foreach ($options as $value => $label) {
            $strings[(string) $value] = (string) $label;
        }

        return $this->optionsCache = $strings;
    }

    /** Fill the options cache with the sheet's model before rows are read or saved. */
    public function prepare(Model $model): void
    {
        $this->getOptions($model);
    }

    public function presentValue(mixed $value): mixed
    {
        $value = parent::presentValue($value);

        return $value === null ? null : (string) $value;
    }

    public function coerce(mixed $value): mixed
    {
        $value = parent::coerce($value);

        if ($value === null) {
            return null;
        }

        $key = is_bool($value) ? ($value ? '1' : '0') : (string) $value;

        if (! array_key_exists($key, $this->getOptions())) {
            throw $this->invalid('not_an_option');
        }

        return $key;
    }

    protected function typeRules(): array
    {
        return [Rule::in(array_keys($this->getOptions()))];
    }

    public function toArray(): array
    {
        return [
            ...parent::toArray(),
            'options' => collect($this->getOptions())->map(fn ($label, $value) => ['value' => (string) $value, 'label' => $label])->values()->all(),
        ];
    }
}
