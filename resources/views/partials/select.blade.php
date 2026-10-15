{{--
    Filament's own select (the component behind Select, searchable or not, single or
    multiple), driven by the component instead of a form: the options come with the
    config or from a renderless search (`$wire.spreadsheetFilterOptions`), a choice flows
    out as a `ps-sheet-select` event. The markup follows Select::toEmbeddedHtml(); the
    messages are Filament's own strings. Rendered inside `x-for="filter in filters"`,
    with `active[filter.name]` holding '' (none), a value, or a list for a multiple.
--}}
<div
    x-load
    x-load-src="{{ \Filament\Support\Facades\FilamentAsset::getAlpineComponentSrc('select', 'filament/forms') }}"
    x-data="selectFormComponent({
        canOptionLabelsWrap: false,
        canSelectPlaceholder: true,
        clearButtonLabel: @js(__('filament-forms::components.select.actions.clear.label')),
        getOptionLabelUsing: async () => await $wire.spreadsheetFilterOptionLabel(filter.name, active[filter.name] || null),
        getOptionLabelsUsing: async () => await $wire.spreadsheetFilterOptionLabels(filter.name, active[filter.name] || []),
        getOptionsUsing: async () => await $wire.spreadsheetFilterOptions(filter.name),
        getSearchResultsUsing: async (search) => await $wire.spreadsheetFilterOptions(filter.name, search),
        hasDynamicOptions: filter.searchable && ! filter.options.length,
        hasDynamicSearchResults: filter.searchable,
        hasInitialNoOptionsMessage: false,
        id: 'ps-sheet-filter-' + filter.name,
        initialOptionLabel: null,
        initialOptionLabels: [],
        initialState: filter.multiple ? (active[filter.name] || []) : (active[filter.name] || null),
        isAutofocused: false,
        isDisabled: false,
        isHtmlAllowed: false,
        isMultiple: filter.multiple,
        isReorderable: false,
        isSearchable: filter.searchable,
        livewireId: $wire.__instance?.id ?? null,
        loadingMessage: @js(__('filament-forms::components.select.loading_message')),
        maxItems: null,
        maxItemsMessage: null,
        noOptionsMessage: @js(__('filament-forms::components.select.no_options_message')),
        noSearchResultsMessage: @js(__('filament-forms::components.select.no_search_results_message')),
        options: filter.options,
        optionsLimit: filter.optionsLimit ?? 50,
        placeholder: t.all,
        position: null,
        removeButtonLabel: @js(__('filament-forms::components.select.actions.remove_option.label')),
        searchDebounce: 400,
        searchingMessage: @js(__('filament-forms::components.select.searching_message')),
        searchLabel: @js(__('filament-forms::components.select.search_label')),
        searchPrompt: @js(__('filament-forms::components.select.search_prompt')),
        searchableOptionFields: ['label'],
        state: filter.multiple ? (active[filter.name] || []) : (active[filter.name] || null),
        statePath: 'spreadsheet.' + filter.name,
    })"
    x-init="$watch('state', (value) => $dispatch('ps-sheet-select', value))"
    {{-- the component's state flows in (Reset filters, a value restored); a pick flows out through the watcher, and pickSelect() ignores one that changes nothing --}}
    x-effect="state = filter.multiple ? (active[filter.name] || []) : (active[filter.name] || null)"
    x-on:ps-sheet-select="pickSelect(filter.name, $event.detail)"
    x-on:keydown.esc="select.dropdown.isActive && $event.stopPropagation()"
    x-bind:aria-label="filter.label"
    class="fi-select-input"
>
    <div x-ref="select"></div>
</div>
