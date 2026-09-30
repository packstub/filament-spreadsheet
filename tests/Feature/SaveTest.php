<?php

use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;
use Packstub\Spreadsheet\Enums\SaveMode;
use Packstub\Spreadsheet\Events\RowSaveFailed;
use Packstub\Spreadsheet\Events\RowsSaved;
use Packstub\Spreadsheet\Exceptions\SaveRejected;
use Packstub\Spreadsheet\SavePayload;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\ProductPolicy;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;

beforeEach(function () {
    CarbonImmutable::setTestNow('2026-10-14 10:00:00');
});

afterEach(fn () => CarbonImmutable::setTestNow());

/* ------------------------------------------------------------------ writing values */

it('coerces what the browser sends by column type and answers with the row after casts and mutators', function () {
    $tools = category('Tools');
    $product = product('a-1', 'Hammer');

    // updated_at has whole seconds: the version can only move on if the clock did.
    CarbonImmutable::setTestNow('2026-10-14 10:00:05');

    $result = save(['changed' => [$product->id => [
        'sku' => ' b-9 ',
        'name' => 'Sledge',
        'category_id' => $tools->id,
        'status' => 'live',
        'price' => '1.234,50',
        'cost' => '1,234.5',
        'stock' => '12',
        'is_active' => 'no',
        'available_on' => '2026-11-01',
        'published_at' => '2026-11-01T09:30',
    ]]]);

    expect($result->ok())->toBeTrue()
        ->and($result->saved[$product->id]['values'])->toMatchArray([
            'sku' => 'B-9',
            'name' => 'Sledge',
            'category_id' => (string) $tools->id,
            'status' => 'live',
            'price' => 1234.5,
            'cost' => 1234.5,
            'stock' => 12,
            'is_active' => false,
            'available_on' => '2026-11-01',
            'published_at' => '2026-11-01 09:30:00',
            'margin' => 0.0,
        ])
        ->and($result->saved[$product->id]['version'])->not->toBe($product->getAttributes()['updated_at'])
        ->and($product->fresh())->toMatchArray(['sku' => 'B-9', 'stock' => 12, 'is_active' => false, 'updated_by' => 7])
        ->and($product->fresh()->price)->toBe('1234.50');
});

it('reads numbers, booleans and dates in every shape a paste brings, and refuses the rest on the cell', function () {
    $product = product('a-1');

    // Both helpers insist on their outcome: a refused save must never read as "null" and pass a ->toBeNull().
    $ok = function (string $column, mixed $value) use ($product): mixed {
        $result = save(['changed' => [$product->id => [$column => $value]]]);
        expect($result->ok())->toBeTrue("{$column} = ".json_encode($value).' was refused: '.json_encode($result->toArray()));

        return $result->saved[$product->id]['values'][$column];
    };
    $error = function (string $column, mixed $value) use ($product): string {
        $result = save(['changed' => [$product->id => [$column => $value]]]);
        expect(isset($result->errors[$product->id][$column]))->toBeTrue("{$column} = ".json_encode($value).' was not refused on its cell: '.json_encode($result->toArray()));

        return $result->errors[$product->id][$column];
    };

    expect($ok('price', '12'))->toBe(12.0)
        ->and($ok('price', '1 234,5'))->toBe(1234.5)
        ->and($ok('price', '0,5'))->toBe(0.5)
        ->and($ok('price', '1,234'))->toBe(1234.0)
        ->and($ok('price', 12.345))->toBe(12.35)
        ->and($ok('stock', 3.0))->toBe(3)
        ->and($ok('is_active', 1))->toBeTrue()
        ->and($ok('is_active', 'TRUE'))->toBeTrue()
        ->and($ok('is_active', 'off'))->toBeFalse()
        ->and($ok('is_active', ''))->toBeNull()
        ->and($ok('available_on', '2026-02-28 13:00'))->toBe('2026-02-28')
        ->and($ok('available_on', ''))->toBeNull()
        ->and($ok('published_at', '2026-02-28'))->toBe('2026-02-28 00:00:00')
        ->and($error('price', 'abc'))->toBe('Not a number.')
        ->and($error('price', '-1'))->toContain('at least 0')
        ->and($error('stock', '2.5'))->toBe('Not a whole number.')
        ->and($error('stock', ['2']))->toBe('This value cannot be read.')
        ->and($error('is_active', 'maybe'))->toBe('Not a yes/no value.')
        ->and($error('available_on', '2026-02-30'))->toBe('Not a date (YYYY-MM-DD).')
        ->and($error('available_on', 'next tuesday'))->toBe('Not a date (YYYY-MM-DD).')
        ->and($error('published_at', '2026-02-28 25:00'))->toBe('Not a date and time (YYYY-MM-DD HH:MM).')
        ->and($error('status', 'gone'))->toBe('Not one of the options.')
        ->and($error('category_id', '999'))->toBe('Not one of the options.')
        ->and($error('name', ''))->toContain('required');
});

