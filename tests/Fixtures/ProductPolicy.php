<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

class ProductPolicy
{
    public static bool $allowed = true;

    /** SKUs that may be updated; null = all. */
    public static ?array $updatable = null;

    public static bool $createAllowed = true;

    /** SKUs that may be deleted; null = all. */
    public static ?array $deletable = null;

    public static function reset(): void
    {
        static::$allowed = true;
        static::$updatable = null;
        static::$createAllowed = true;
        static::$deletable = null;
    }

    public function viewAny(?User $user): bool
    {
        return static::$allowed;
    }

    public function view(?User $user, Product $product): bool
    {
        return static::$allowed;
    }

    public function create(?User $user): bool
    {
        return static::$allowed && static::$createAllowed;
    }

    public function update(?User $user, Product $product): bool
    {
        return static::$allowed && (static::$updatable === null || in_array($product->sku, static::$updatable, true));
    }

    public function delete(?User $user, Product $product): bool
    {
        return static::$allowed && (static::$deletable === null || in_array($product->sku, static::$deletable, true));
    }
}
