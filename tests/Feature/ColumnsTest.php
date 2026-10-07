<?php

use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Unique;
use Packstub\Spreadsheet\Columns\BooleanColumn;
use Packstub\Spreadsheet\Columns\ComputedColumn;
use Packstub\Spreadsheet\Columns\DateColumn;
use Packstub\Spreadsheet\Columns\DateTimeColumn;
use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\SelectColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Exceptions\InvalidValue;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\Status;

it('reads numbers the way a paste from any locale writes them', function () {
    expect(NumberColumn::parse('1 234,50'))->toBe(1234.5)
        ->and(NumberColumn::parse('1,234.50'))->toBe(1234.5)
        ->and(NumberColumn::parse('1.234,50'))->toBe(1234.5)
        ->and(NumberColumn::parse("1\u{00A0}234"))->toBe(1234)
        ->and(NumberColumn::parse("1'234.5"))->toBe(1234.5)
        ->and(NumberColumn::parse('1,234'))->toBe(1234)
        ->and(NumberColumn::parse('1,234,567'))->toBe(1234567)
        ->and(NumberColumn::parse('0,5'))->toBe(0.5)
        ->and(NumberColumn::parse('12,50'))->toBe(12.5)
        ->and(NumberColumn::parse('-3'))->toBe(-3)
        ->and(NumberColumn::parse('1e3'))->toBe(1000.0)
        ->and(NumberColumn::parse('12.'))->toBe(12.0)
        ->and(NumberColumn::parse(''))->toBeNull()
        ->and(NumberColumn::parse('abc'))->toBeNull()
        ->and(NumberColumn::parse('1.2.3'))->toBeNull()
        ->and(NumberColumn::parse('0x1A'))->toBeNull();
});

it('rounds to the column\'s decimals and refuses fractions on an integer column', function () {
    $price = NumberColumn::make('price')->decimals(2);
    $stock = NumberColumn::make('stock')->integer();

    expect($price->coerce('12.345'))->toBe(12.35)
        ->and($price->coerce('1.005'))->toBe(1.01)
        ->and($price->coerce('-0.125'))->toBe(-0.13)
        ->and($price->coerce(-2.675))->toBe(-2.68)
        ->and($price->coerce(12))->toBe(12.0)
        ->and($price->coerce(true))->toBe(1.0)
        ->and($price->presentValue('12.50'))->toBe(12.5)
        ->and($stock->coerce('7'))->toBe(7)
        ->and($stock->coerce(7.0))->toBe(7)
        ->and($stock->presentValue('7'))->toBe(7)
        ->and(fn () => $stock->coerce('7.5'))->toThrow(InvalidValue::class, 'Not a whole number.')
        ->and($stock->coerce('9007199254740991'))->toBe(9007199254740991)
        ->and(fn () => $stock->coerce('9007199254740992'))->toThrow(InvalidValue::class, 'Too large a whole number.')
        ->and(fn () => $stock->coerce(1e20))->toThrow(InvalidValue::class, 'Too large a whole number.')
        ->and(fn () => $stock->coerce('-1e19'))->toThrow(InvalidValue::class, 'Too large a whole number.')
        ->and(fn () => $stock->coerce('99999999999999999999'))->toThrow(InvalidValue::class, 'Too large a whole number.')
        ->and(fn () => $price->coerce('INF'))->toThrow(InvalidValue::class)
        ->and(fn () => $price->coerce([1]))->toThrow(InvalidValue::class, 'This value cannot be read.')
        ->and($price->toArray())->toMatchArray(['type' => 'number', 'decimals' => 2, 'integer' => false, 'label' => 'Price']);
});

it('reads booleans in the words a paste brings', function () {
    $column = BooleanColumn::make('is_active');

    expect($column->coerce('Yes'))->toBeTrue()
        ->and($column->coerce(' on '))->toBeTrue()
        ->and($column->coerce('да'))->toBeTrue()
        ->and($column->coerce('N'))->toBeFalse()
        ->and($column->coerce(0))->toBeFalse()
        ->and($column->coerce(2))->toBeTrue()
        ->and($column->coerce(false))->toBeFalse()
        ->and($column->coerce(null))->toBeNull()
        ->and($column->presentValue('1'))->toBeTrue()
        ->and($column->presentValue(0))->toBeFalse()
        ->and(fn () => $column->coerce('perhaps'))->toThrow(InvalidValue::class, 'Not a yes/no value.');
});

it('reads dates strictly and presents casts as ISO', function () {
    $date = DateColumn::make('available_on');
    $moment = DateTimeColumn::make('published_at');

    expect($date->coerce('2026-02-28'))->toBe('2026-02-28')
        ->and($date->coerce('2026-02-28T10:00:00Z'))->toBe('2026-02-28')
        ->and($date->coerce('2026-02-28 10:00:00.123+02:00'))->toBe('2026-02-28')
        ->and($date->presentValue(new DateTimeImmutable('2026-02-28 10:00')))->toBe('2026-02-28')
        ->and($date->presentValue('2026-02-28 10:00:00'))->toBe('2026-02-28')
        ->and($moment->coerce('2026-02-28 10:05'))->toBe('2026-02-28 10:05:00')
        ->and($moment->coerce('2026-02-28T10:05:09'))->toBe('2026-02-28 10:05:09')
        ->and($moment->coerce('2026-02-28'))->toBe('2026-02-28 00:00:00')
        ->and($moment->presentValue(new DateTimeImmutable('2026-02-28 10:00')))->toBe('2026-02-28 10:00:00')
        ->and($moment->presentValue('2026-02-28T10:00'))->toBe('2026-02-28 10:00:00')
        ->and($moment->coerce(null))->toBeNull()
        ->and($moment->toArray()['format'])->toBe('Y-m-d H:i');

    foreach (['2026-02-30', '0999-01-01', '28/02/2026', 'tomorrow', '2026-1-5'] as $bad) {
        expect(fn () => $date->coerce($bad))->toThrow(InvalidValue::class, 'Not a date');
    }

    foreach (['2026-02-28 24:00', '2026-02-28 10:60', '2026-02-28T10:00:00Z'] as $bad) {
        expect(fn () => $moment->coerce($bad))->toThrow(InvalidValue::class, 'Not a date and time');
    }
});