it('clears a cell of every type to null, unless a required rule refuses the clear', function () {
    $tools = category('Tools');
    $product = product('a-1', 'Hammer', ['price' => 5, 'stock' => 3, 'is_active' => true, 'available_on' => '2026-01-01', 'published_at' => '2026-01-01 10:00:00', 'category_id' => $tools->id, 'status' => 'live']);
    $cleared = ['price' => null, 'stock' => null, 'is_active' => null, 'available_on' => null, 'published_at' => null, 'category_id' => null, 'status' => null];

    // Delete, an empty pasted cell and "" in a select all arrive as '' or null.
    $result = save(['changed' => [$product->id => ['price' => '', 'stock' => null, 'is_active' => '', 'available_on' => '', 'published_at' => null, 'category_id' => '', 'status' => '']]]);

    expect($result->ok())->toBeTrue(json_encode($result->toArray()))
        ->and($result->saved[$product->id]['values'])->toMatchArray($cleared)
        ->and($product->fresh()->getAttributes())->toMatchArray($cleared);

    $refused = save(['changed' => [$product->id => ['name' => '', 'sku' => null]]]);

    expect($refused->errors[$product->id])->toBe(['name' => 'The Name field is required.', 'sku' => 'The Sku field is required.'])
        ->and($refused->rolledBack)->toBeTrue()
        ->and($product->fresh()->name)->toBe('Hammer');
});

it('validates with the column rules, a unique rule ignoring the record itself', function () {
    $a = product('a-1');
    product('b-2');

    $same = save(['changed' => [$a->id => ['sku' => 'a-1', 'name' => 'Same SKU']]]);
    $taken = save(['changed' => [$a->id => ['sku' => 'B-2']]]);
    $long = save(['changed' => [$a->id => ['name' => str_repeat('x', 121)]]]);

    expect($same->ok())->toBeTrue()
        ->and($taken->errors[$a->id]['sku'])->toContain('already been taken')
        ->and($taken->rolledBack)->toBeTrue()
        ->and($long->errors[$a->id]['name'])->toContain('120')
        ->and($a->fresh()->name)->toBe('Same SKU');
});

it('refuses cells that are not editable: computed, read-only, locked for the record, hidden or unknown', function () {
    $product = product('a-1', 'Hammer', ['is_locked' => true, 'notes' => 'keep']);

    $result = save(['changed' => [$product->id => ['margin' => 9, 'cost' => 1, 'notes' => 'changed', 'id' => 99, 'nope' => 1, 'name' => 'Sledge']]]);

    expect($result->errors[$product->id])->toBe([
        'margin' => 'This cell cannot be edited.',
        'cost' => 'This cell cannot be edited.',
        'notes' => 'This cell cannot be edited.',
        'id' => 'This cell cannot be edited.',
        'nope' => 'This cell cannot be edited.',
    ])
        ->and($product->fresh())->toMatchArray(['name' => 'Hammer', 'notes' => 'keep', 'id' => $product->id]);
});

/* ------------------------------------------------------------------ authorisation */

it('refuses a row the policy will not let the user update, and a record no longer in the sheet', function () {
    Event::fake([RowSaveFailed::class]);
    $a = product('a-1');
    $b = product('b-2');
    ProductPolicy::$updatable = ['A-1'];
    ProductSheet::$saveMode = SaveMode::PerRow;

    $result = save(['changed' => [$a->id => ['name' => 'Ok'], $b->id => ['name' => 'Denied'], '999' => ['name' => 'Gone']]]);

    expect(keys($result->saved))->toBe([(string) $a->id])
        ->and($result->rowErrors)->toBe([(string) $b->id => 'You cannot change this row.', '999' => 'This row is no longer in the sheet.'])
        ->and($b->fresh()->name)->toBe('Product');

    Event::assertDispatchedTimes(RowSaveFailed::class, 2);
    Event::assertDispatched(RowSaveFailed::class, fn (RowSaveFailed $e) => $e->record?->is($b) && $e->reason === 'You cannot change this row.' && $e->data === ['name' => 'Denied']);
});

