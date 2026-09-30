<?php

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Livewire\Livewire;
use Packstub\Spreadsheet\Enums\SaveMode;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\ProductPolicy;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;

beforeEach(fn () => CarbonImmutable::setTestNow('2026-10-14 10:00:00'));

afterEach(fn () => CarbonImmutable::setTestNow());

it('renders the sheet with its config and first page as JSON for the browser', function () {
    product('a-1', 'Hammer');

    Livewire::test(ProductSheet::class)
        ->assertSeeHtml('x-data="packstubSpreadsheet(')
        ->assertSeeHtml('packstub/filament-spreadsheet/components/spreadsheet.js')
        ->assertSee('Hammer')
        ->assertSeeHtml('wire:ignore');
});

it('queries the rows on the first render only: a re-render carries none, the browser keeps its own', function () {
    product('a-1', 'Hammer');

    $component = Livewire::test(ProductSheet::class)->assertSee('Hammer');

    DB::enableQueryLog();
    $component->call('$refresh')->assertSeeHtml('x-data="packstubSpreadsheet(')->assertDontSee('Hammer');
    $queries = collect(DB::getQueryLog())->pluck('query');
    DB::disableQueryLog();

    expect($queries->filter(fn (string $sql) => str_contains($sql, 'from "products"')))->toBeEmpty()
        ->and($component->instance()->spreadsheetRendered)->toBeTrue()
        ->and($component->instance()->getSpreadsheetConfig()['state'])->toBeNull()
        ->and($component->instance()->getSpreadsheetConfig(withState: true)['state']['rows'][0]['values']['name'])->toBe('Hammer');
});

it('answers a page of rows renderless, whatever shape the request has', function () {
    foreach (range(1, 5) as $i) {
        product("p-{$i}", "Item {$i}");
    }

    Livewire::test(ProductSheet::class)
        ->call('spreadsheetRows', ['page' => 2, 'perPage' => 2, 'sort' => ['column' => 'sku', 'direction' => 'desc'], 'search' => 'item'])
        ->assertReturned(fn ($r) => $r['ok'] === true && $r['page'] === 2 && $r['total'] === 5 && array_column(array_column($r['rows'], 'values'), 'sku') === ['P-3', 'P-2'])
        ->assertNoRedirect()
        ->call('spreadsheetRows', ['page' => [1], 'perPage' => 'x', 'sort' => 'sku', 'search' => ['a'], 'filters' => 'none'])
        ->assertReturned(fn ($r) => $r['ok'] === true && $r['page'] === 1 && $r['perPage'] === 100 && count($r['rows']) === 5)
        ->call('spreadsheetRows')
        ->assertReturned(fn ($r) => $r['ok'] === true && $r['total'] === 5);
});

it('saves a payload spanning two pages in one call and answers with the rows as saved', function () {
    foreach (range(1, 4) as $i) {
        product("p-{$i}", "Item {$i}", ['price' => $i]);
    }
    ProductSheet::$perPage = 2;
    [$first, $last] = [Product::query()->where('sku', 'P-1')->first(), Product::query()->where('sku', 'P-4')->first()];

    CarbonImmutable::setTestNow('2026-10-14 10:00:09');

    Livewire::test(ProductSheet::class)
        ->call('spreadsheetSave', [
            'changed' => [$first->id => ['price' => '10'], $last->id => ['price' => '40']],
            'versions' => [$first->id => $first->getAttributes()['updated_at'], $last->id => $last->getAttributes()['updated_at']],
            'created' => ['n1' => ['sku' => 'p-5', 'name' => 'Item 5']],
        ])
        ->assertReturned(function ($r) use ($first, $last) {
            $saved = (array) $r['saved'];

            return $r['ok'] === true
                && $saved[$first->id]['values']['price'] == 10
                && $saved[$last->id]['values']['price'] == 40
                && $saved[$first->id]['version'] === '2026-10-14 10:00:09'
                && ((array) $r['created'])['n1']['values']['sku'] === 'P-5'
                && $r['deleted'] === []
                && $r['message'] === null;
        });

    expect(Product::query()->count())->toBe(5)
        ->and($first->fresh()->price)->toBe('10.00');
});

