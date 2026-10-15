<?php

use Livewire\Livewire;
use Packstub\Spreadsheet\Enums\FiltersLayout;
use Packstub\Spreadsheet\Tests\Fixtures\ProductSheet;

/**
 * The rendered view: Filament's components in place and the sheet's own hooks on them (the harness, the demo rig
 * and a theme address the `ps-sheet-*` classes), so a renamed Filament component or a dropped hook fails here
 * before the browser harness runs.
 */
it('renders the toolbar, the footer, the dialog and the help modal with their hooks', function (): void {
    $html = Livewire::mount(ProductSheet::class);

    foreach ([
        'class="ps-sheet"', 'ps-sheet-toolbar', 'ps-sheet-toolbar-start', 'ps-sheet-toolbar-end', 'ps-sheet-add-row', 'ps-sheet-group', 'ps-sheet-btn-primary', 'ps-sheet-seg-btn',
        'ps-sheet-btn-danger', 'ps-sheet-search', 'fi-input-wrp', 'fi-input-has-inline-prefix', 'ps-sheet-filter', 'fi-select-input', 'fi-fo-date-time-picker',
        'ps-sheet-filters-dropdown', 'ps-sheet-filters-btn', 'ps-sheet-filters-header', 'ps-sheet-filters-reset',
        'ps-sheet-help-btn', 'ps-sheet-help', 'ps-sheet-shortcuts', 'ps-sheet-grid', 'ps-sheet-footer', 'ps-sheet-status', 'ps-sheet-pill-errors',
        'ps-sheet-hint', 'ps-sheet-pager', 'ps-sheet-per-page', 'ps-sheet-dialog', 'ps-sheet-dialog-ok', 'ps-sheet-dialog-text', 'ps-sheet-menu',
        'fi-btn', 'fi-icon-btn', 'fi-badge', 'fi-modal', 'fi-dropdown', 'fi-dropdown-panel', 'fi-dropdown-list-item', 'data-dispatch="packstub-spreadsheet"',
    ] as $hook) {
        expect($html)->toContain($hook);
    }

    expect($html)->toContain('-ps-sheet-dialog')->toContain('-ps-sheet-help');
});

it('sends the filters layout with the config: the config default, a definition value over it, a typo refused', function (): void {
    expect(Livewire::test(ProductSheet::class)->instance()->getSpreadsheetConfig()['filtersLayout'])->toBe('dropdown');

    config()->set('packstub-spreadsheet.filters_layout', 'above');
    expect(Livewire::test(ProductSheet::class)->instance()->getSpreadsheetConfig()['filtersLayout'])->toBe('above');

    expect(sheet()->filtersLayout(FiltersLayout::Toolbar)->getFiltersLayout())->toBe(FiltersLayout::Toolbar)
        ->and(sheet()->filtersLayout('dropdown')->getFiltersLayout())->toBe(FiltersLayout::Dropdown);

    $sheet = sheet();
    config()->set('packstub-spreadsheet.filters_layout', 'sideways');
    expect(fn () => $sheet->getFiltersLayout())->toThrow(InvalidArgumentException::class);
});
