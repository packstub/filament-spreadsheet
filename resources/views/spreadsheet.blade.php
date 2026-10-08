@php
    use Filament\Support\Facades\FilamentAsset;

    $config = $this->getSpreadsheetConfig();
@endphp

{{--
    The browser owns the sheet: rows are drawn by the grid from JSON and unsaved
    cells live in the browser until Save; Livewire only answers renderless calls.
    wire:ignore keeps a page re-render (an action's modal, say) from resetting it,
    and such a render carries no rows at all (see getSpreadsheetConfig()).
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
    class="ps-sheet"
    style="visibility: hidden"
    :class="{ 'ps-sheet-is-readonly': readOnly, 'ps-sheet-is-saving': saving, 'ps-sheet-is-loading': loading, 'ps-sheet-is-dirty': dirty.total > 0 }"
    :style="height ? { '--ps-sheet-height': height } : {}"
>
    <div class="ps-sheet-toolbar">
        <button type="button" class="ps-sheet-btn ps-sheet-btn-primary" x-on:click="save()" :disabled="readOnly || saving || ! (dirty.total || editing)" :title="t.save + ' (' + keyLabel('save') + ')'">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4.5h9l3 3V16H4z"/><path d="M7 4.5v4h5v-4M7 16v-4h6v4"/></svg>
            <span x-text="t.save"></span>
            <span class="ps-sheet-badge" x-show="dirty.total" x-text="dirty.total"></span>
        </button>

        <button type="button" class="ps-sheet-btn" x-on:click="discard()" :disabled="saving || ! dirty.total" x-text="t.discard"></button>

        <div class="ps-sheet-seg" role="group">
            <button type="button" class="ps-sheet-seg-btn" x-on:click="undo()" :disabled="saving || ! canUndo" :title="t.undo + ' (' + keyLabel('undo') + ')'" :aria-label="t.undo">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 5 3.5 8.5 7 12"/><path d="M4 8.5h8a4 4 0 0 1 0 8H9"/></svg>
            </button>
            <button type="button" class="ps-sheet-seg-btn" x-on:click="redo()" :disabled="saving || ! canRedo" :title="t.redo + ' (' + keyLabel('redo') + ')'" :aria-label="t.redo">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m13 5 3.5 3.5L13 12"/><path d="M16 8.5H8a4 4 0 0 0 0 8h3"/></svg>
            </button>
        </div>

        <button type="button" class="ps-sheet-btn" x-show="creatable" x-on:click="addRow()" :disabled="readOnly || saving" :title="t.add_row + ' (' + keyLabel('add_row') + ')'">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>
            <span x-text="t.add_row"></span>
        </button>

        <button type="button" class="ps-sheet-btn ps-sheet-btn-danger" x-show="deletable" x-on:click="deleteSelected()" :disabled="readOnly || saving || ! selected" :title="t.delete_rows">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>
            <span x-text="t.delete_rows"></span>
            <span class="ps-sheet-badge" x-show="selected" x-text="selected"></span>
        </button>

        <label class="ps-sheet-field ps-sheet-search" x-show="searchable">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="9" r="5"/><path d="m13 13 3.5 3.5"/></svg>
            <input type="search" x-model="search" x-on:input.debounce.400ms="refresh()" :placeholder="t.search" :aria-label="t.search">
        </label>

        <template x-for="filter in filters" :key="filter.name">
            <div class="ps-sheet-filter-wrap">
                <template x-if="filter.type === 'dateRange'">
                    <div class="ps-sheet-range ps-sheet-filter" :class="{ 'ps-sheet-filter-on': active[filter.name].from || active[filter.name].until }">
                        <span class="ps-sheet-filter-label" x-text="filter.label"></span>
                        <label class="ps-sheet-field"><input type="date" x-model="active[filter.name].from" x-on:change="refresh()" :aria-label="filter.label + ' ' + t.from"></label>
                        <span class="ps-sheet-dash">–</span>
                        <label class="ps-sheet-field"><input type="date" x-model="active[filter.name].until" x-on:change="refresh()" :aria-label="filter.label + ' ' + t.until"></label>
                    </div>
                </template>
                <template x-if="filter.type !== 'dateRange'">
                    <label class="ps-sheet-field ps-sheet-filter" :class="{ 'ps-sheet-filter-on': active[filter.name] }">
                        <span x-text="filter.label"></span>
                        <select x-model="active[filter.name]" x-on:change="refresh()">
                            <option value="" x-text="t.all"></option>
                            <template x-for="option in filter.options" :key="option.value">
                                <option :value="option.value" x-text="option.label"></option>
                            </template>
                        </select>
                    </label>
                </template>
            </div>
        </template>

        <div class="ps-sheet-spacer"></div>

        <span class="ps-sheet-pill ps-sheet-pill-readonly" x-show="readOnly" x-text="t.read_only_badge"></span>
        <button type="button" class="ps-sheet-pill ps-sheet-pill-errors" x-show="errorCount" x-on:click="nextError()" x-text="errorsLabel()" :title="t.next_error"></button>
        <span class="ps-sheet-pill ps-sheet-pill-dirty" x-show="dirty.total" x-text="changesLabel()"></span>

        <nav class="ps-sheet-pager" :aria-label="t.page_of.replace(':page', page).replace(':pages', lastPage)">
            <button type="button" class="ps-sheet-seg-btn" x-on:click="prev()" :disabled="loading || page <= 1" :aria-label="t.previous">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>
            </button>
            <span class="ps-sheet-pager-text" x-text="t.page_of.replace(':page', page).replace(':pages', lastPage)"></span>
            <button type="button" class="ps-sheet-seg-btn" x-on:click="next()" :disabled="loading || page >= lastPage" :aria-label="t.next">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>
            </button>
            <label class="ps-sheet-field ps-sheet-per-page">
                <select x-model.number="perPage" x-on:change="setPerPage(perPage)" :aria-label="t.per_page">
                    <template x-for="n in pageSizes" :key="n">
                        <option :value="n" :selected="n === perPage" x-text="n"></option>
                    </template>
                </select>
            </label>
            <span class="ps-sheet-count" x-text="rowsLabel()"></span>
        </nav>
    </div>

    <div class="ps-sheet-grid" x-ref="grid" x-on:contextmenu.prevent="openMenu($event)"></div>

    {{-- Discard and Delete rows ask here (showModal: focus kept inside, Escape cancels); a click on the backdrop cancels too --}}
    <dialog class="ps-sheet-dialog" x-ref="dialog" x-on:close="dialogClosed()" x-on:click="if ($event.target === $refs.dialog) $refs.dialog.close('cancel')" :aria-label="dialog ? dialog.text : ''">
        <form method="dialog" class="ps-sheet-dialog-box">
            <p class="ps-sheet-dialog-text" x-text="dialog ? dialog.text : ''"></p>
            <div class="ps-sheet-dialog-actions">
                <button type="submit" value="cancel" class="ps-sheet-btn" x-text="t.cancel"></button>
                <button type="submit" value="ok" class="ps-sheet-btn" :class="dialog && dialog.danger ? 'ps-sheet-btn-danger' : 'ps-sheet-btn-primary'" x-ref="dialogOk" x-text="dialog ? dialog.confirm : ''"></button>
            </div>
        </form>
    </dialog>

    {{-- always rendered: a live region announces a change only when it existed before it --}}
    <div class="ps-sheet-hint" role="status" aria-live="polite" :class="hint ? '' : (status && 'ps-sheet-hint-' + status.kind)" x-text="hint ?? (status ? status.text : '')"></div>

    {{-- x-show and :style share the style attribute: object syntax keeps the display x-show sets --}}
    <div
        class="ps-sheet-menu"
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
        <template x-for="item in (menu ? menu.items : [])" :key="item.name">
            <button type="button" class="ps-sheet-menu-item" :class="item.color && 'ps-sheet-menu-item-' + item.color" role="menuitem" x-on:click="runMenu(item.name)" x-text="item.label"></button>
        </template>
    </div>
</div>
