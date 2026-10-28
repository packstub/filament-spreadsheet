<?php

use Illuminate\Database\Eloquent\Builder;
use Livewire\Livewire;
use Packstub\Spreadsheet\Filter;
use Packstub\Spreadsheet\Tests\Fixtures\Category;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;

/** The SKUs the fixture's sheet answers with a given set of filters, the given ones replacing the fixture's. */
function skusWith(array $filters, array $values): array
{
    $rows = sheet()->filters($filters)->rows(['filters' => $values])['rows'];

    return array_column(array_column($rows, 'values'), 'sku');
}

it('narrows with a select, one of its options only, and lets query() do it another way', function (): void {
    $tools = category('Tools');
    $paint = category('Paint');
    product('a-1', 'Hammer', ['category_id' => $tools->id]);
    product('b-2', 'Brush', ['category_id' => $paint->id]);

    $select = fn () => Filter::select('category_id')->options(fn () => Category::query()->pluck('name', 'id')->all());

    expect(skusWith([$select()], ['category_id' => (string) $tools->id]))->toBe(['A-1'])
        ->and(skusWith([$select()], ['category_id' => $paint->id]))->toBe(['B-2'])
        ->and(skusWith([$select()], ['category_id' => '999']))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$select()], ['category_id' => [(string) $tools->id]]))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$select()], ['category_id' => '']))->toBe(['A-1', 'B-2'])
        ->and(skusWith([Filter::make('category_id')->options([$tools->id => 'Tools'])->query(fn (Builder $query, string $value) => $query->where('sku', 'B-2'))], ['category_id' => (string) $tools->id]))->toBe(['B-2'])
        ->and($select()->getType())->toBe('select')
        ->and($select()->isSelect())->toBeTrue()
        ->and(Filter::select('category_id')->getLabel())->toBe('Category')
        ->and(Filter::select('available_on')->label(fn () => 'When')->getLabel())->toBe('When');
});

it('narrows with several options at once for multiple(), the unknown ones dropped, query() getting the list', function (): void {
    $tools = category('Tools');
    $paint = category('Paint');
    $garden = category('Garden');
    product('a-1', 'Hammer', ['category_id' => $tools->id]);
    product('b-2', 'Brush', ['category_id' => $paint->id]);
    product('c-3', 'Rake', ['category_id' => $garden->id]);

    $multiple = fn () => Filter::select('category_id')->multiple()->options(fn () => Category::query()->pluck('name', 'id')->all());
    $seen = null;

    expect(skusWith([$multiple()], ['category_id' => [(string) $tools->id, $garden->id, '999']]))->toBe(['A-1', 'C-3'])
        ->and(skusWith([$multiple()], ['category_id' => (string) $paint->id]))->toBe(['B-2'])
        ->and(skusWith([$multiple()], ['category_id' => ['999']]))->toBe(['A-1', 'B-2', 'C-3'])
        ->and(skusWith([$multiple()], ['category_id' => []]))->toBe(['A-1', 'B-2', 'C-3'])
        ->and(skusWith([$multiple()->query(function (Builder $query, array $values) use (&$seen) {
            $seen = $values;
            $query->whereIn('category_id', $values);
        })], ['category_id' => [$paint->id, $paint->id]]))->toBe(['B-2'])
        ->and($seen)->toBe([(string) $paint->id])
        ->and($multiple()->isMultiple())->toBeTrue()
        ->and($multiple()->toArray())->toMatchArray(['multiple' => true, 'searchable' => false]);
});

