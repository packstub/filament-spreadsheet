<?php

use Packstub\Spreadsheet\Columns\ComputedColumn;
use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Formula;
use Packstub\Spreadsheet\SavePayload;
use Packstub\Spreadsheet\Spreadsheet;
use Packstub\Spreadsheet\Tests\Fixtures\Product;

/** A sheet of products with formula columns. @param  list<\Packstub\Spreadsheet\Columns\Column>  $formulas */
function formulaSheet(array $formulas): Spreadsheet
{
    return Spreadsheet::make()
        ->query(fn () => Product::query())
        ->versionColumn(false)
        ->authorizeUpdate(fn () => true)
        ->columns([
            TextColumn::make('name'),
            NumberColumn::make('price')->decimals(2),
            NumberColumn::make('cost')->decimals(2),
            NumberColumn::make('stock')->integer(),
            TextColumn::make('notes')->hidden(),
            ...$formulas,
        ]);
}

it('computes every case of the shared fixture as the browser does', function () {
    $fixture = json_decode(file_get_contents(__DIR__.'/../js/formulas.json'), true);

    expect($fixture['cases'])->not->toBeEmpty();

    foreach ($fixture['cases'] as $case) {
        $formula = Formula::parse($case['source']);

        expect($formula->toArray())->toBe($case['tree'], $case['source'])
            ->and($formula->evaluate(fn (string $name) => $fixture['row'][$name] ?? null))->toBe($case['value'], $case['source']);
    }
});

it('refuses a formula it cannot read, saying where', function (string $source, string $message) {
    expect(fn () => Formula::parse($source))->toThrow(InvalidArgumentException::class, $message);
})->with([
    ['price *', 'unexpected the end at position 8'],
    ['price * (stock', 'expected ")", found the end'],
    ["name & 'open", 'a text is not closed at position 8'],
    ['price $ 2', 'unexpected "$" at position 7'],
    ['sqrt(price)', 'unknown function "sqrt" at position 1'],
    ['round()', 'round() takes 1 to 2 argument(s), 0 given'],
    ['if(stock)', 'if() takes 2 to 3 argument(s), 1 given'],
    ['not(1, 2)', 'not() takes 1 argument(s), 2 given'],
    ['price stock', 'unexpected "stock"'],
    ['1 < 2 < 3', 'unexpected "<"'],
    ['', 'unexpected the end at position 1'],
    ['price * 1e400', 'a number too large at position 9'],
]);

it('lists what a formula reads', function () {
    expect(Formula::parse("if(stock < min, coalesce(category.name, 'x'), -price * 2)")->references())
        ->toBe(['stock', 'min', 'category.name', 'price']);
});

it('sends the tree and the decimals to the browser', function () {
    expect(ComputedColumn::make('value')->formula('price * stock')->decimals(2)->toArray())->toMatchArray([
        'type' => 'computed',
        'editable' => false,
        'formula' => ['op', '*', ['ref', 'price'], ['ref', 'stock']],
        'decimals' => 2,
    ])
        ->and(ComputedColumn::make('margin')->toArray())->toMatchArray(['formula' => null, 'decimals' => null]);
});

it('presents a formula over the row\'s values after casts, a formula read by another computed first', function () {
    product('a-1', 'Lamp', ['price' => '12.50', 'cost' => '8.25', 'stock' => 3]);

    $row = formulaSheet([
        ComputedColumn::make('margin_pct')->formula('round(margin / price * 100, 1)'),
        ComputedColumn::make('margin')->formula('price - cost'),
        ComputedColumn::make('value')->formula('price * stock')->decimals(1),
        ComputedColumn::make('label')->formula("name & ' × ' & stock"),
        ComputedColumn::make('low')->formula('stock < 5'),
    ])->rows()['rows'][0];

    expect($row['values'])->toMatchArray([
        'margin' => 4.25,
        'margin_pct' => 34.0,
        'value' => 37.5,
        'label' => 'Lamp × 3',
        'low' => true,
    ]);
});

it('rounds a state() value to its decimals too', function () {
    product('a-1', 'Lamp', ['price' => '10', 'cost' => '3']);

    $row = formulaSheet([ComputedColumn::make('ratio')->state(fn (Product $p) => $p->price / $p->cost)->decimals(2)])->rows()['rows'][0];

    expect($row['values']['ratio'])->toBe(3.33);
});

it('answers a save with the formulas computed from the saved values', function () {
    $product = product('a-1', 'Lamp', ['price' => '10', 'stock' => 2]);

    $result = formulaSheet([ComputedColumn::make('value')->formula('price * stock')])
        ->save(SavePayload::fromArray(['changed' => [$product->id => ['stock' => '5']]]))
        ->toArray();

    expect(((array) $result['saved'])[(string) $product->id]['values']['value'])->toBe(50.0);
});

it('refuses a formula that reads a name that is not a column of the sheet, or reads itself', function (array $formulas, string $message) {
    product('a-1');

    expect(fn () => formulaSheet($formulas)->rows())->toThrow(LogicException::class, $message);
})->with([
    'unknown' => [[ComputedColumn::make('x')->formula('price * qty')], 'ComputedColumn [x]: the formula reads [qty], which is not a column of the sheet'],
    'hidden' => [[ComputedColumn::make('x')->formula("notes & ''")], 'reads [notes]'],
    'itself' => [[ComputedColumn::make('x')->formula('x + 1')], 'ComputedColumn [x]: the formula reads itself (x → x).'],
    'a loop' => [[ComputedColumn::make('a')->formula('b + 1'), ComputedColumn::make('b')->formula('a * 2')], 'the formula reads itself (a → b → a).'],
]);
