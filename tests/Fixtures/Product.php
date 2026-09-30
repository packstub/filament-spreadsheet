<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Casts of every kind the sheet handles, a mutator (the SKU is stored upper-case)
 * and an enum-cast status, so the rows the server answers with can be checked
 * against what the browser sent.
 */
class Product extends Model
{
    protected $guarded = [];

    protected $casts = [
        'price' => 'decimal:2',
        'cost' => 'decimal:2',
        'stock' => 'integer',
        'is_active' => 'boolean',
        'is_locked' => 'boolean',
        'available_on' => 'date',
        'published_at' => 'datetime',
        'status' => Status::class,
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    protected function sku(): Attribute
    {
        return Attribute::make(set: fn (?string $value) => $value === null ? null : strtoupper(trim($value)));
    }
}