it('creates rows only when creatable and the policy allows, deletes only when deletable and the policy allows', function () {
    $a = product('a-1');
    $b = product('b-2');
    ProductPolicy::$deletable = ['A-1'];
    ProductSheet::$saveMode = SaveMode::PerRow;

    $result = save(['created' => ['n1' => ['sku' => 'c-3', 'name' => 'New']], 'deleted' => [$a->id, $b->id, 999]]);

    expect($result->created['n1']['values'])->toMatchArray(['sku' => 'C-3', 'name' => 'New', 'status' => 'draft', 'stock' => 0, 'is_active' => true])
        ->and($result->deleted)->toBe([(string) $a->id])
        ->and($result->rowErrors)->toBe([(string) $b->id => 'You cannot delete this row.', '999' => 'This row is no longer in the sheet.'])
        ->and(Product::query()->pluck('sku')->all())->toBe(['B-2', 'C-3'])
        ->and(Product::query()->where('sku', 'C-3')->value('updated_by'))->toBe(7);

    ProductPolicy::$createAllowed = false;
    expect(save(['created' => ['n1' => ['sku' => 'd-4', 'name' => 'No']]])->rowErrors)->toBe(['n1' => 'You cannot add rows here.']);

    ProductPolicy::$createAllowed = true;
    ProductSheet::$creatable = false;
    expect(save(['created' => ['n1' => ['sku' => 'd-4', 'name' => 'No']]])->rowErrors)->toBe(['n1' => 'You cannot add rows here.']);

    ProductSheet::$deletable = false;
    expect(save(['deleted' => [$b->id]])->rowErrors)->toBe([(string) $b->id => 'You cannot delete this row.'])
        ->and(Product::query()->count())->toBe(2);
});

it('validates a new row over every editable column, defaults included', function () {
    $result = save(['created' => ['n1' => ['sku' => 'c-3'], 'n2' => ['sku' => 'c-3', 'name' => 'Dup', 'price' => 'x']]]);

    expect($result->errors['n1'])->toHaveKey('name')
        ->and($result->errors['n2'])->toBe(['price' => 'Not a number.'])
        ->and($result->rolledBack)->toBeTrue()
        ->and(Product::query()->count())->toBe(0);

    $ok = save(['created' => ['n1' => ['sku' => 'c-3', 'name' => 'Fine']]]);

    expect($ok->created['n1']['values']['stock'])->toBe(0)
        ->and(Product::query()->count())->toBe(1);
});

it('rejects every save on a read-only sheet', function () {
    $product = product('a-1');
    ProductSheet::$readOnly = true;

    expect(fn () => save(['changed' => [$product->id => ['name' => 'X']]]))->toThrow(SaveRejected::class, 'This sheet is read-only.')
        ->and($product->fresh()->name)->toBe('Product');
});

/* ------------------------------------------------------------------ conflicts */

it('refuses a row that changed since the user loaded it, with their value and the current version', function () {
    $product = product('a-1', 'Hammer', ['price' => 10]);
    $seen = $product->getAttributes()['updated_at'];

    CarbonImmutable::setTestNow('2026-10-14 10:05:00');
    Product::query()->whereKey($product->id)->update(['price' => 12, 'name' => 'Mallet', 'updated_at' => now()]);

    $result = save(['changed' => [$product->id => ['price' => '11']], 'versions' => [$product->id => $seen]]);

    expect($result->conflicts)->toBe([(string) $product->id => ['price' => 12.0]])
        ->and($result->versions[$product->id])->toBe('2026-10-14 10:05:00')
        ->and($result->rowErrors)->toBe([])
        ->and($result->rolledBack)->toBeTrue()
        ->and($product->fresh()->price)->toBe('12.00');

    // Saving again with the current version wins.
    $again = save(['changed' => [$product->id => ['price' => '11']], 'versions' => [$product->id => '2026-10-14 10:05:00']]);

    expect($again->ok())->toBeTrue()
        ->and($product->fresh()->price)->toBe('11.00');
});

