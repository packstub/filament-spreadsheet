<?php

use Livewire\Livewire;
use Packstub\Spreadsheet\Tests\Fixtures\ProductPolicy;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;

it('presents a record as plain values after casts, one per visible column', function () {
    $tools = category('Tools');
    $product = product('a-1', 'Hammer', [
        'category_id' => $tools->id, 'price' => '12.5', 'cost' => 8, 'stock' => 3, 'is_active' => 1,
        'available_on' => '2026-10-05', 'published_at' => '2026-10-05 08:30:00', 'status' => 'live', 'notes' => 'secret',
    ]);

    $row = sheet()->rows()['rows'][0];

    expect($row['id'])->toBe((string) $product->id)
        ->and($row['version'])->toBe($product->getAttributes()['updated_at'])
        ->and($row['values'])->toBe([
            'sku' => 'A-1',
            'name' => 'Hammer',
            'category_id' => (string) $tools->id,
            'status' => 'live',
            'price' => 12.5,
            'cost' => 8.0,
            'stock' => 3,
            'is_active' => true,
            'available_on' => '2026-10-05',
            'published_at' => '2026-10-05 08:30:00',
            'margin' => 4.5,
        ])
        ->and($row)->toMatchArray(['locked' => [], 'readOnly' => false, 'deletable' => true]);
});

it('lists relationship and enum options, the hidden column left out', function () {
    $tools = category('Tools');
    category('Retired', active: false);

    $columns = collect(Livewire::test(ProductSheet::class)->instance()->getSpreadsheetConfig()['columns'])->keyBy('name');

    expect($columns->keys()->all())->toBe(['sku', 'name', 'category_id', 'status', 'price', 'cost', 'stock', 'is_active', 'available_on', 'published_at', 'margin'])
        ->and($columns['category_id']['options'])->toBe([['value' => (string) $tools->id, 'label' => 'Tools']])
        ->and($columns['status']['options'])->toBe([['value' => 'draft', 'label' => 'Draft'], ['value' => 'live', 'label' => 'Live'], ['value' => 'retired', 'label' => 'Retired']])
        ->and($columns['status']['default'])->toBe('draft')
        ->and($columns['sku'])->toMatchArray(['type' => 'text', 'frozen' => true, 'editable' => true, 'sortable' => true])
        ->and($columns['margin'])->toMatchArray(['type' => 'computed', 'editable' => false, 'readOnly' => true, 'sortable' => false])
        ->and($columns['price'])->toMatchArray(['type' => 'number', 'decimals' => 2, 'min' => 0, 'integer' => false])
        ->and($columns['stock'])->toMatchArray(['integer' => true, 'decimals' => 0, 'default' => 0])
        ->and($columns['is_active']['default'])->toBeTrue()
        ->and($columns['available_on']['format'])->toBe('Y-m-d')
        ->and($columns['published_at']['format'])->toBe('Y-m-d H:i');
});

it('locks a column per record and greys a row the policy will not let the user update', function () {
    product('a-1', 'Open');
    product('b-2', 'Locked', ['is_locked' => true]);
    ProductPolicy::$updatable = ['A-1'];
    ProductPolicy::$deletable = ['B-2'];

    $rows = sheet()->rows()['rows'];

    expect($rows[0])->toMatchArray(['locked' => [], 'readOnly' => false, 'deletable' => false])
        ->and($rows[1])->toMatchArray(['locked' => ['cost'], 'readOnly' => true, 'deletable' => true]);
});

it('marks every row read-only on a read-only sheet', function () {
    product('a-1');
    ProductSheet::$readOnly = true;

    $component = Livewire::test(ProductSheet::class);

    expect($component->instance()->getSpreadsheetConfig(withState: true)['state']['rows'][0])->toMatchArray(['readOnly' => true, 'deletable' => false])
        ->and($component->instance()->getSpreadsheetConfig())->toMatchArray(['readOnly' => true, 'creatable' => false, 'deletable' => false]);
});

it('searches the searchable attributes, a relation\'s too, with the wildcards escaped', function () {
    $tools = category('Tools');
    product('a-1', 'Hammer', ['category_id' => $tools->id]);
    product('b-2', '100% cotton');
    product('c-3', 'Nail');

    $skus = fn (string $search) => array_column(array_column(sheet()->rows(['search' => $search])['rows'], 'values'), 'sku');

    expect($skus('ham'))->toBe(['A-1'])
        ->and($skus('tool'))->toBe(['A-1'])
        ->and($skus('100%'))->toBe(['B-2'])
        ->and($skus('%'))->toBe(['B-2'])
        ->and($skus('  '))->toBe(['A-1', 'B-2', 'C-3']);
});

