<?php

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Livewire\Livewire;
use Packstub\Spreadsheet\SpreadsheetPlugin;
use Packstub\Spreadsheet\Tests\Fixtures\CatalogPage;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\ProductPolicy;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource\Pages\ListProducts;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource\Pages\ProductsSheet;

beforeEach(function () {
    CarbonImmutable::setTestNow('2026-10-14 10:00:00');
    $this->actingAs(user());
});

afterEach(fn () => CarbonImmutable::setTestNow());

it('serves the resource page at the resource\'s route with the resource\'s rows', function () {
    product('a-1', 'Hammer');

    expect(ProductResource::getUrl('sheet'))->toBe('http://localhost/admin/products/sheet');

    $this->get('/admin/products/sheet')
        ->assertOk()
        ->assertSee('x-data="packstubSpreadsheet(', false)
        ->assertSee('Hammer')
        ->assertSee('packstub/filament-spreadsheet/components/spreadsheet.js');
});

it('follows the resource policy for access', function () {
    ProductPolicy::$allowed = false;

    $this->get('/admin/products/sheet')->assertForbidden();

    expect(ProductsSheet::canAccess())->toBeFalse();
});

it('reads through the resource\'s query, the way a tenant scope narrows it, and writes only inside it', function () {
    $mine = product('a-1', 'Mine', ['status' => 'live']);
    $theirs = product('b-2', 'Theirs', ['status' => 'draft']);
    ProductResource::$scope = fn (Builder $query) => $query->where('status', 'live');

    $component = Livewire::test(ProductsSheet::class);

    expect(array_column(array_column($component->instance()->getSpreadsheetConfig(withState: true)['state']['rows'], 'values'), 'sku'))->toBe(['A-1']);

    $component
        ->call('spreadsheetSave', ['changed' => [$mine->id => ['name' => 'Changed'], $theirs->id => ['name' => 'Reached']], 'versions' => versions($mine->id, $theirs->id)])
        ->assertReturned(fn ($r) => $r['ok'] === false && ((array) $r['rowErrors'])[$theirs->id] === 'This row is no longer in the sheet.');

    expect($theirs->fresh()->name)->toBe('Theirs')
        ->and($mine->fresh()->name)->toBe('Mine');
});

it('goes through the resource\'s abilities for each row, create and delete', function () {
    $a = product('a-1', 'A');
    $b = product('b-2', 'B');
    ProductPolicy::$updatable = ['A-1'];
    ProductPolicy::$deletable = ['B-2'];
    ProductPolicy::$createAllowed = false;

    $component = Livewire::test(ProductsSheet::class);
    $rows = $component->instance()->getSpreadsheetConfig(withState: true)['state']['rows'];

    expect($rows[0])->toMatchArray(['readOnly' => false, 'deletable' => false])
        ->and($rows[1])->toMatchArray(['readOnly' => true, 'deletable' => true])
        ->and($component->instance()->getSpreadsheetConfig()['creatable'])->toBeFalse();

    $component
        ->call('spreadsheetSave', ['changed' => [$a->id => ['name' => 'Ok'], $b->id => ['name' => 'No']], 'versions' => versions($a->id, $b->id), 'created' => ['n1' => ['sku' => 'c-3', 'name' => 'New']], 'deleted' => [$a->id]])
        ->assertReturned(fn ($r) => $r['rolledBack'] === true
            && ((array) $r['rowErrors'])[$b->id] === 'You cannot change this row.'
            && ((array) $r['rowErrors'])['n1'] === 'You cannot add rows here.'
            && ((array) $r['rowErrors'])[$a->id] === 'You cannot delete this row.');

    ProductPolicy::$updatable = null;
    ProductPolicy::$createAllowed = true;
    ProductPolicy::$deletable = null;

    Livewire::test(ProductsSheet::class)
        ->call('spreadsheetSave', ['changed' => [$a->id => ['name' => 'Ok']], 'versions' => versions($a->id), 'created' => ['n1' => ['sku' => 'c-3', 'name' => 'New']], 'deleted' => [$b->id]])
        ->assertReturned(fn ($r) => $r['ok'] === true);

    expect(Product::query()->pluck('name', 'sku')->all())->toBe(['A-1' => 'Ok', 'C-3' => 'New']);
});

it('serves a standalone page with its own query', function () {
    product('a-1', 'Shown');
    product('b-2', 'Hidden', ['is_active' => false]);

    $this->get('/admin/catalog')->assertOk()->assertSee('A-1')->assertDontSee('B-2')->assertSee('packstubSpreadsheet(');

    $config = Livewire::test(CatalogPage::class)->instance()->getSpreadsheetConfig(withState: true);

    expect($config['perPage'])->toBe(50)
        ->and($config['pageSizes'])->toBe([25, 50, 100, 200, 500, 1000])
        ->and($config['creatable'])->toBeFalse()
        ->and(array_column(array_column($config['state']['rows'], 'values'), 'sku'))->toBe(['A-1']);
});

it('shows the sheet action on the list page, linking to the sheet, only to those who may open it', function () {
    product('a-1');

    Livewire::test(ListProducts::class)
        ->assertActionVisible('sheet')
        ->assertActionHasUrl('sheet', 'http://localhost/admin/products/sheet')
        ->assertActionHasLabel('sheet', 'Edit as sheet');

    ProductsSheet::$accessible = false;

    try {
        Livewire::test(ListProducts::class)->assertActionHidden('sheet');
    } finally {
        ProductsSheet::$accessible = true;
    }
});

it('registers the plugin on the panel', function () {
    expect(filament('packstub-spreadsheet'))->toBeInstanceOf(SpreadsheetPlugin::class)
        ->and(SpreadsheetPlugin::get()->getId())->toBe('packstub-spreadsheet');
});
