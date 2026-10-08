<?php

namespace Packstub\Spreadsheet;

use Closure;
use InvalidArgumentException;

/**
 * A row formula: `price * stock`, `round((price - cost) / price * 100, 1)`,
 * `if(stock < 5, 'low', 'ok')`. Parsed once into a tree of plain arrays; the
 * server evaluates the tree on every row it sends, the browser (sheet.js
 * `evaluateFormula()`) evaluates the same tree over the unsaved values, so a
 * computed cell follows an edit before Save. The two evaluators are mirrors:
 * every number is a float, every rule below holds on both sides.
 *
 * - Names are the sheet's columns (a dotted one too: `category.name`).
 * - Literals: numbers, 'text' or "text", true, false, null.
 * - Operators, loosest first: = == != <> < <= > >=, & (joins text), + -, * / %, unary -.
 * - Functions: if(cond, then[, else]), and(…), or(…), not(x), round(x[, digits]),
 *   floor(x), ceil(x), abs(x), min(…), max(…), sum(…), coalesce(…).
 *
 * An empty cell is null and arithmetic with it is null (`coalesce(stock, 0)` reads
 * it as zero; sum(), min() and max() skip it); so is text that is not a number,
 * a division by zero and anything not finite.
 */
final class Formula
{
    private const FUNCTIONS = [
        'if' => [2, 3], 'and' => [1, null], 'or' => [1, null], 'not' => [1, 1],
        'round' => [1, 2], 'floor' => [1, 1], 'ceil' => [1, 1], 'abs' => [1, 1],
        'min' => [1, null], 'max' => [1, null], 'sum' => [1, null], 'coalesce' => [1, null],
    ];

    /** @var list<array{0: string, 1: mixed}> */
    private array $tokens = [];

    private int $at = 0;

    /** @param  array<int, mixed>  $tree */
    private function __construct(private readonly string $source, private array $tree = []) {}

    /** @throws InvalidArgumentException on a formula that cannot be read */
    public static function parse(string $source): self
    {
        $formula = new self($source);
        $formula->tokens = $formula->tokenize();
        $formula->tree = $formula->comparison();

        if ($formula->peek()[0] !== 'end') {
            $formula->fail('unexpected '.$formula->describe($formula->peek()));
        }

        $formula->tokens = [];

        return $formula;
    }

    public function getSource(): string
    {
        return $this->source;
    }

    /**
     * The tree the browser evaluates: ['num', 1.5], ['str', 'a'], ['lit', true|false|null],
     * ['ref', 'price'], ['neg', x], ['op', '+', a, b], ['call', 'round', [args]].
     *
     * @return array<int, mixed>
     */
    public function toArray(): array
    {
        return $this->tree;
    }

    /**
     * The names the formula reads.
     *
     * @return list<string>
     */
    public function references(): array
    {
        $names = [];
        $walk = function (array $node) use (&$walk, &$names): void {
            match ($node[0]) {
                'ref' => $names[$node[1]] = true,
                'neg' => $walk($node[1]),
                'op' => [$walk($node[2]), $walk($node[3])],
                'call' => array_map($walk, $node[2]),
                default => null,
            };
        };
        $walk($this->tree);

        return array_keys($names);
    }

    /** @param  Closure(string): mixed  $value  a name's value */
    public function evaluate(Closure $value): mixed
    {
        return self::finish($this->eval($this->tree, $value));
    }

    /* ------------------------------------------------------------------ the rules (mirrored in sheet.js) */

