@php
    use Filament\Support\Facades\FilamentAsset;
    use Filament\Support\Icons\Heroicon;
    use Illuminate\Support\HtmlString;

    $config = $this->getSpreadsheetConfig();
    $dialogId = $this->getId() . '-ps-sheet-dialog';
    $helpId = $this->getId() . '-ps-sheet-help';
    // The dialog's heading and text are the component's (dialog.heading, dialog.text): spans for the modal's slots.
    $dialogHeading = new HtmlString('<span x-text="dialog ? dialog.heading : \'\'"></span>');
    $dialogText = new HtmlString('<span class="ps-sheet-dialog-text" x-text="dialog ? dialog.text : \'\'"></span>');
@endphp

{{--
    The browser owns the sheet: rows are drawn by the grid from JSON and unsaved
    cells live in the browser until Save; Livewire only answers renderless calls.
    wire:ignore keeps a page re-render (an action's modal, say) from resetting it,
    and such a render carries no rows at all (see getSpreadsheetConfig()).
    The toolbar, the filters and the dialog are Filament's own Blade components
    (button, icon-button, input wrapper, select, badge, modal), rendered once and
    driven by Alpine; the ps-sheet-* classes beside theirs are the sheet's hooks.
    The stylesheet comes on request (x-load-css), after the markup is on screen:
    the sheet is kept invisible (visibility, so the layout is already there to
    measure) until the component sees the stylesheet (reveal()), the toolbar's
    icons would otherwise fill the page for an instant. data-dispatch makes
    x-load-css fire `packstub-spreadsheet-css` on the window once it is in.
--}}
<div
    wire:ignore
    x-load
    x-load-src="{{ FilamentAsset::getAlpineComponentSrc('spreadsheet', 'packstub/filament-spreadsheet') }}"
    x-load-css="[@js(FilamentAsset::getStyleHref('spreadsheet', 'packstub/filament-spreadsheet'))]"
    data-dispatch="packstub-spreadsheet"
    x-data="packstubSpreadsheet(@js($config))"
    x-on:keydown.escape.window="onEscape()"
    x-on:packstub-spreadsheet-refresh.window="refresh()"
    x-on:modal-closed="modalClosed($event)"
    class="ps-sheet"
    style="visibility: hidden"
    :class="{ 'ps-sheet-is-readonly': readOnly, 'ps-sheet-is-saving': saving, 'ps-sheet-is-loading': loading, 'ps-sheet-is-dirty': dirty.total > 0 }"
    :style="height ? { '--ps-sheet-height': height } : {}"
>
    {{--
        The toolbar shows what applies: the Save group (Save, Discard, Undo, Redo) once something was changed or
        undone, Delete rows for a selection of rows, the errors badge for marked cells; Add row, the search and
        the filters are always there. The pager sits in the footer under the grid, as a table's does.
    --}}
    <div class="ps-sheet-toolbar">
        <x-filament::button
            color="gray"
            :icon="Heroicon::OutlinedPlus"
            class="ps-sheet-btn ps-sheet-add-row"
            x-show="creatable"
            x-on:click="addRow()"
            x-bind:disabled="readOnly || saving"
            x-bind:title="t.add_row + ' (' + keyLabel('add_row') + ')'"
        >
            <span x-text="t.add_row"></span>
        </x-filament::button>

        <div class="ps-sheet-group" x-show="! readOnly && (dirty.total || editing || canUndo || canRedo)">
            <x-filament::button
                color="primary"
                class="ps-sheet-btn ps-sheet-btn-primary"
                x-on:click="save()"
                x-bind:disabled="readOnly || saving || ! (dirty.total || editing)"
                x-bind:title="t.save + ' (' + keyLabel('save') + ')'"
            >
                <span x-text="t.save"></span>
                <div class="fi-btn-badge-ctn" x-show="dirty.total">
                    <x-filament::badge size="xs" color="primary" class="ps-sheet-badge"><span x-text="dirty.total"></span></x-filament::badge>
                </div>
            </x-filament::button>

            <x-filament::button color="gray" class="ps-sheet-btn" x-on:click="discard()" x-bind:disabled="saving || ! dirty.total">
                <span x-text="t.discard"></span>
            </x-filament::button>

            <div class="ps-sheet-seg" role="group">
                <x-filament::icon-button
                    color="gray"
                    :icon="Heroicon::OutlinedArrowUturnLeft"
                    :label="__('packstub-spreadsheet::spreadsheet.undo')"
                    class="ps-sheet-seg-btn"
                    x-on:click="undo()"
                    x-bind:disabled="saving || ! canUndo"
                    x-bind:title="t.undo + ' (' + keyLabel('undo') + ')'"
                />
                <x-filament::icon-button
                    color="gray"
                    :icon="Heroicon::OutlinedArrowUturnRight"
                    :label="__('packstub-spreadsheet::spreadsheet.redo')"
                    class="ps-sheet-seg-btn"
                    x-on:click="redo()"
                    x-bind:disabled="saving || ! canRedo"
                    x-bind:title="t.redo + ' (' + keyLabel('redo') + ')'"
                />
            </div>
        </div>

        <x-filament::button
            color="gray"
            :icon="Heroicon::OutlinedTrash"
            class="ps-sheet-btn ps-sheet-btn-danger"
            x-show="deletable && selected"
            x-on:click="deleteSelected()"
            x-bind:disabled="readOnly || saving || ! selected"
            x-bind:title="t.delete_rows"
        >
            <span x-text="t.delete_rows"></span>
            <div class="fi-btn-badge-ctn" x-show="selected">
                <x-filament::badge size="xs" color="danger" class="ps-sheet-badge"><span x-text="selected"></span></x-filament::badge>
            </div>
        </x-filament::button>

        <div class="ps-sheet-spacer"></div>

        <x-filament::badge color="gray" class="ps-sheet-pill ps-sheet-pill-readonly" x-show="readOnly"><span x-text="t.read_only_badge"></span></x-filament::badge>
        {{-- what the Save badge's count does not say: changes on other pages, new rows, rows to delete --}}
        <x-filament::badge color="warning" class="ps-sheet-pill ps-sheet-pill-dirty" x-show="dirty.total && (dirty.pages > 1 || dirty.created || dirty.deleted)"><span x-text="changesLabel()"></span></x-filament::badge>

        <x-filament::input.wrapper inline-prefix :prefix-icon="Heroicon::MagnifyingGlass" class="ps-sheet-field ps-sheet-search" x-show="searchable">
            <x-filament::input type="search" inline-prefix autocomplete="off" x-model="search" x-on:input.debounce.400ms="refresh()" x-bind:placeholder="t.search" x-bind:aria-label="t.search" />
        </x-filament::input.wrapper>

        {{-- the filters inline (filtersLayout toolbar) --}}
        <template x-if="filtersLayout === 'toolbar'">
            <div class="ps-sheet-filters ps-sheet-filters-inline">
                @include('packstub-spreadsheet::filters')
            </div>
        </template>

        {{-- the filters behind a funnel button (filtersLayout dropdown): the count of active ones on the button, a reset link in the panel --}}
        <template x-if="filtersLayout === 'dropdown' && filters.length">
            <div class="ps-sheet-filters-dropdown">
                <x-filament::dropdown placement="bottom-end" width="xs">
                    <x-slot name="trigger">
                        <div class="ps-sheet-filters-trigger">
                            <x-filament::icon-button color="gray" :icon="Heroicon::OutlinedFunnel" :label="__('packstub-spreadsheet::spreadsheet.filters')" class="ps-sheet-filters-btn" x-bind:title="t.filters" />
                            <div class="fi-icon-btn-badge-ctn" x-show="activeFilterCount()">
                                <x-filament::badge size="xs" color="primary" class="ps-sheet-filters-count"><span x-text="activeFilterCount()"></span></x-filament::badge>
                            </div>
                        </div>
                    </x-slot>
                    <div class="ps-sheet-filters ps-sheet-filters-panel">
                        @include('packstub-spreadsheet::filters', ['stacked' => true])
                        <x-filament::link tag="button" color="danger" size="sm" class="ps-sheet-filters-reset" x-show="activeFilterCount()" x-on:click="resetFilters()">
                            <span x-text="t.reset_filters"></span>
                        </x-filament::link>
                    </div>
                </x-filament::dropdown>
            </div>
        </template>

        <x-filament::icon-button color="gray" :icon="Heroicon::OutlinedQuestionMarkCircle" :label="__('packstub-spreadsheet::spreadsheet.shortcuts')" class="ps-sheet-help-btn" x-bind:title="t.shortcuts" x-on:click="openHelp()" />
    </div>

    {{-- the filters on a row of their own (filtersLayout above) --}}
    <template x-if="filtersLayout === 'above' && filters.length">
        <div class="ps-sheet-filters ps-sheet-filters-above">
            @include('packstub-spreadsheet::filters')
        </div>
    </template>

    <div class="ps-sheet-grid" x-ref="grid" x-on:contextmenu.prevent="openMenu($event)"></div>

    {{-- Discard and Delete rows ask in Filament's modal (opened by its id; Escape, the overlay and the modal-closed event are its); the OK button carries the answer --}}
    <x-filament::modal
        :id="$dialogId"
        width="md"
        alignment="center"
        footer-actions-alignment="center"
        :icon="Heroicon::OutlinedExclamationTriangle"
        icon-color="danger"
        :heading="$dialogHeading"
        :description="$dialogText"
        :restores-focus="false"
        class="ps-sheet-dialog"
        x-bind:aria-label="dialog ? dialog.text : ''"
    >

        <x-slot name="footerActions">
            {{-- one OK button per colour (a colour is a set of classes), the one the question asks for shown --}}
            <x-filament::button color="danger" value="ok" class="ps-sheet-dialog-ok" x-show="dialog && dialog.danger" x-on:click="answerDialog(true, $root.id)">
                <span x-text="dialog ? dialog.confirm : ''"></span>
            </x-filament::button>
            <x-filament::button color="primary" value="ok" class="ps-sheet-dialog-ok" x-show="! (dialog && dialog.danger)" x-on:click="answerDialog(true, $root.id)">
                <span x-text="dialog ? dialog.confirm : ''"></span>
            </x-filament::button>
            <x-filament::button color="gray" value="cancel" x-on:click="answerDialog(false, $root.id)">
                <span x-text="t.cancel"></span>
            </x-filament::button>
        </x-slot>
    </x-filament::modal>

    {{-- the keyboard shortcuts, as bound, in Filament's modal --}}
    <x-filament::modal :id="$helpId" width="md" :heading="__('packstub-spreadsheet::spreadsheet.shortcuts')" :restores-focus="false" class="ps-sheet-help">
        <dl class="ps-sheet-shortcuts">
            <template x-for="item in shortcutList()" :key="item.label">
                <div class="ps-sheet-shortcut">
                    <dt x-text="item.label"></dt>
                    <dd><kbd class="ps-sheet-kbd" x-text="item.keys"></kbd></dd>
                </div>
            </template>
        </dl>
    </x-filament::modal>

    {{-- under the grid: the status line (always rendered: a live region announces a change only when it existed before it) and the pager --}}
    <div class="ps-sheet-footer">
        <div class="ps-sheet-status">
            <x-filament::badge tag="button" color="danger" class="ps-sheet-pill ps-sheet-pill-errors" x-show="errorCount" x-on:click="nextError()" x-bind:title="t.next_error"><span x-text="errorsLabel()"></span></x-filament::badge>
            <div class="ps-sheet-hint" role="status" aria-live="polite" :class="hint ? '' : (status && 'ps-sheet-hint-' + status.kind)" x-text="hint ?? (status ? status.text : '')"></div>
        </div>

        <nav class="ps-sheet-pager" :aria-label="t.page_of.replace(':page', page).replace(':pages', lastPage)">
            <span class="ps-sheet-count" x-text="rowsLabel()"></span>
            <x-filament::input.wrapper class="ps-sheet-field ps-sheet-per-page">
                <x-filament::input.select x-model.number="perPage" x-on:change="setPerPage(perPage)" x-bind:aria-label="t.per_page">
                    <template x-for="n in pageSizes" :key="n">
                        <option :value="n" :selected="n === perPage" x-text="n"></option>
                    </template>
                </x-filament::input.select>
            </x-filament::input.wrapper>
            <x-filament::icon-button color="gray" size="sm" :icon="Heroicon::ChevronLeft" :label="__('packstub-spreadsheet::spreadsheet.previous')" class="ps-sheet-seg-btn" x-on:click="prev()" x-bind:disabled="loading || page <= 1" />
            <span class="ps-sheet-pager-text" x-text="t.page_of.replace(':page', page).replace(':pages', lastPage)"></span>
            <x-filament::icon-button color="gray" size="sm" :icon="Heroicon::ChevronRight" :label="__('packstub-spreadsheet::spreadsheet.next')" class="ps-sheet-seg-btn" x-on:click="next()" x-bind:disabled="loading || page >= lastPage" />
        </nav>
    </div>

    {{-- The row menu at the pointer, in the dropdown's clothes. x-show and :style share the style attribute: object syntax keeps the display x-show sets --}}
    <div
        class="ps-sheet-menu fi-dropdown-panel"
        x-ref="menu"
        x-show="menu"
        x-cloak
        :style="menu ? { left: menu.x + 'px', top: menu.y + 'px' } : {}"
        x-on:click.outside="closeMenu()"
        x-on:keydown.down.prevent="menuMove(1)"
        x-on:keydown.up.prevent="menuMove(-1)"
        x-on:keydown.tab="closeMenu()"
        role="menu"
        :aria-label="t.row_menu"
    >
        <div class="fi-dropdown-list">
            <template x-for="item in (menu ? menu.items : [])" :key="item.name">
                <button type="button" class="ps-sheet-menu-item fi-dropdown-list-item" :class="item.color ? 'ps-sheet-menu-item-' + item.color + ' fi-color-' + item.color : 'fi-color-gray'" role="menuitem" x-on:click="runMenu(item.name)">
                    <span class="fi-dropdown-list-item-label" x-text="item.label"></span>
                </button>
            </template>
        </div>
    </div>
</div>
