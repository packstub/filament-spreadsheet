<?php

use Livewire\Livewire;
use Packstub\Spreadsheet\SavePayload;
use Packstub\Spreadsheet\SaveResult;
use Packstub\Spreadsheet\Spreadsheet;
use Packstub\Spreadsheet\Tests\Fixtures\Category;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;
use Packstub\Spreadsheet\Tests\Fixtures\User;
use Packstub\Spreadsheet\Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature');

/** @param  array<string, mixed>  $attributes */
function product(string $sku, string $name = 'Product', array $attributes = []): Product
{
    return Product::query()->create(['sku' => $sku, 'name' => $name, ...$attributes]);
}

function category(string $name, bool $active = true): Category
{
    return Category::query()->create(['name' => $name, 'is_active' => $active]);
}

function user(): User
{
    return User::query()->create(['name' => 'Ana', 'email' => 'ana@example.test', 'password' => 'secret']);
}

/** The ProductSheet fixture's definition, as the component builds it. */
function sheet(): Spreadsheet
{
    return Livewire::test(ProductSheet::class)->instance()->getSpreadsheet();
}

/** One Save on the fixture's sheet. @param  array<string, mixed>  $payload */
function save(array $payload): SaveResult
{
    return sheet()->save(SavePayload::fromArray($payload));
}

/**
 * The keys of an answer as the browser sees them: strings (PHP turns a numeric
 * string key into an int, JSON does not).
 *
 * @return list<string>
 */
function keys(array $answer): array
{
    return array_map(strval(...), array_keys($answer));
}