it('takes any key for a searchable select, answers a search and a label, and sends no options without preload', function (): void {
    $acme = category('Acme');
    $beta = category('Beta');
    product('a-1', 'Hammer', ['category_id' => $acme->id]);
    product('b-2', 'Brush', ['category_id' => $beta->id]);

    $plain = Filter::select('category_id')->searchable()->options(fn () => Category::query()->pluck('name', 'id')->all());
    $closure = Filter::select('category_id')->searchable()->preload(false)->optionsLimit(1)
        ->getSearchResultsUsing(fn (string $search) => Category::query()->where('name', 'like', "%{$search}%")->pluck('name', 'id')->all())
        ->getOptionLabelUsing(fn (string $value) => Category::query()->find($value)?->name);

    expect($plain->getSearchResults('bet'))->toBe([$beta->id => 'Beta'])
        ->and($plain->getSearchResults(''))->toBe([$acme->id => 'Acme', $beta->id => 'Beta'])
        ->and($plain->toArray())->toMatchArray(['searchable' => true, 'optionsLimit' => 50, 'options' => [['value' => (string) $acme->id, 'label' => 'Acme'], ['value' => (string) $beta->id, 'label' => 'Beta']]])
        ->and($closure->toArray()['options'])->toBe([])
        ->and($closure->getSearchResults('e'))->toBe([$acme->id => 'Acme'])
        ->and($closure->getOptionLabel((string) $beta->id))->toBe('Beta')
        ->and($closure->getOptionLabel('999'))->toBeNull()
        ->and(Filter::select('category_id')->searchable(fn () => false)->isSearchable())->toBeFalse()
        // a searchable filter takes a value its preloaded list does not hold (the query decides); a plain one ignores it
        ->and(skusWith([$closure], ['category_id' => (string) $beta->id]))->toBe(['B-2'])
        ->and(skusWith([Filter::select('category_id')->options([$acme->id => 'Acme'])], ['category_id' => (string) $beta->id]))->toBe(['A-1', 'B-2']);
});

it('gives a boolean filter\'s query a bool and offers Yes / No in the sheet\'s language', function (): void {
    product('a-1', 'Hammer', ['is_active' => true]);
    product('b-2', 'Nail', ['is_active' => false]);
    $seen = [];

    expect(skusWith([Filter::boolean('is_active')], ['is_active' => '0']))->toBe(['B-2'])
        ->and(skusWith([Filter::boolean('is_active')], ['is_active' => '1']))->toBe(['A-1'])
        ->and(skusWith([Filter::boolean('is_active')], ['is_active' => 'maybe']))->toBe(['A-1', 'B-2'])
        ->and(skusWith([Filter::boolean('is_active')->query(function (Builder $query, bool $value) use (&$seen) {
            $seen[] = $value;
            $query->where('is_active', ! $value);
        })], ['is_active' => '1']))->toBe(['B-2'])
        ->and($seen)->toBe([true])
        ->and(Filter::boolean('is_active')->getOptions())->toBe(['1' => 'Yes', '0' => 'No'])
        ->and(Filter::boolean('is_active')->toArray())->toMatchArray(['type' => 'boolean', 'multiple' => false, 'options' => [['value' => '1', 'label' => 'Yes'], ['value' => '0', 'label' => 'No']]]);

    app()->setLocale('de');
    expect(Filter::boolean('is_active')->getOptions())->toBe(['1' => 'Ja', '0' => 'Nein']);
});

it('requires a query() on a toggle, which gets true when it is on and nothing when it is off', function (): void {
    product('a-1', 'Hammer', ['stock' => 0]);
    product('b-2', 'Nail', ['stock' => 5]);
    $seen = [];

    // a closure, not an arrow function: the arrow function would capture $seen by value, and the query's reference would be to its copy
    $toggle = function () use (&$seen) {
        return Filter::toggle('in_stock')->query(function (Builder $query, bool $on) use (&$seen) {
            $seen[] = $on;
            $query->where('stock', '>', 0);
        });
    };

    expect(skusWith([$toggle()], ['in_stock' => true]))->toBe(['B-2'])
        ->and(skusWith([$toggle()], ['in_stock' => '1']))->toBe(['B-2'])
        ->and(skusWith([$toggle()], ['in_stock' => false]))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$toggle()], ['in_stock' => 'nope']))->toBe(['A-1', 'B-2'])
        ->and($seen)->toBe([true, true])
        ->and($toggle()->isToggle())->toBeTrue()
        ->and($toggle()->getOptions())->toBe([])
        ->and($toggle()->toArray())->toMatchArray(['type' => 'toggle', 'options' => []])
        ->and(fn () => Filter::toggle('mine')->assertUsable())->toThrow(LogicException::class, 'toggle')
        ->and(fn () => Filter::toggle('mine')->apply(Product::query(), true))->toThrow(LogicException::class);

    // checked when the component's config is built, not the first time a user turns it on
    ProductSheet::$filters = [Filter::toggle('mine')];
    try {
        // the view wraps it in a ViewException; the config alone throws the LogicException
        expect(fn () => Livewire::test(ProductSheet::class))->toThrow('is a toggle: give it a query()')
            ->and(fn () => (new ProductSheet)->getSpreadsheetConfig())->toThrow(LogicException::class);
    } finally {
        ProductSheet::$filters = null;
    }
});