it('sorts by a sortable column only and falls back to the default sort for anything else', function () {
    product('b-2', 'Beta', ['price' => 5]);
    product('a-1', 'Alpha', ['price' => 9]);

    $skus = fn (mixed $sort) => array_column(array_column(sheet()->rows(['sort' => $sort])['rows'], 'values'), 'sku');

    expect($skus(null))->toBe(['A-1', 'B-2'])
        ->and($skus(['column' => 'price', 'direction' => 'desc']))->toBe(['A-1', 'B-2'])
        ->and($skus(['column' => 'price', 'direction' => 'asc']))->toBe(['B-2', 'A-1'])
        ->and($skus(['column' => 'margin', 'direction' => 'asc']))->toBe(['A-1', 'B-2'])
        ->and($skus(['column' => 'notes']))->toBe(['A-1', 'B-2'])
        ->and($skus(['column' => 'id; drop table products']))->toBe(['A-1', 'B-2'])
        ->and($skus(['column' => ['price']]))->toBe(['A-1', 'B-2'])
        ->and($skus('price'))->toBe(['A-1', 'B-2'])
        ->and(sheet()->rows(['sort' => ['column' => 'price', 'direction' => 'sideways']])['sort'])->toBe(['column' => 'price', 'direction' => 'asc']);
});

it('applies the filters and ignores values they did not offer', function () {
    $tools = category('Tools');
    product('a-1', 'Hammer', ['category_id' => $tools->id, 'is_active' => true, 'available_on' => '2026-10-05']);
    product('b-2', 'Nail', ['is_active' => false, 'available_on' => '2026-11-20']);

    $skus = fn (array $filters) => array_column(array_column(sheet()->rows(['filters' => $filters])['rows'], 'values'), 'sku');

    expect($skus(['category_id' => (string) $tools->id]))->toBe(['A-1'])
        ->and($skus(['category_id' => '999']))->toBe(['A-1', 'B-2'])
        ->and($skus(['is_active' => '0']))->toBe(['B-2'])
        ->and($skus(['is_active' => 'maybe']))->toBe(['A-1', 'B-2'])
        ->and($skus(['available_on' => ['from' => '2026-11-01']]))->toBe(['B-2'])
        ->and($skus(['available_on' => ['until' => '2026-10-05']]))->toBe(['A-1'])
        ->and($skus(['available_on' => ['from' => "2026-11-01' or 1=1 --"]]))->toBe(['A-1', 'B-2'])
        ->and($skus(['available_on' => 'not-an-array']))->toBe(['A-1', 'B-2'])
        ->and($skus(['unknown' => 'x']))->toBe(['A-1', 'B-2']);
});

it('paginates with the page size clamped to the config', function () {
    foreach (range(1, 7) as $i) {
        product("p-{$i}");
    }

    config()->set('packstub-spreadsheet.max_per_page', 5);

    $page = sheet()->rows(['page' => 2, 'perPage' => 3]);

    expect($page)->toMatchArray(['total' => 7, 'page' => 2, 'perPage' => 3, 'lastPage' => 3])
        ->and(array_column(array_column($page['rows'], 'values'), 'sku'))->toBe(['P-4', 'P-5', 'P-6'])
        ->and(sheet()->rows(['perPage' => 1000])['perPage'])->toBe(5)
        ->and(sheet()->rows(['perPage' => -3])['perPage'])->toBe(1)
        ->and(sheet()->rows(['perPage' => 'lots'])['perPage'])->toBe(5)
        ->and(sheet()->rows(['page' => 'x'])['page'])->toBe(1)
        ->and(sheet()->rows(['page' => 99])['rows'])->toBe([]);
});

it('hands the browser everything it needs in the config, the first page of rows included once', function () {
    product('a-1');

    $component = Livewire::test(ProductSheet::class);
    $config = $component->instance()->getSpreadsheetConfig(withState: true);

    expect($config)->toMatchArray([
        'perPage' => 100,
        'pageSizes' => [25, 50, 100, 200, 500, 1000],
        'sort' => ['column' => 'sku', 'direction' => 'asc'],
        'searchable' => true,
        'creatable' => true,
        'deletable' => true,
        'readOnly' => false,
        'saveMode' => 'all_or_nothing',
        'versioned' => true,
        'confirmLeave' => true,
        'frozenFirstColumn' => true,
        'rowHeight' => 32,
        'locale' => 'en',
        'height' => null,
    ])
        ->and($config['key'])->toBe('spreadsheet:'.ProductSheet::class.':guest')
        ->and($config['state']['rows'][0]['values']['sku'])->toBe('A-1')
        ->and(array_column($config['filters'], 'type'))->toBe(['select', 'select', 'dateRange'])
        ->and($config['filters'][1]['options'])->toBe([['value' => '1', 'label' => 'Yes'], ['value' => '0', 'label' => 'No']])
        ->and($config['i18n']['save'])->toBe('Save');

    // A later render carries no rows: the browser keeps its own.
    expect($component->instance()->getSpreadsheetConfig()['state'])->toBeNull()
        ->and($component->instance()->spreadsheetRendered)->toBeTrue();
});
