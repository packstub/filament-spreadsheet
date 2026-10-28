<?php

use Illuminate\Support\Facades\File;
use Illuminate\Support\ServiceProvider;
use Packstub\Spreadsheet\SpreadsheetServiceProvider;

it('publishes the config file under the tag the docs name', function () {
    $paths = ServiceProvider::pathsToPublish(SpreadsheetServiceProvider::class, 'packstub-spreadsheet-config');

    expect($paths)->toHaveCount(1)
        ->and(array_key_first($paths))->toEndWith('config/packstub-spreadsheet.php');

    $target = config_path('packstub-spreadsheet.php');
    File::delete($target);

    try {
        $this->artisan('vendor:publish', ['--tag' => 'packstub-spreadsheet-config'])->assertSuccessful();

        expect(File::exists($target))->toBeTrue()
            ->and(require $target)->toHaveKeys(['per_page', 'max_per_page', 'max_rows_per_save', 'save_mode', 'version_column', 'confirm_leave', 'frozen_first_column', 'filters_layout', 'row_height', 'keybindings', 'date_format', 'datetime_format', 'first_day_of_week']);
    } finally {
        File::delete($target);
    }
});

it('names in the README and the docs only publish tags that publish something', function () {
    $root = dirname(__DIR__, 2);
    $tags = [];

    foreach ([$root.'/README.md', ...File::glob($root.'/docs/*.md')] as $file) {
        preg_match_all('/--tag=([\w-]+)/', File::get($file), $matches);
        $tags = [...$tags, ...$matches[1]];
    }

    expect($tags)->toContain('packstub-spreadsheet-config', 'packstub-spreadsheet-translations');

    foreach (array_unique($tags) as $tag) {
        expect(ServiceProvider::pathsToPublish(SpreadsheetServiceProvider::class, $tag))->not->toBeEmpty("--tag={$tag} publishes nothing");
    }
});

it('ships every string in every language', function () {
    $root = dirname(__DIR__, 2).'/resources/lang';
    $en = array_keys(require "{$root}/en/spreadsheet.php");

    foreach (['ro', 'ru', 'de'] as $locale) {
        expect(array_keys(require "{$root}/{$locale}/spreadsheet.php"))->toBe($en, "{$locale} differs from en");
    }
});

it('registers the built assets, with Tabulator\'s copyright and permission notice kept in both files', function () {
    $root = dirname(__DIR__, 2);
    $js = File::get("{$root}/resources/dist/spreadsheet.js");
    $css = File::get("{$root}/resources/dist/spreadsheet.css");

    expect(strlen($js))->toBeGreaterThan(10000)
        ->and(strlen($css))->toBeGreaterThan(1000)
        ->and($js)->toContain('spreadsheetSave', 'Tabulator 6');

    // MIT asks for the copyright notice and the permission notice in substantial portions: the bundles are one.
    foreach ([$js, $css] as $bundle) {
        expect(substr($bundle, 0, 2000))->toContain('Copyright (c) 2015-2026 Oli Folkerd', 'Permission is hereby granted, free of charge');
    }

    expect(File::get("{$root}/LICENSE.md"))->toContain('Third-party', 'Tabulator', 'Oli Folkerd');
});