    /** A value as a number: null for an empty cell and for text that is not a number. */
    public static function number(mixed $v): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }

        if (is_bool($v)) {
            return $v ? 1.0 : 0.0;
        }

        if (is_int($v) || is_float($v)) {
            return is_finite((float) $v) ? (float) $v : null;
        }

        if (is_string($v) && preg_match('/^[ \t\n\r]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[ \t\n\r]*$/', $v) === 1) {
            $n = (float) trim($v, " \t\n\r");

            return is_finite($n) ? $n : null;
        }

        return null;
    }

    /** Round half away from zero, the same arithmetic as the browser's. */
    public static function round(float $x, int $digits = 0): float
    {
        $digits = max(-12, min(12, $digits));
        $f = (float) (10 ** abs($digits));
        $sign = $x < 0 ? -1.0 : 1.0;
        $scaled = self::significant($digits >= 0 ? abs($x) * $f : abs($x) / $f);
        // From 2^52 on every double is whole, and + 0.5 would round to even (2^53 - 1 becoming 2^53).
        $whole = $scaled >= 4503599627370496.0 ? $scaled : floor($scaled + 0.5);
        $r = $digits >= 0 ? $whole / $f : $whole * $f;

        return $r === 0.0 ? 0.0 : $sign * $r;
    }

    /**
     * A scaled value cut to 15 significant digits, as a spreadsheet reads it: 1.005 * 100 is
     * 100.49999999999999 in binary and 100.5 here, so round(1.005, 2) is 1.01. Below 1e14 only: there a
     * tie at the 15th digit can no longer move the value across .5, and the browser's toExponential()
     * (ties up) and PHP's %e (ties to even) give the same answer. `%e`, not `%g`: `%g` follows the locale.
     */
    private static function significant(float $scaled): float
    {
        return $scaled < 1e14 ? (float) sprintf('%.14e', $scaled) : $scaled;
    }

    private static function text(mixed $v): string
    {
        return match (true) {
            $v === null => '',
            is_bool($v) => $v ? 'true' : 'false',
            is_float($v) => self::numberText($v),
            default => (string) $v,
        };
    }

    /**
     * A number as JavaScript's String() writes it (ECMAScript Number::toString): the shortest digits that
     * read back as the same float, plain from 1e-7 up to 1e21 ("0.000001", "123456789012345680000"),
     * with an exponent outside ("1e-7", "1.5e+21"). `%e` gives the digits: it does not follow the locale.
     */
    private static function numberText(float $v): string
    {
        if ($v === 0.0) {
            return '0';
        }

        $sign = $v < 0 ? '-' : '';
        $a = abs($v);

        for ($p = 0; $p < 16; $p++) {
            if ((float) sprintf('%.'.$p.'e', $a) === $a) {
                break;
            }
        }

        [$mantissa, $exponent] = explode('e', sprintf('%.'.$p.'e', $a));
        $digits = rtrim(str_replace('.', '', $mantissa), '0');
        $k = strlen($digits);
        $n = (int) $exponent + 1;

        return $sign.match (true) {
            $k <= $n && $n <= 21 => $digits.str_repeat('0', $n - $k),
            $n > 0 && $n <= 21 => substr($digits, 0, $n).'.'.substr($digits, $n),
            $n > -6 && $n <= 0 => '0.'.str_repeat('0', -$n).$digits,
            default => ($k === 1 ? $digits : $digits[0].'.'.substr($digits, 1)).'e'.($n - 1 >= 0 ? '+' : '-').abs($n - 1),
        };
    }

    private static function utf16(string $text): string
    {
        return (string) mb_convert_encoding($text, 'UTF-16BE', 'UTF-8');
    }

    private static function truthy(mixed $v): bool
    {
        return match (true) {
            $v === null => false,
            is_bool($v) => $v,
            is_int($v), is_float($v) => $v != 0,
            default => (string) $v !== '',
        };
    }

    private static function finish(mixed $v): mixed
    {
        if (is_int($v)) {
            return (float) $v;
        }

        if (is_float($v)) {
            return is_finite($v) ? ($v === 0.0 ? 0.0 : $v) : null;
        }

        return $v === '' ? null : $v;
    }

    private static function compare(string $op, mixed $a, mixed $b): bool
    {
        $a = $a === '' ? null : $a;
        $b = $b === '' ? null : $b;

        if ($a === null || $b === null) {
            $same = $a === $b;

            return match ($op) {
                '=' => $same,
                '!=' => ! $same,
                default => false,
            };
        }

        $na = self::number($a);
        $nb = self::number($b);
        // Text by UTF-16 code unit, as the browser's < does (UTF-8 bytes order U+FF5E after U+1F600, UTF-16 before).
        $c = ($na !== null && $nb !== null) ? $na <=> $nb : strcmp(self::utf16(self::text($a)), self::utf16(self::text($b))) <=> 0;

        return match ($op) {
            '=' => $c === 0, '!=' => $c !== 0, '<' => $c < 0, '<=' => $c <= 0, '>' => $c > 0, '>=' => $c >= 0,
        };
    }

    /** @param  array<int, mixed>  $node */
    private function eval(array $node, Closure $value): mixed
    {
        switch ($node[0]) {
            case 'num':
            case 'str':
            case 'lit':
                return $node[1];
            case 'ref':
                $v = $value($node[1]);

                return $v instanceof \BackedEnum ? $v->value : $v;
            case 'neg':
                $x = self::number($this->eval($node[1], $value));

                return $x === null ? null : 0.0 - $x;
            case 'op':
                $op = $node[1];
                $a = $this->eval($node[2], $value);
                $b = $this->eval($node[3], $value);

                if ($op === '&') {
                    return self::text(self::finish($a)).self::text(self::finish($b));
                }

                if (in_array($op, ['=', '!=', '<', '<=', '>', '>='], true)) {
                    return self::compare($op, $a, $b);
                }

                $a = self::number($a);
                $b = self::number($b);

                if ($a === null || $b === null || (($op === '/' || $op === '%') && $b == 0)) {
                    return null;
                }

                $r = match ($op) {
                    '+' => $a + $b, '-' => $a - $b, '*' => $a * $b, '/' => $a / $b, '%' => fmod($a, $b),
                };

                return is_finite($r) ? $r : null;
            case 'call':
                return $this->call($node[1], $node[2], $value);
        }

        return null;
    }

    /** @param  list<array<int, mixed>>  $args */
    private function call(string $name, array $args, Closure $value): mixed
    {
        $arg = fn (int $i) => isset($args[$i]) ? $this->eval($args[$i], $value) : null;
        $numbers = function () use ($args, $value): array {
            $out = [];
            foreach ($args as $a) {
                $n = self::number($this->eval($a, $value));
                if ($n !== null) {
                    $out[] = $n;
                }
            }

            return $out;
        };

        switch ($name) {
            case 'if':
                return self::truthy($arg(0)) ? $arg(1) : $arg(2);
            case 'and':
                foreach ($args as $i => $_) {
                    if (! self::truthy($arg($i))) {
                        return false;
                    }
                }

                return true;
            case 'or':
                foreach ($args as $i => $_) {
                    if (self::truthy($arg($i))) {
                        return true;
                    }
                }

                return false;
            case 'not':
                return ! self::truthy($arg(0));
            case 'coalesce':
                foreach ($args as $i => $_) {
                    $v = $arg($i);
                    if ($v !== null && $v !== '') {
                        return $v;
                    }
                }

                return null;
            case 'sum':
                return array_reduce($numbers(), fn (float $carry, float $n) => $carry + $n, 0.0);
            case 'min':
            case 'max':
                $list = $numbers();

                return $list === [] ? null : array_reduce($list, fn (?float $carry, float $n) => $carry === null ? $n : ($name === 'min' ? ($n < $carry ? $n : $carry) : ($n > $carry ? $n : $carry)));
        }

        $x = self::number($arg(0));

        if ($x === null) {
            return null;
        }

        return match ($name) {
            'round' => self::round($x, (int) max(-12.0, min(12.0, self::number(isset($args[1]) ? $arg(1) : 0.0) ?? 0.0))),
            'floor' => floor($x),
            'ceil' => ceil($x),
            'abs' => abs($x),
        };
    }

    /* ------------------------------------------------------------------ parsing */

    /** @return list<array{0: string, 1: mixed, 2: int}> */
    private function tokenize(): array
    {
        $tokens = [];
        $src = $this->source;
        $i = 0;
        $n = strlen($src);

        while ($i < $n) {
            $c = $src[$i];

            if (ctype_space($c)) {
                $i++;

                continue;
            }

            if (preg_match('/\G(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/', $src, $m, 0, $i) === 1) {
                // 1e400 reads as INF, which JSON cannot carry to the browser.
                if (! is_finite((float) $m[0])) {
                    $this->fail('a number too large', $i);
                }

                $tokens[] = ['num', (float) $m[0], $i];
                $i += strlen($m[0]);

                continue;
            }

            if (preg_match('/\G[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/', $src, $m, 0, $i) === 1) {
                $tokens[] = ['name', $m[0], $i];
                $i += strlen($m[0]);

                continue;
            }

            if ($c === "'" || $c === '"') {
                $end = strpos($src, $c, $i + 1);
                if ($end === false) {
                    $this->fail('a text is not closed', $i);
                }
                $tokens[] = ['str', substr($src, $i + 1, $end - $i - 1), $i];
                $i = $end + 1;

                continue;
            }

            foreach (['<=', '>=', '!=', '<>', '==', '=', '<', '>', '+', '-', '*', '/', '%', '&', '(', ')', ','] as $op) {
                if (substr_compare($src, $op, $i, strlen($op)) === 0) {
                    $tokens[] = ['op', ['<>' => '!=', '==' => '='][$op] ?? $op, $i];
                    $i += strlen($op);

                    continue 2;
                }
            }

            $this->fail("unexpected \"{$c}\"", $i);
        }

        $tokens[] = ['end', null, $n];

        return $tokens;
    }

    /** @return array{0: string, 1: mixed, 2: int} */
    private function peek(): array
    {
        return $this->tokens[$this->at];
    }

    private function accept(string ...$ops): ?string
    {
        $t = $this->peek();

        if ($t[0] === 'op' && in_array($t[1], $ops, true)) {
            $this->at++;

            return $t[1];
        }

        return null;
    }

    private function expect(string $op): void
    {
        if ($this->accept($op) === null) {
            $this->fail("expected \"{$op}\", found ".$this->describe($this->peek()));
        }
    }

    /** @return array<int, mixed> */
    private function comparison(): array
    {
        $left = $this->concat();

        if (($op = $this->accept('=', '!=', '<', '<=', '>', '>=')) !== null) {
            $left = ['op', $op, $left, $this->concat()];
        }

        return $left;
    }

    /** @return array<int, mixed> */
    private function concat(): array
    {
        $left = $this->additive();

        while ($this->accept('&') !== null) {
            $left = ['op', '&', $left, $this->additive()];
        }

        return $left;
    }

    /** @return array<int, mixed> */
    private function additive(): array
    {
        $left = $this->multiplicative();

        while (($op = $this->accept('+', '-')) !== null) {
            $left = ['op', $op, $left, $this->multiplicative()];
        }

        return $left;
    }

    /** @return array<int, mixed> */
    private function multiplicative(): array
    {
        $left = $this->unary();

        while (($op = $this->accept('*', '/', '%')) !== null) {
            $left = ['op', $op, $left, $this->unary()];
        }

        return $left;
    }

    /** @return array<int, mixed> */
    private function unary(): array
    {
        if ($this->accept('-') !== null) {
            return ['neg', $this->unary()];
        }

        if ($this->accept('+') !== null) {
            return $this->unary();
        }

        return $this->primary();
    }

    /** @return array<int, mixed> */
    private function primary(): array
    {
        $t = $this->peek();

        if ($t[0] === 'num' || $t[0] === 'str') {
            $this->at++;

            return [$t[0], $t[1]];
        }

        if ($this->accept('(') !== null) {
            $inner = $this->comparison();
            $this->expect(')');

            return $inner;
        }

        if ($t[0] !== 'name') {
            $this->fail('unexpected '.$this->describe($t));
        }

        $this->at++;
        $lower = strtolower($t[1]);

        if (in_array($lower, ['true', 'false', 'null'], true)) {
            return ['lit', ['true' => true, 'false' => false, 'null' => null][$lower]];
        }

        if ($this->accept('(') === null) {
            return ['ref', $t[1]];
        }

        if (! isset(self::FUNCTIONS[$lower])) {
            $this->fail("unknown function \"{$t[1]}\"", $t[2]);
        }

        $args = [];
        if ($this->accept(')') === null) {
            do {
                $args[] = $this->comparison();
            } while ($this->accept(',') !== null);
            $this->expect(')');
        }

        [$min, $max] = self::FUNCTIONS[$lower];
        if (count($args) < $min || ($max !== null && count($args) > $max)) {
            $this->fail("{$lower}() takes ".($max === null ? "at least {$min}" : ($min === $max ? $min : "{$min} to {$max}")).' argument(s), '.count($args).' given', $t[2]);
        }

        return ['call', $lower, $args];
    }

    /** @param  array{0: string, 1: mixed, 2: int}  $t */
    private function describe(array $t): string
    {
        return $t[0] === 'end' ? 'the end' : '"'.($t[0] === 'str' ? "'{$t[1]}'" : self::text($t[1])).'"';
    }

    private function fail(string $message, ?int $at = null): never
    {
        $at ??= $this->peek()[2];

        throw new InvalidArgumentException("Formula [{$this->source}]: {$message} at position ".($at + 1).'.');
    }
}