it('answers errors and conflicts per cell without an exception, whatever the payload looks like', function () {
    $product = product('a-1', 'Hammer');

    Livewire::test(ProductSheet::class)
        ->call('spreadsheetSave', ['changed' => [$product->id => ['price' => 'abc', 'margin' => 1]]])
        ->assertReturned(fn ($r) => $r['ok'] === false && $r['rolledBack'] === true && ((array) $r['errors'])[$product->id] === ['price' => 'Not a number.', 'margin' => 'This cell cannot be edited.'])
        ->call('spreadsheetSave', ['changed' => 'garbage', 'created' => 'garbage', 'deleted' => 'y', 'versions' => 3])
        ->assertReturned(fn ($r) => $r['ok'] === true && (array) $r['saved'] === [] && (array) $r['created'] === [])
        ->call('spreadsheetSave', ['created' => [['sku' => 'x']]])
        ->assertReturned(fn ($r) => $r['ok'] === false && array_keys((array) $r['errors']) == ['0'] && isset(((array) $r['errors'])['0']['name']))
        ->call('spreadsheetSave', ['created' => ['n1' => ['sku' => str_repeat('x', 40), 'name' => 'Long']]])
        ->assertReturned(fn ($r) => str_contains(((array) $r['errors'])['n1']['sku'], '32'))
        ->call('spreadsheetSave')
        ->assertReturned(fn ($r) => $r['ok'] === true);

    expect($product->fresh()->price)->toBe('0.00');
});

it('answers a refused save with its reason and a failed one with a generic message, the exception reported', function () {
    Exceptions::fake();
    $product = product('a-1', 'Hammer');

    ProductSheet::$readOnly = true;
    Livewire::test(ProductSheet::class)
        ->call('spreadsheetSave', ['changed' => [$product->id => ['name' => 'X']]])
        ->assertReturned(fn ($r) => $r['ok'] === false && $r['message'] === 'This sheet is read-only.' && $r['rolledBack'] === true);

    ProductSheet::$readOnly = false;
    ProductSheet::$failInAfterSave = true;

    // In both modes: the rows are rolled back, so the generic answer is true and a second save is not a conflict.
    foreach ([SaveMode::AllOrNothing, SaveMode::PerRow] as $mode) {
        ProductSheet::$saveMode = $mode;
        Livewire::test(ProductSheet::class)
            ->call('spreadsheetSave', ['changed' => [$product->id => ['name' => 'X']]])
            ->assertReturned(fn ($r) => $r['ok'] === false && $r['message'] === 'The save did not go through.' && $r['rolledBack'] === true);

        expect($product->fresh()->name)->toBe('Hammer', "{$mode->name}: the row was committed although the answer says it was not");
    }

    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'indexer down');
    Exceptions::assertReportedCount(2);
});

it('deletes renderless through the policy, with crafted ids ignored', function () {
    $a = product('a-1');
    $b = product('b-2');
    ProductPolicy::$deletable = ['A-1'];
    ProductSheet::$saveMode = SaveMode::PerRow;

    Livewire::test(ProductSheet::class)
        ->call('spreadsheetDelete', [(string) $a->id, $b->id, ['x'], null, ''])
        ->assertReturned(fn ($r) => $r['deleted'] === [(string) $a->id] && ((array) $r['rowErrors'])[$b->id] === 'You cannot delete this row.')
        ->call('spreadsheetDelete', [])
        ->assertReturned(fn ($r) => $r['deleted'] === [] && $r['ok'] === true);

    expect(Product::query()->pluck('sku')->all())->toBe(['B-2']);
});

it('reports an unexpected failure while reading rows instead of surfacing it', function () {
    Exceptions::fake();
    product('a-1');

    $component = Livewire::test(ProductSheet::class);
    ProductSheet::$brokenQuery = true;

    $component
        ->call('spreadsheetRows', ['page' => 1])
        ->assertReturned(['ok' => false, 'message' => 'The rows could not be loaded.']);

    Exceptions::assertReportedCount(1);
});