it('takes options from an array, a closure, an enum or a relation, keys as strings, and refuses others', function () {
    category('Tools');
    category('Old', active: false);

    $array = SelectColumn::make('size')->options([1 => 'Small', 2 => 'Large']);
    $closure = SelectColumn::make('size')->options(fn () => ['s' => 'Small']);
    $enum = SelectColumn::make('status')->options(Status::class);
    $relation = SelectColumn::make('category_id')->relationship('category', 'name', fn ($q) => $q->where('is_active', true));

    expect($array->getOptions())->toBe(['1' => 'Small', '2' => 'Large'])
        ->and($array->coerce(2))->toBe('2')
        ->and($array->coerce(true))->toBe('1')
        ->and($closure->getOptions())->toBe(['s' => 'Small'])
        ->and($enum->getOptions())->toBe(['draft' => 'Draft', 'live' => 'Live', 'retired' => 'Retired'])
        ->and($enum->presentValue(Status::Live))->toBe('live')
        ->and($relation->getOptions())->toBe([])
        ->and($relation->getOptions(new Product))->toBe(['1' => 'Tools'])
        ->and($relation->coerce('1'))->toBe('1')
        ->and(fn () => $relation->coerce('2'))->toThrow(InvalidValue::class, 'Not one of the options.')
        ->and(fn () => $array->coerce('3'))->toThrow(InvalidValue::class);
});

it('adds the record to a unique rule, as a string or a Rule object, and leaves other rules alone', function () {
    $record = product('a-1');
    $column = TextColumn::make('sku')->rules(['required', 'unique:products,sku', 'unique:products', Rule::unique('products', 'sku'), 'max:32'])->maxLength(16);

    $rules = $column->getRules($record);

    expect($rules[0])->toBe('required')
        ->and($rules[1])->toBe("unique:products,sku,{$record->id},id")
        ->and($rules[2])->toBe("unique:products,NULL,{$record->id},id")
        ->and($rules[3])->toBeInstanceOf(Unique::class)
        ->and((string) $rules[3])->toContain("{$record->id}")
        ->and($rules[4])->toBe('max:32')
        // `nullable` sits between the column's rules and the type's: a cleared cell passes the type rules, a `required` one still fails.
        ->and(array_slice($rules, 5))->toBe(['nullable', 'string', 'max:16'])
        ->and($column->getRules(null)[1])->toBe('unique:products,sku')
        ->and(TextColumn::make('name')->rules('required|min:2')->getRules(null))->toBe(['required', 'min:2', 'nullable', 'string'])
        ->and(TextColumn::make('name')->rules(fn (?Product $p) => $p ? ['max:5'] : ['max:9'])->getRules($record))->toBe(['max:5', 'nullable', 'string']);
});

it('labels columns from their name, reads a computed state and marks it read-only', function () {
    $product = product('a-1', 'Hammer', ['price' => 10, 'cost' => 4]);
    $margin = ComputedColumn::make('margin')->state(fn (Product $p) => $p->price - $p->cost);

    expect(TextColumn::make('category_id')->getLabel())->toBe('Category')
        ->and(TextColumn::make('published_at')->getLabel())->toBe('Published')
        ->and(TextColumn::make('name')->label(fn () => 'Title')->getLabel())->toBe('Title')
        ->and($margin->present($product))->toBe(6.0)
        ->and($margin->isEditable())->toBeFalse()
        ->and($margin->isReadOnlyFor($product))->toBeTrue()
        ->and($margin->sortable()->isSortable())->toBeFalse()
        ->and(ComputedColumn::make('name')->present($product))->toBe('Hammer')
        ->and(TextColumn::make('name')->readOnly(fn (Product $p) => $p->price > 5)->isReadOnlyFor($product))->toBeTrue()
        ->and(TextColumn::make('name')->width(10)->getWidth())->toBe(40)
        ->and(TextColumn::make('name')->default(fn () => 'x')->getDefault())->toBe('x')
        ->and(TextColumn::make('name')->coerce(true))->toBe('1');
});

it('reads a dotted name through the relation and never writes it', function () {
    $tools = category('Tools');
    $product = product('a-1', 'Hammer', ['category_id' => $tools->id]);
    $column = TextColumn::make('category.name');

    expect($column->present($product))->toBe('Tools')
        ->and($column->isEditable())->toBeFalse()
        ->and($column->isSortable())->toBeFalse()
        ->and($column->getLabel())->toBe('Category.name')
        ->and(ComputedColumn::make('category.name')->present($product))->toBe('Tools')
        ->and(save(['changed' => [$product->id => ['category.name' => 'X']]])->errors[$product->id])->toBe(['category.name' => 'This cell cannot be edited.']);
});