it('skips the conflict check without a version from the browser, or when versionColumn(false)', function () {
    $product = product('a-1', 'Hammer', ['price' => 10]);
    $seen = $product->getAttributes()['updated_at'];

    CarbonImmutable::setTestNow('2026-10-14 10:05:00');
    $product->touch();

    expect(save(['changed' => [$product->id => ['price' => '11']]])->ok())->toBeTrue()
        ->and(sheet()->versionColumn(false)->save(SavePayload::fromArray(['changed' => [$product->id => ['price' => '12']], 'versions' => [$product->id => $seen]]))->ok())->toBeTrue()
        ->and(sheet()->versionColumn(false)->rows()['rows'][0]['version'])->toBeNull();
});

/* ------------------------------------------------------------------ transactions */

it('rolls the whole batch back on one bad row in AllOrNothing mode, every error reported', function () {
    Event::fake([RowsSaved::class, RowSaveFailed::class]);
    $a = product('a-1');
    $b = product('b-2');

    $result = save(['changed' => [$a->id => ['name' => 'Fine'], $b->id => ['price' => 'abc', 'stock' => '-1']], 'created' => ['n1' => ['sku' => 'c-3', 'name' => 'New']], 'deleted' => [$a->id]]);

    expect($result->rolledBack)->toBeTrue()
        ->and($result->message)->toBe('Nothing was saved: fix the marked cells and save again.')
        ->and($result->saved)->toBe([])
        ->and($result->created)->toBe([])
        ->and($result->deleted)->toBe([])
        ->and(keys($result->errors))->toBe([(string) $b->id])
        ->and($result->errors[$b->id]['price'])->toBe('Not a number.')
        ->and($result->errors[$b->id]['stock'])->toContain('at least 0')
        ->and($a->fresh()->name)->toBe('Product')
        ->and(Product::query()->count())->toBe(2)
        ->and(ProductSheet::$afterSave)->toBe([]);

    Event::assertNotDispatched(RowsSaved::class);
    Event::assertDispatchedTimes(RowSaveFailed::class, 1);
});

it('commits the good rows and reports the bad ones in PerRow mode', function () {
    Event::fake([RowsSaved::class, RowSaveFailed::class]);
    $a = product('a-1');
    $b = product('b-2');
    ProductSheet::$saveMode = SaveMode::PerRow;

    $result = save(['changed' => [$a->id => ['name' => 'Fine'], $b->id => ['price' => 'abc']], 'created' => ['n1' => ['sku' => 'c-3', 'name' => 'New'], 'n2' => ['sku' => '']]]);

    expect($result->rolledBack)->toBeFalse()
        ->and($result->message)->toBeNull()
        ->and(keys($result->saved))->toBe([(string) $a->id])
        ->and(keys($result->created))->toBe(['n1'])
        ->and($result->errors)->toHaveKeys([(string) $b->id, 'n2'])
        ->and($a->fresh()->name)->toBe('Fine')
        ->and(Product::query()->count())->toBe(3)
        ->and(ProductSheet::$afterSave)->toHaveCount(1)
        ->and(ProductSheet::$afterSave[0])->toHaveCount(2);

    Event::assertDispatched(RowsSaved::class, fn (RowsSaved $e) => $e->updated->modelKeys() === [$a->id] && $e->created->count() === 1 && $e->spreadsheet === ProductSheet::class);
    Event::assertDispatchedTimes(RowSaveFailed::class, 2);
});

it('answers a stale-row and a good row in the same PerRow batch each on its own', function () {
    $a = product('a-1', 'A', ['price' => 1]);
    $b = product('b-2', 'B', ['price' => 1]);
    $seenB = $b->getAttributes()['updated_at'];
    ProductSheet::$saveMode = SaveMode::PerRow;

    CarbonImmutable::setTestNow('2026-10-14 10:05:00');
    $b->touch();

    $result = save(['changed' => [$a->id => ['price' => '2'], $b->id => ['price' => '3']], 'versions' => [$a->id => $a->getAttributes()['updated_at'], $b->id => $seenB]]);

    expect(keys($result->saved))->toBe([(string) $a->id])
        ->and($result->conflicts)->toHaveKey((string) $b->id)
        ->and($a->fresh()->price)->toBe('2.00')
        ->and($b->fresh()->price)->toBe('1.00');
});

