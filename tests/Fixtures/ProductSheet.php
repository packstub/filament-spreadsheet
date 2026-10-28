<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

use Filament\Schemas\Concerns\InteractsWithSchemas;
use Filament\Schemas\Contracts\HasSchemas;
use Illuminate\Database\Eloquent\Collection;
use Livewire\Component;
use Packstub\Spreadsheet\Columns\BooleanColumn;
use Packstub\Spreadsheet\Columns\ComputedColumn;
use Packstub\Spreadsheet\Columns\DateColumn;
use Packstub\Spreadsheet\Columns\DateTimeColumn;
use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\SelectColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Concerns\InteractsWithSpreadsheet;
use Packstub\Spreadsheet\Enums\SaveMode;
use Packstub\Spreadsheet\Exceptions\SaveRejected;
use Packstub\Spreadsheet\Filter;
use Packstub\Spreadsheet\SavePayload;
use Packstub\Spreadsheet\Spreadsheet;

/** A plain Livewire component holding a sheet, the way an app page would (with schemas, for the filters' selects on Filament 4.16+ / 5.11+). Static flags shape it per test. */
class ProductSheet extends Component implements HasSchemas
{
    use InteractsWithSchemas;
    use InteractsWithSpreadsheet;

    public static bool $creatable = true;

    public static bool $deletable = true;

    public static bool $readOnly = false;

    public static ?SaveMode $saveMode = null;

    public static ?int $perPage = null;

    public static bool $rejectInBeforeSave = false;

    public static bool $failInAfterSave = false;

    public static bool $brokenQuery = false;

    public static ?string $height = null;

    /** The filters instead of the fixture's three (null: the fixture's). @var list<Filter>|null */
    public static ?array $filters = null;

    /** sku gets validationMessages() and validationAttribute(). */
    public static bool $ownMessages = false;

    /** @var list<array<string, mixed>> */
    public static array $afterSave = [];

    /** @var list<SavePayload> */
    public static array $beforeSave = [];

    public static function resetFlags(): void
    {
        static::$creatable = true;
        static::$deletable = true;
        static::$readOnly = false;
        static::$saveMode = null;
        static::$perPage = null;
        static::$rejectInBeforeSave = false;
        static::$failInAfterSave = false;
        static::$brokenQuery = false;
        static::$height = null;
        static::$filters = null;
        static::$ownMessages = false;
        static::$afterSave = [];
        static::$beforeSave = [];
    }

    public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet
            ->query(fn () => static::$brokenQuery ? Product::query()->whereRaw('no_such_column = 1') : Product::query()->with('category'))
            ->columns([
                TextColumn::make('sku')->rules(['required', 'max:32', 'unique:products,sku'])->frozen()
                    ->when(static::$ownMessages, fn (TextColumn $c) => $c->validationMessages(['required' => 'Every product needs a SKU.'])->validationAttribute('product code')),
                TextColumn::make('name')->rules(['required'])->maxLength(120),
                SelectColumn::make('category_id')->relationship('category', 'name', fn ($query) => $query->where('is_active', true)),
                SelectColumn::make('status')->options(Status::class)->default('draft'),
                NumberColumn::make('price')->decimals(2)->min(0),
                NumberColumn::make('cost')->decimals(2)->readOnly(fn (Product $product) => $product->is_locked),
                NumberColumn::make('stock')->integer()->min(0)->default(0),
                BooleanColumn::make('is_active')->default(true),
                DateColumn::make('available_on'),
                DateTimeColumn::make('published_at'),
                TextColumn::make('notes')->hidden(fn () => true),
                ComputedColumn::make('margin')->state(fn (Product $product) => round((float) $product->price - (float) $product->cost, 2)),
            ])
            ->searchable(['sku', 'name', 'category.name'])
            ->defaultSort('sku')
            ->perPage(static::$perPage)
            ->filters(static::$filters ?? [
                Filter::select('category_id')->options(fn () => Category::query()->pluck('name', 'id')->all()),
                Filter::boolean('is_active'),
                Filter::dateRange('available_on'),
            ])
            ->creatable(static::$creatable)
            ->deletable(static::$deletable)
            ->readOnly(fn () => static::$readOnly)
            ->saveMode(static::$saveMode)
            ->beforeSave(function (SavePayload $payload): void {
                static::$beforeSave[] = $payload;

                throw_if(static::$rejectInBeforeSave, new SaveRejected('Not today.'));
            })
            ->mutateRowBeforeSave(fn (array $data, ?Product $record) => $data + ['updated_by' => 7])
            ->afterSave(function (Collection $products): void {
                static::$afterSave[] = $products->modelKeys();

                throw_if(static::$failInAfterSave, new \RuntimeException('indexer down'));
            });
    }

    protected function getSpreadsheetHeight(): ?string
    {
        return static::$height;
    }

    public function render(): string
    {
        return '<div>@include(\'packstub-spreadsheet::spreadsheet\')</div>';
    }
}
