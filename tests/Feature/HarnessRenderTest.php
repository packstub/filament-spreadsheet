<?php

use Filament\Support\Facades\FilamentAsset;
use Livewire\Livewire;
use Packstub\Spreadsheet\Filter;
use Packstub\Spreadsheet\Tests\Fixtures\Category;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;

/**
 * Not a test of the package: the browser harness (tests/browser/harness.mjs) runs this case to get the sheet view
 * rendered through the test app, Blade components and all, and the panel's <style> blocks (the colours). It
 * writes JSON { view, styles } to the file HARNESS_RENDER names and is skipped otherwise.
 */
it('renders the sheet view for the browser harness', function (): void {
    $target = getenv('HARNESS_RENDER');

    if (! $target) {
        $this->markTestSkipped('HARNESS_RENDER names no file.');
    }

    // The filters are rendered where the layout says: the harness asks for each layout it drives.
    if ($layout = getenv('HARNESS_FILTERS_LAYOUT')) {
        config()->set('packstub-spreadsheet.filters_layout', $layout);
    }

    // The harness's three filters: a searchable Category (Filament's own select component, so the harness drives it),
    // a Yes / No boolean (a native select) and a date range; the categories are the harness's own, by id.
    foreach (['Tools', 'Paint', 'Garden'] as $name) {
        category($name);
    }

    ProductSheet::$filters = [
        Filter::select('category_id')->searchable()->options(fn () => Category::query()->orderBy('id')->pluck('name', 'id')->all()),
        Filter::boolean('is_active'),
        Filter::dateRange('available_on'),
    ];

    try {
        $html = Livewire::mount(ProductSheet::class);
    } finally {
        ProductSheet::$filters = null;
    }
    $start = strpos($html, '<div', strpos($html, '<div') + 1); // the fixture wraps the sheet in one div
    $end = strrpos($html, '</div>', -7); // the last </div> is the wrapper's, the one before it the sheet root's
    $view = substr($html, $start, $end + 6 - $start);

    preg_match_all('/<style[^>]*>[\s\S]*?<\/style>/', FilamentAsset::renderStyles(), $m);

    file_put_contents($target, json_encode(['view' => $view, 'styles' => implode("\n", $m[0])], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

    expect(str_starts_with($view, '<div'))->toBeTrue()->and(str_ends_with($view, '</div>'))->toBeTrue();
});
