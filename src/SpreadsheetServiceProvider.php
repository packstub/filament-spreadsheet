<?php

namespace Packstub\Spreadsheet;

use Filament\Support\Assets\AlpineComponent;
use Filament\Support\Assets\Css;
use Filament\Support\Facades\FilamentAsset;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;

class SpreadsheetServiceProvider extends PackageServiceProvider
{
    public static string $name = 'packstub-spreadsheet';

    public function configurePackage(Package $package): void
    {
        $package
            ->name(static::$name)
            ->hasConfigFile()
            ->hasViews(static::$name)
            ->hasTranslations();
    }

    public function packageBooted(): void
    {
        // Loaded by the sheet itself (x-load / x-load-css), so pages without one pay nothing.
        FilamentAsset::register([
            AlpineComponent::make('spreadsheet', __DIR__.'/../resources/dist/spreadsheet.js'),
            Css::make('spreadsheet', __DIR__.'/../resources/dist/spreadsheet.css')->loadedOnRequest(),
        ], 'packstub/filament-spreadsheet');
    }
}
