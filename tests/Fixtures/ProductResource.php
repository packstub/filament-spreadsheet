<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

use Closure;
use Filament\Forms\Components\TextInput;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource\Pages\ListProducts;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource\Pages\ProductsSheet;

class ProductResource extends Resource
{
    protected static ?string $model = Product::class;

    protected static ?string $slug = 'products';

    /** Narrows the resource's query, the way a tenant scope would. */
    public static ?Closure $scope = null;

    public static function getEloquentQuery(): Builder
    {
        $query = parent::getEloquentQuery();

        if (static::$scope) {
            (static::$scope)($query);
        }

        return $query;
    }

    public static function form(Schema $schema): Schema
    {
        return $schema->components([TextInput::make('sku')->required(), TextInput::make('name')->required()]);
    }

    public static function table(Table $table): Table
    {
        return $table->columns([TextColumn::make('sku'), TextColumn::make('name')]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListProducts::route('/'),
            'sheet' => ProductsSheet::route('/sheet'),
        ];
    }
}