/* ------------------------------------------------------------------ hooks and events */

it('runs beforeSave first and lets it refuse the whole save with its message', function () {
    $product = product('a-1');
    ProductSheet::$rejectInBeforeSave = true;

    expect(fn () => save(['changed' => [$product->id => ['name' => 'X']]]))->toThrow(SaveRejected::class, 'Not today.')
        ->and(ProductSheet::$beforeSave)->toHaveCount(1)
        ->and(ProductSheet::$beforeSave[0]->changed)->toBe([(string) $product->id => ['name' => 'X']])
        ->and($product->fresh()->name)->toBe('Product');
});

it('rolls back when afterSave throws, letting the exception propagate for the caller to report', function (SaveMode $mode) {
    Event::fake([RowsSaved::class]);
    $a = product('a-1');
    $b = product('b-2');
    ProductSheet::$saveMode = $mode;
    ProductSheet::$failInAfterSave = true;

    // In PerRow mode the rows are written to savepoints inside the batch's transaction: an afterSave failure rolls them all back too.
    expect(fn () => save(['changed' => [$a->id => ['name' => 'X'], $b->id => ['name' => 'Y']], 'created' => ['n1' => ['sku' => 'c-3', 'name' => 'New']]]))->toThrow(RuntimeException::class, 'indexer down')
        ->and($a->fresh()->name)->toBe('Product')
        ->and($b->fresh()->name)->toBe('Product')
        ->and(Product::query()->count())->toBe(2);

    Event::assertNotDispatched(RowsSaved::class);
})->with([SaveMode::AllOrNothing, SaveMode::PerRow]);

it('fires RowsSaved once with the updated, created and deleted records', function () {
    Event::fake([RowsSaved::class]);
    $a = product('a-1');
    $b = product('b-2');

    save(['changed' => [$a->id => ['name' => 'X']], 'created' => ['n1' => ['sku' => 'c-3', 'name' => 'New']], 'deleted' => [$b->id]]);

    Event::assertDispatchedTimes(RowsSaved::class, 1);
    Event::assertDispatched(RowsSaved::class, fn (RowsSaved $e) => $e->updated->modelKeys() === [$a->id]
        && $e->created->first()->sku === 'C-3'
        && $e->deleted === [(string) $b->id]
        && $e->records()->count() === 2);
});

/* ------------------------------------------------------------------ the payload itself */

it('does nothing with an empty payload and refuses one with too many rows', function () {
    config()->set('packstub-spreadsheet.max_rows_per_save', 2);
    $a = product('a-1');
    $b = product('b-2');
    $c = product('c-3');

    expect(save([])->ok())->toBeTrue()
        ->and(save(['changed' => []])->saved)->toBe([])
        ->and(fn () => save(['changed' => [$a->id => ['name' => 'X'], $b->id => ['name' => 'Y'], $c->id => ['name' => 'Z']]]))->toThrow(SaveRejected::class, 'at most 2');
});

it('reads a crafted payload strictly: bad keys, shapes and temporary ids are dropped, never fatal', function () {
    $product = product('a-1');

    $payload = SavePayload::fromArray([
        'changed' => [
            $product->id => ['name' => 'Ok', '' => 'x', 0 => 'y'],
            '' => ['name' => 'no key'],
            "1\n2" => ['name' => 'control chars'],
            str_repeat('9', 200) => ['name' => 'too long'],
            $product->id.'x' => 'not an array',
        ],
        'versions' => [$product->id => ['nested'], 'other' => 3],
        'created' => ['n 1' => ['sku' => 'x'], 'n-1' => ['sku' => 'c-3', 'name' => 'New'], 'n2' => 'not an array'],
        'deleted' => [[1], null, '', 5, '5', 'abc'],
    ]);

    expect($payload->changed)->toBe([(string) $product->id => ['name' => 'Ok']])
        ->and($payload->versions)->toBe(['other' => '3'])
        ->and($payload->created)->toBe(['n-1' => ['sku' => 'c-3', 'name' => 'New']])
        ->and($payload->deleted)->toBe(['5', 'abc'])
        ->and($payload->rowCount())->toBe(4)
        ->and(SavePayload::fromArray(['changed' => 'x', 'created' => 3, 'deleted' => 'y', 'versions' => null])->isEmpty())->toBeTrue();

    $result = sheet()->saveMode(SaveMode::PerRow)->save($payload);

    expect($result->saved)->toHaveKey((string) $product->id)
        ->and($result->created)->toHaveKey('n-1')
        ->and($result->rowErrors)->toBe(['5' => 'This row is no longer in the sheet.', 'abc' => 'This row is no longer in the sheet.']);
});

