<?php

namespace Packstub\Spreadsheet\Actions;

use Closure;
use Filament\Actions\Action;
use Filament\Resources\Pages\PageRegistration;
use Filament\Support\Icons\Heroicon;

/**
 * A header action for a resource's list page that links to its sheet page
 * (`'sheet' => ProductsSheet::route('/sheet')` in getPages()). Hidden when the
 * user may not access that page.
 */
class SheetAction extends Action
{
    protected string $page = 'sheet';

    protected string|Closure|null $resource = null;

    public static function getDefaultName(): ?string
    {
        return 'sheet';
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->label(fn (): string => __('packstub-spreadsheet::spreadsheet.open_sheet'));
        $this->icon(Heroicon::OutlinedTableCells);
        $this->url(fn (): ?string => $this->getPageUrl());
        $this->visible(fn (): bool => $this->canAccessPage());
    }

    /** The name of the sheet page in the resource's getPages() (default `sheet`). */
    public function page(string $name): static
    {
        $this->page = $name;

        return $this;
    }

    /** The resource whose sheet to open; by default the one the current page belongs to. */
    public function resource(string|Closure|null $resource): static
    {
        $this->resource = $resource;

        return $this;
    }

    /** @return class-string|null */
    public function getResourceClass(): ?string
    {
        $resource = $this->evaluate($this->resource);

        if (is_string($resource) && class_exists($resource)) {
            return $resource;
        }

        $livewire = $this->getLivewire();

        return $livewire !== null && method_exists($livewire, 'getResource') ? $livewire::getResource() : null;
    }

    protected function getPageRegistration(): ?PageRegistration
    {
        $resource = $this->getResourceClass();

        if ($resource === null) {
            return null;
        }

        $registration = $resource::getPages()[$this->page] ?? null;

        return $registration instanceof PageRegistration ? $registration : null;
    }

    protected function canAccessPage(): bool
    {
        $registration = $this->getPageRegistration();

        return $registration !== null && $registration->getPage()::canAccess();
    }

    protected function getPageUrl(): ?string
    {
        if ($this->getPageRegistration() === null) {
            return null;
        }

        return $this->getResourceClass()::getUrl($this->page);
    }
}