it('narrows a date range to real calendar days only, either side open', function (): void {
    product('a-1', 'Hammer', ['available_on' => '2026-10-05']);
    product('b-2', 'Nail', ['available_on' => '2026-11-20']);
    $seen = null;

    $range = fn () => Filter::dateRange('available_on');

    expect(skusWith([$range()], ['available_on' => ['from' => '2026-11-01']]))->toBe(['B-2'])
        ->and(skusWith([$range()], ['available_on' => ['until' => '2026-10-05']]))->toBe(['A-1'])
        ->and(skusWith([$range()], ['available_on' => ['from' => '2026-10-05', 'until' => '2026-11-20']]))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$range()], ['available_on' => ['from' => '2026-02-30']]))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$range()], ['available_on' => ['from' => "2026-11-01' or 1=1 --"]]))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$range()], ['available_on' => 'not-an-array']))->toBe(['A-1', 'B-2'])
        ->and(skusWith([$range()->query(function (Builder $query, array $value) use (&$seen) {
            $seen = $value;
            $query->where('sku', 'A-1');
        })], ['available_on' => ['from' => '2026-11-01', 'until' => 'x']]))->toBe(['A-1'])
        ->and($seen)->toBe(['from' => '2026-11-01', 'until' => null])
        ->and($range()->toArray())->toMatchArray(['type' => 'dateRange', 'options' => []]);

    expect(Filter::date('2026-10-10'))->toBe('2026-10-10')
        ->and(Filter::date('2024-02-29'))->toBe('2024-02-29')
        ->and(Filter::date('2026-02-30'))->toBeNull() // strtotime() would roll it over to March 2
        ->and(Filter::date('2026-13-01'))->toBeNull()
        ->and(Filter::date('0999-12-31'))->toBeNull()
        ->and(Filter::date('2026-10-10 00:00'))->toBeNull()
        ->and(Filter::date(['2026-10-10']))->toBeNull()
        ->and(Filter::date(null))->toBeNull();
});

it('reads a state from the URL in the shape the browser holds, and knows its empty state', function (): void {
    $select = Filter::select('category_id')->options([1 => 'Tools', 2 => 'Paint']);
    $multiple = Filter::select('category_id')->multiple()->options([1 => 'Tools', 2 => 'Paint']);
    $searchable = Filter::select('category_id')->searchable()->options([1 => 'Tools']);
    $boolean = Filter::boolean('is_active');
    $toggle = Filter::toggle('mine')->query(fn () => null);
    $range = Filter::dateRange('available_on');

    expect($select->state('2'))->toBe('2')
        ->and($select->state(2))->toBe('2')
        ->and($select->state('9'))->toBe('')
        ->and($select->state(['2']))->toBe('')
        ->and($select->state(null))->toBe('')
        ->and($select->emptyState())->toBe('')
        ->and($multiple->state(['1', 9, '2', '1']))->toBe(['1', '2'])
        ->and($multiple->state('2'))->toBe(['2'])
        ->and($multiple->state(null))->toBe([])
        ->and($multiple->emptyState())->toBe([])
        ->and($searchable->state('77'))->toBe('77')
        ->and($boolean->state('0'))->toBe('0')
        ->and($boolean->state('maybe'))->toBe('')
        ->and($toggle->state('1'))->toBeTrue()
        ->and($toggle->state('true'))->toBeTrue()
        ->and($toggle->state('0'))->toBeFalse()
        ->and($toggle->state(null))->toBeFalse()
        ->and($toggle->emptyState())->toBeFalse()
        ->and($range->state(['from' => '2026-10-05', 'until' => '2026-02-30']))->toBe(['from' => '2026-10-05', 'until' => null])
        ->and($range->state('x'))->toBe(['from' => null, 'until' => null])
        ->and($range->emptyState())->toBe(['from' => null, 'until' => null]);
});

it('sends the browser each filter\'s shape: name, label, type, multiple, searchable, the limit and the options', function (): void {
    expect(Filter::select('category_id')->options([3 => 'Tools'])->optionsLimit(0)->toArray())->toBe([
        'name' => 'category_id',
        'label' => 'Category',
        'type' => 'select',
        'multiple' => false,
        'searchable' => false,
        'optionsLimit' => 1,
        'options' => [['value' => '3', 'label' => 'Tools']],
    ])
        ->and(Filter::select('x')->options(['a' => 'A', 'b' => 'B', 'c' => 'C'])->optionsLimit(2)->toArray()['options'])->toBe([['value' => 'a', 'label' => 'A'], ['value' => 'b', 'label' => 'B']])
        ->and(array_keys(Filter::dateRange('available_on')->toArray()))->toBe(['name', 'label', 'type', 'multiple', 'searchable', 'optionsLimit', 'options']);
});

