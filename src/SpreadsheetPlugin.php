<?php

namespace Packstub\Spreadsheet;

use Filament\Contracts\Plugin;
use Filament\Panel;

/**
 * Optional: `->plugin(SpreadsheetPlugin::make())` on a panel. The pages work
 * without it (the assets are registered by the service provider); it is here so
 * a panel can list the plugin like any other.
 */
class SpreadsheetPlugin implements Plugin
{
    public static function make(): static
    {
        return app(static::class);
    }

    public static function get(): static
    {
        return filament(app(static::class)->getId());
    }

    public function getId(): string
    {
        return 'packstub-spreadsheet';
    }

    public function register(Panel $panel): void {}

    public function boot(Panel $panel): void {}
}
