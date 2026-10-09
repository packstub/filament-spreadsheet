<?php

namespace Packstub\Spreadsheet\Tests;

use BladeUI\Heroicons\BladeHeroiconsServiceProvider;
use BladeUI\Icons\BladeIconsServiceProvider;
use Filament\Actions\ActionsServiceProvider;
use Filament\FilamentServiceProvider;
use Filament\Forms\FormsServiceProvider;
use Filament\Infolists\InfolistsServiceProvider;
use Filament\Notifications\NotificationsServiceProvider;
use Filament\Schemas\SchemasServiceProvider;
use Filament\Support\SupportServiceProvider;
use Filament\Tables\TablesServiceProvider;
use Filament\Widgets\WidgetsServiceProvider;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Schema;
use Livewire\LivewireServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;
use Packstub\Spreadsheet\SpreadsheetServiceProvider;
use Packstub\Spreadsheet\Tests\Fixtures\AdminPanelProvider;
use Packstub\Spreadsheet\Tests\Fixtures\Product;
use Packstub\Spreadsheet\Tests\Fixtures\ProductPolicy;
use Packstub\Spreadsheet\Tests\Fixtures\ProductResource;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;
use Packstub\Spreadsheet\Tests\Fixtures\User;
use RyanChandler\BladeCaptureDirective\BladeCaptureDirectiveServiceProvider;

abstract class TestCase extends Orchestra
{
    protected function setUp(): void
    {
        parent::setUp();

        ProductPolicy::reset();
        ProductSheet::resetFlags();
        ProductResource::$scope = null;
        Gate::policy(Product::class, ProductPolicy::class);

        // A real server (CI's MySQL and PostgreSQL jobs) keeps its tables between tests.
        if (config('database.default') !== 'sqlite') {
            Schema::dropAllTables();
        }

        Schema::create('users', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('categories', function (Blueprint $table): void {
            $table->id();
            $table->string('name');
            $table->boolean('is_active')->default(true);
        });

        Schema::create('products', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('category_id')->nullable();
            $table->string('sku')->unique();
            $table->string('name');
            // Nullable with a default: a cleared cell writes null, a new row starts from the default.
            $table->decimal('price', 10, 2)->nullable()->default(0);
            $table->decimal('cost', 10, 2)->default(0);
            $table->integer('stock')->nullable()->default(0);
            $table->boolean('is_active')->nullable()->default(true);
            $table->boolean('is_locked')->default(false);
            $table->date('available_on')->nullable();
            $table->dateTime('published_at')->nullable();
            $table->string('status')->nullable()->default('draft');
            $table->string('notes')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
        });
    }

    protected function getPackageProviders($app): array
    {
        return [
            ActionsServiceProvider::class,
            BladeCaptureDirectiveServiceProvider::class,
            BladeHeroiconsServiceProvider::class,
            BladeIconsServiceProvider::class,
            FilamentServiceProvider::class,
            FormsServiceProvider::class,
            InfolistsServiceProvider::class,
            NotificationsServiceProvider::class,
            SchemasServiceProvider::class,
            SupportServiceProvider::class,
            TablesServiceProvider::class,
            WidgetsServiceProvider::class,
            // Real apps discover filament/* before livewire; keep that order.
            LivewireServiceProvider::class,
            SpreadsheetServiceProvider::class,
            AdminPanelProvider::class,
        ];
    }

    protected function defineEnvironment($app): void
    {
        // SQLite in memory by default. DB_CONNECTION=mysql or pgsql (with DB_HOST,
        // DB_DATABASE, DB_USERNAME…) runs the suite on a real server, the way CI does:
        // MySQL's strict mode and PostgreSQL refuse SQL that SQLite lets through, and
        // the row locks, the savepoints and the `like … escape` clause only exist there.
        $connection = (string) env('DB_CONNECTION', 'sqlite');
        $app['config']->set('database.default', $connection);

        if ($connection === 'sqlite') {
            $app['config']->set('database.connections.sqlite', ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']);
        }
        $app['config']->set('auth.providers.users.model', User::class);
        $app['config']->set('app.key', 'base64:2fl+Ktv6fZ7c7ZQfF1Zt6Q0Wd9jz5bJ6rKq8nX0m3Yk=');
        $app['config']->set('app.url', 'http://localhost');
    }
}