/* ------------------------------------------------------------------ the fields: Filament's own components */

it('renders every filter as Filament\'s own field, each dispatching its change to the browser', function (): void {
    category('Tools');
    ProductSheet::$filters = [
        Filter::select('category_id')->options(fn () => Category::query()->pluck('name', 'id')->all()),
        Filter::select('owner')->multiple()->searchable()->options(['a' => 'A']),
        Filter::boolean('is_active'),
        Filter::toggle('mine')->query(fn ($q) => $q),
        Filter::dateRange('available_on')->label('Available'),
    ];

    try {
        $html = Livewire::test(ProductSheet::class)->html();
    } finally {
        ProductSheet::$filters = null;
    }

    // a native select for a plain filter, Filament's select for a multiple or searchable one, a toggle, two date pickers in a
    // fieldset, each watching its state path and dispatching the plugin's event with the filter's name (and the edge of a range)
    expect($html)->toContain('fi-fo-select-native')
        ->and($html)->toContain('fi-fo-select-wrp')
        ->and($html)->toContain('selectFormComponent(')
        ->and($html)->toContain('fi-fo-toggle')
        ->and(substr_count($html, 'fi-fo-date-time-picker-trigger'))->toBeGreaterThanOrEqual(2)
        ->and($html)->toContain('Available')
        ->and($html)->toContain('spreadsheetFiltersForm')
        ->and($html)->toContain('$wire.watch(\'spreadsheetFilters.category_id\'')
        ->and($html)->toContain('$wire.watch(\'spreadsheetFilters.owner\'')
        ->and($html)->toContain('$wire.watch(\'spreadsheetFilters.is_active\'')
        ->and($html)->toContain('$wire.watch(\'spreadsheetFilters.mine\'')
        ->and($html)->toContain('$wire.watch(\'spreadsheetFilters.available_on.from\'')
        ->and($html)->toContain('$wire.watch(\'spreadsheetFilters.available_on.until\'')
        ->and($html)->toContain('ps-sheet-filter\\u0027, { name: \\u0027category_id\\u0027')
        ->and($html)->toContain('ps-sheet-filter\\u0027, { name: \\u0027available_on\\u0027, edge: \\u0027until\\u0027')
        ->and($html)->toContain('x-on:ps-sheet-filter="setFilter($event.detail.name, $event.detail.value, $event.detail.edge)"')
        ->not->toContain('spreadsheetFilterOptions');
});

it('answers a searchable select\'s search and labels through Filament\'s own select, by its schema key', function (): void {
    $tools = category('Tools');
    $paint = category('Paint');
    ProductSheet::$filters = [Filter::select('category_id')->multiple()->searchable()->options(fn () => Category::query()->orderBy('name')->pluck('name', 'id')->all())];

    try {
        Livewire::test(ProductSheet::class)
            ->call('callSchemaComponentMethod', 'spreadsheetFiltersForm.category_id', 'getSearchResultsForJs', ['search' => 'too'])
            ->assertReturned(fn ($options) => collect($options)->pluck('label')->all() === ['Tools'] && (string) collect($options)->first()['value'] === (string) $tools->id)
            ->call('callSchemaComponentMethod', 'spreadsheetFiltersForm.category_id', 'getOptionsForJs')
            ->assertReturned(fn ($options) => collect($options)->pluck('label')->all() === ['Paint', 'Tools'])
            ->set('spreadsheetFilters.category_id', [(string) $paint->id, '999', (string) $tools->id])
            ->call('callSchemaComponentMethod', 'spreadsheetFiltersForm.category_id', 'getOptionLabelsForJs')
            ->assertReturned(fn ($labels) => collect($labels)->pluck('label', 'value')->all() == [$paint->id => 'Paint', $tools->id => 'Tools'])
            ->call('callSchemaComponentMethod', 'spreadsheetFiltersForm.nope', 'getOptionsForJs')
            ->assertReturned(null);
    } finally {
        ProductSheet::$filters = null;
    }
});

it('fills the fields\' state on mount, every path there before the browser entangles it', function (): void {
    Livewire::test(ProductSheet::class)
        ->assertSet('spreadsheetFilters', ['category_id' => null, 'is_active' => null, 'available_on' => ['from' => null, 'until' => null]]);
});

