<?php

// Writes tests/js/formulas.json: each case's tree (as the server parses it) and its value
// (as the server computes it). FormulaTest checks the server still parses and computes every
// case so; sheet.test.mjs checks the browser computes the same values from the same trees.
// Run after adding or changing a case:
//   php tests/js/formulas.php

require __DIR__.'/../../vendor/autoload.php';

use Packstub\Spreadsheet\Formula;

$row = ['price' => 12.5, 'cost' => 8.25, 'stock' => 4, 'empty' => null, 'blank' => '', 'name' => 'Desk lamp',
    'sku' => 'LMP-1', 'qty' => '3', 'is_active' => true, 'available_on' => '2026-02-28', 'category.name' => 'Lighting', 'zero' => 0,
    'spaced' => "\u{00A0}5\u{00A0}", 'big' => 1.2345678901234568e20];

$cases = [
    'price * stock', 'price - cost', '(price - cost) / price * 100', 'round((price - cost) / price * 100, 1)',
    '-price + 1', '--stock', '+stock', '2 + 3 * 4', '(2 + 3) * 4', '10 % 3', '-7 % 3', '1 / 3', '0.1 + 0.2', '1e3 + .5',
    'price * empty', 'price + blank', 'name * 2', 'qty * 2', 'price / zero', 'price % zero', '-zero', 'zero * -1',
    'coalesce(empty, 0) + stock', 'coalesce(blank, empty, name)', 'coalesce(empty)',
    'sum(price, empty, stock, name)', 'sum(empty)', 'min(price, cost, empty)', 'max(empty, blank)', 'max(stock, qty)',
    'round(2.5)', 'round(-2.5)', 'round(1.005, 2)', 'round(1234.5, -2)', 'round(price, 1.9)', 'round(empty)', 'floor(-1.5)', 'ceil(1.2)', 'abs(cost - price)',
    "if(stock < 5, 'low', 'ok')", "if(stock >= 5, 'ok')", 'if(empty, 1, 2)', 'if(blank, 1, 2)', "if('0', 1, 2)", 'if(zero, 1, 2)',
    'and(is_active, stock > 0)', 'or(empty, zero, blank)', 'not(is_active)',
    'stock = 4', 'stock == 4.0', "qty = '3.0'", 'stock != 4', 'stock <> 5', 'price > cost', 'price <= cost',
    "name = 'Desk lamp'", "name < 'Fan'", "available_on < '2026-03-01'", 'is_active = true', 'is_active = 1',
    'empty = null', 'empty = blank', 'empty != 0', 'empty < 1', 'zero = empty',
    "name & ' (' & sku & ')'", "price & ''", "stock & 'x'", "0.1 + 0.2 & ''", "is_active & ''", "empty & 'x'", "1 / 4 & ''",
    'category.name', "category.name & '!'", "\"double\" & 'single'", 'TRUE', 'Null', 'IF(stock > 1, 1, 0)',
    "''", 'blank', 'stock', 'is_active',
    'round(-1.005, 2)', 'round(2.675, 2)', 'round(1.45, 1)', 'round(-0.125, 2)', 'round(8.345, 2)', 'round(123456789.125, 2)',
    'round(100000000000000.5)', 'round(price, 1e30)', 'round(price, -1e30)', 'round(-0.4)',
    'spaced + 1', "spaced = '5'", "1e21 & ''", "1e-7 & ''", "big & ''", "0.000001 & ''", "-0 & ''", "100 & ''",
    "'～' < '😀'", "'é' > 'z'", "'B' < 'a'",
];

$out = [];
foreach ($cases as $source) {
    $formula = Formula::parse($source);
    $out[] = ['source' => $source, 'tree' => $formula->toArray(), 'value' => $formula->evaluate(fn (string $name) => $row[$name] ?? null)];
}

file_put_contents(__DIR__.'/formulas.json', json_encode(['row' => $row, 'cases' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION)."\n");
