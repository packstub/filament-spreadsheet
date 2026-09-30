<?php

namespace Packstub\Spreadsheet\Pages;

use Filament\Resources\Pages\Page;
use Filament\Support\Enums\Width;
use Illuminate\Database\Eloquent\Model;
use Packstub\Spreadsheet\Concerns\InteractsWithSpreadsheet;
use Packstub\Spreadsheet\Spreadsheet;

/**
 * A resource page holding one sheet, next to the resource's list (`/products/sheet`).
 * Access follows the resource's policy (`viewAny`); rows come from the resource's
 * query (tenant-scoped), and each row's update, create and delete go through the
 * resource's abilities (`canEdit()`, `canCreate()`, `canDelete()`) unless the
 * definition sets its own query() or authorize*() closures.
 */
abstract class SpreadsheetResourcePage extends Page
{
    use InteractsWithSpreadsheet;

    protected string $view = 'packstub-spreadsheet::pages.spreadsheet';

    protected Width|string|null $maxContentWidth = Width::Full;

    /** @param  array<string, mixed>  $parameters */
    public static function canAccess(array $parameters = []): bool
    {
        return static::getResource()::canAccess() && parent::canAccess($parameters);
    }

    protected function configureSpreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        $resource = static::getResource();

        if (! $spreadsheet->hasQuery()) {
            $spreadsheet->query(fn () => $resource::getEloquentQuery());
        }

        if (! $spreadsheet->hasAuthorizeUpdate()) {
            $spreadsheet->authorizeUpdate(fn (Model $record) => $resource::canEdit($record));
        }

        if (! $spreadsheet->hasAuthorizeCreate()) {
            $spreadsheet->authorizeCreate(fn () => $resource::canCreate());
        }

        if (! $spreadsheet->hasAuthorizeDelete()) {
            $spreadsheet->authorizeDelete(fn (Model $record) => $resource::canDelete($record));
        }

        return $spreadsheet;
    }
}