it('renders the filters where the layout says, Filament\'s fields in them, and nothing without filters', function (): void {
    $html = Livewire::mount(ProductSheet::class);

    expect($html)->toContain('ps-sheet-filters-dropdown', 'ps-sheet-filters-btn', 'ps-sheet-filters-count', 'fi-icon-btn-badge-ctn', 'ps-sheet-filters-panel', 'fi-ta-filters', 'fi-ta-filters-header', 'fi-ta-filters-heading', 'ps-sheet-filters-header', 'ps-sheet-filters-heading', 'ps-sheet-filters-reset', 'fi-sc', 'fi-fo-select', 'dateTimePickerFormComponent(', 'fi-fo-date-time-picker', 'fi-fieldset', 'fi-fo-field-label')
        ->not->toContain('ps-sheet-filters-inline', 'ps-sheet-filters-above', 'fi-input-wrp-prefix-has-label', '<input type="date"');

    config()->set('packstub-spreadsheet.filters_layout', 'toolbar');
    $html = Livewire::mount(ProductSheet::class);
    // inline: the label as the field's prefix, no label over it, the date pickers without a fieldset
    expect($html)->toContain('ps-sheet-toolbar-end', 'ps-sheet-filters-inline', 'fi-input-wrp-prefix-has-label', 'fi-sr-only')->not->toContain('ps-sheet-filters-btn', 'ps-sheet-filters-above', 'fi-fieldset');

    config()->set('packstub-spreadsheet.filters_layout', 'above');
    $html = Livewire::mount(ProductSheet::class);
    expect($html)->toContain('ps-sheet-filters-above', 'fi-ta-filters-header', 'ps-sheet-filters-header', 'fi-fieldset')->not->toContain('ps-sheet-filters-btn', 'ps-sheet-filters-inline', 'fi-input-wrp-prefix-has-label');

    config()->set('packstub-spreadsheet.filters_layout', 'dropdown');
    ProductSheet::$filters = [];
    try {
        $html = Livewire::mount(ProductSheet::class);
        expect($html)->toContain('ps-sheet-toolbar-start', 'ps-sheet-search')->not->toContain('ps-sheet-filters-btn', 'ps-sheet-filters-inline', 'ps-sheet-filters-above', 'spreadsheetFiltersForm');
    } finally {
        ProductSheet::$filters = null;
    }
});

/* ------------------------------------------------------------------ bounds */

it('caps the values a searchable multiple filter, a label lookup and a search take', function (): void {
    $lookups = 0;
    ProductSheet::$filters = [
        Filter::select('category_id')->multiple()->searchable()->optionsLimit(5)
            ->options(['a' => 'A'])
            ->getOptionLabelUsing(function (string $value) use (&$lookups) {
                $lookups++;

                return "L{$value}";
            })
            ->getSearchResultsUsing(fn (string $search) => collect(['s' => mb_strlen($search)])),
    ];

    try {
        $filter = ProductSheet::$filters[0];
        $applied = null;
        $filter->query(function ($query, array $values) use (&$applied) {
            $applied = $values;
        });
        $filter->apply(Product::query(), array_map('strval', range(1, 50)));

        expect($applied)->toHaveCount(5)->and($applied)->toBe(['1', '2', '3', '4', '5']);

        $filter->apply(Product::query(), [str_repeat('x', 256), 'ok']);
        expect($applied)->toBe(['ok']);

        Livewire::test(ProductSheet::class)
            ->set('spreadsheetFilters.category_id', array_merge(array_map('strval', range(1, 40)), ['1', '1']))
            ->call('callSchemaComponentMethod', 'spreadsheetFiltersForm.category_id', 'getOptionLabelsForJs')
            ->assertReturned(fn ($labels) => collect($labels)->pluck('label')->all() === ['L1', 'L2', 'L3', 'L4', 'L5'])
            ->call('callSchemaComponentMethod', 'spreadsheetFiltersForm.category_id', 'getSearchResultsForJs', ['search' => str_repeat('q', 500)])
            ->assertReturned(fn ($options) => array_map('strval', collect($options)->pluck('label')->all()) === ['200']);

        // five labels looked up per call (Filament reads the labels twice while answering)
        expect($lookups)->toBeLessThanOrEqual(10);
    } finally {
        ProductSheet::$filters = null;
    }
});
