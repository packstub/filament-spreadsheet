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

it('answers a select filter\'s options, a search, a value\'s label and several labels renderless', function (): void {
    $tools = category('Tools');
    $paint = category('Paint');

    Livewire::test(ProductSheet::class)
        ->call('spreadsheetFilterOptions', 'category_id')
        ->assertReturned([['value' => (string) $tools->id, 'label' => 'Tools'], ['value' => (string) $paint->id, 'label' => 'Paint']])
        ->call('spreadsheetFilterOptions', 'category_id', 'pai')
        ->assertReturned([['value' => (string) $paint->id, 'label' => 'Paint']])
        ->call('spreadsheetFilterOptions', 'is_active')
        ->assertReturned([['value' => '1', 'label' => 'Yes'], ['value' => '0', 'label' => 'No']])
        ->call('spreadsheetFilterOptions', 'available_on')
        ->assertReturned([])
        ->call('spreadsheetFilterOptions', 'nope')
        ->assertReturned([])
        ->call('spreadsheetFilterOptions', ['category_id'])
        ->assertReturned([])
        ->call('spreadsheetFilterOptions', 'category_id', ['x'])
        ->assertReturned([])
        ->call('spreadsheetFilterOptionLabel', 'category_id', (string) $tools->id)
        ->assertReturned('Tools')
        ->call('spreadsheetFilterOptionLabel', 'category_id', '999')
        ->assertReturned(null)
        ->call('spreadsheetFilterOptionLabel', 'category_id', ['x'])
        ->assertReturned(null)
        ->call('spreadsheetFilterOptionLabel', 'available_on', '2026-10-05')
        ->assertReturned(null)
        ->call('spreadsheetFilterOptionLabels', 'category_id', [(string) $paint->id, '999', $tools->id, ['x']])
        ->assertReturned([(string) $paint->id => 'Paint', (string) $tools->id => 'Tools'])
        ->call('spreadsheetFilterOptionLabels', 'category_id', 'not-a-list')
        ->assertReturned([])
        ->call('spreadsheetFilterOptionLabels', 'nope', ['1'])
        ->assertReturned([]);
});

it('renders the filters where the layout says, Filament\'s select and date picker in them, and nothing without filters', function (): void {
    $html = Livewire::mount(ProductSheet::class);

    expect($html)->toContain('ps-sheet-filters-dropdown', 'ps-sheet-filters-btn', 'ps-sheet-filters-panel', 'ps-sheet-filters-header', 'ps-sheet-filters-heading', 'ps-sheet-filters-reset', 'ps-sheet-filter-stacked', 'selectFormComponent(', 'dateTimePickerFormComponent(', 'fi-select-input', 'fi-fo-date-time-picker', 'fi-checkbox-input', '$wire.spreadsheetFilterOptions(', 'pickSelect(filter.name', 'pickFilter(filter.name, &#039;from&#039;', 'toggleFilter(filter)')
        ->not->toContain('ps-sheet-filters-inline', 'ps-sheet-filters-above', '<input type="date"', 'fi-select-input"></select');

    config()->set('packstub-spreadsheet.filters_layout', 'toolbar');
    $html = Livewire::mount(ProductSheet::class);
    expect($html)->toContain('ps-sheet-toolbar-end', 'ps-sheet-filters-inline')->not->toContain('ps-sheet-filters-btn', 'ps-sheet-filters-above', 'ps-sheet-filter-stacked');

    config()->set('packstub-spreadsheet.filters_layout', 'above');
    $html = Livewire::mount(ProductSheet::class);
    expect($html)->toContain('ps-sheet-filters-above', 'ps-sheet-filters-header', 'ps-sheet-filter-stacked')->not->toContain('ps-sheet-filters-btn', 'ps-sheet-filters-inline');

    config()->set('packstub-spreadsheet.filters_layout', 'dropdown');
    ProductSheet::$filters = [];
    try {
        $html = Livewire::mount(ProductSheet::class);
        expect($html)->toContain('ps-sheet-toolbar-start', 'ps-sheet-search')->not->toContain('ps-sheet-filters-btn', 'ps-sheet-filters-inline', 'ps-sheet-filters-above', 'ps-sheet-filter');
    } finally {
        ProductSheet::$filters = null;
    }
});