it('refuses a row carrying far more cells than the sheet has columns with one reason, not an error per key', function () {
    Event::fake([RowSaveFailed::class]);
    $product = product('a-1');
    $values = ['name' => 'Ok'];

    foreach (range(1, 1000) as $i) {
        $values["<b>{$i}</b>"] = str_repeat('x', 100);
    }

    $result = save(['changed' => [$product->id => $values], 'created' => ['n1' => $values]]);

    expect($result->errors)->toBe([])
        ->and($result->rowErrors)->toBe([(string) $product->id => 'This row carries more cells than the sheet has columns.', 'n1' => 'This row carries more cells than the sheet has columns.'])
        ->and(strlen(json_encode($result->toArray())))->toBeLessThan(1000)
        ->and($product->fresh()->name)->toBe('Product');

    Event::assertDispatchedTimes(RowSaveFailed::class, 2);

    // A row with a few unknown keys still names each of them.
    $few = save(['changed' => [$product->id => ['name' => 'Ok', 'nope' => 1, 'nada' => 2]]]);

    expect(keys($few->errors[$product->id]))->toBe(['nope', 'nada']);
});

it('queries an integer key with integers only: a crafted key is answered as missing, never sent to the database', function () {
    $product = product('a-1');
    $crafted = ['abc', "1' or 1=1", '9x', '-1', '1.0'];
    DB::enableQueryLog();

    $result = sheet()->saveMode(SaveMode::PerRow)->save(SavePayload::fromArray([
        'changed' => array_fill_keys($crafted, ['name' => 'X']) + [$product->id => ['name' => 'Ok']],
        'deleted' => $crafted,
    ]));
    $bindings = collect(DB::getQueryLog())->flatMap(fn (array $q) => array_map(strval(...), $q['bindings']))->all();
    DB::disableQueryLog();

    expect(keys($result->saved))->toBe([(string) $product->id])
        ->and(keys($result->rowErrors))->toBe($crafted)
        ->and(array_unique($result->rowErrors))->toBe(['abc' => 'This row is no longer in the sheet.'])
        ->and(array_values(array_intersect($bindings, $crafted)))->toBe([])
        ->and($bindings)->toContain((string) $product->id);
});

it('deletes through the same checks with delete()', function () {
    $a = product('a-1');
    $b = product('b-2');
    ProductPolicy::$deletable = ['A-1'];

    $result = sheet()->saveMode(SaveMode::PerRow)->delete([(string) $a->id, (string) $b->id]);

    expect($result->deleted)->toBe([(string) $a->id])
        ->and($result->rowErrors)->toHaveKey((string) $b->id)
        ->and(Product::query()->pluck('sku')->all())->toBe(['B-2']);
});

it('reports a database failure on one row in PerRow mode and keeps the others', function () {
    Exceptions::fake();
    $a = product('a-1');
    $b = product('b-2');
    ProductSheet::$saveMode = SaveMode::PerRow;

    // A column the sheet writes but the schema refuses: sqlite enforces the SKU's unique index below the validator's radar.
    $definition = sheet()->mutateRowBeforeSave(fn (array $data, ?Product $record) => $record?->is($b) ? ['sku' => 'A-1'] : $data);
    $result = $definition->save(SavePayload::fromArray(['changed' => [$a->id => ['name' => 'Fine'], $b->id => ['name' => 'Boom']]]));

    expect(keys($result->saved))->toBe([(string) $a->id])
        ->and($result->rowErrors)->toBe([(string) $b->id => 'This row could not be saved.'])
        ->and($b->fresh()->name)->toBe('Product');

    Exceptions::assertReported(fn (UniqueConstraintViolationException $e) => str_contains($e->getMessage(), 'UNIQUE'));
});
