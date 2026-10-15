{{--
    The filter fields, one per filter, Filament's own components: a select (plain,
    multiple or searchable: partials.select) and a Yes / No select in the input
    wrapper with the label as its prefix, a checkbox with its label for a toggle, two
    date pickers (partials.date-picker) for a range. `$stacked` lays them one under
    the other with the label above each field, as a table's filter form (the dropdown
    panel and the "above" row); inline (the toolbar) the label is the wrapper's prefix.
    Included by the component's view where its filtersLayout() puts them, inside
    `x-for="filter in filters"` is done here.
--}}
@php
    use Illuminate\Support\HtmlString;

    $filterLabel = new HtmlString('<span x-text="filter.label"></span>');
    $stacked ??= false;
@endphp
<template x-for="filter in filters" :key="filter.name">
    <div @class(['ps-sheet-filter', 'ps-sheet-filter-stacked' => $stacked]) :class="{ 'ps-sheet-filter-on': isActive(filter) }">
        @if ($stacked)
            <label class="ps-sheet-filter-label" :for="'ps-sheet-filter-' + filter.name" x-show="filter.type !== 'toggle'" x-text="filter.label"></label>
        @endif

        {{-- one option, several, or a search: Filament's select --}}
        <template x-if="filter.type === 'select' || filter.type === 'boolean'">
            @if ($stacked)
                <x-filament::input.wrapper class="ps-sheet-field">
                    @include('packstub-spreadsheet::partials.select')
                </x-filament::input.wrapper>
            @else
                <x-filament::input.wrapper :prefix="$filterLabel" class="ps-sheet-field">
                    @include('packstub-spreadsheet::partials.select')
                </x-filament::input.wrapper>
            @endif
        </template>

        {{-- on or off: a checkbox with the label --}}
        <template x-if="filter.type === 'toggle'">
            <label class="ps-sheet-toggle">
                <x-filament::input.checkbox x-bind:checked="active[filter.name] === true" x-on:change="toggleFilter(filter)" x-bind:aria-label="filter.label" />
                <span x-text="filter.label"></span>
            </label>
        </template>

        {{-- from / until --}}
        <template x-if="filter.type === 'dateRange'">
            <div class="ps-sheet-range">
                <x-filament::input.wrapper class="ps-sheet-field">
                    <x-slot name="prefix"><span x-text="{{ $stacked ? 't.from' : 'filter.label' }}"></span></x-slot>
                    @include('packstub-spreadsheet::partials.date-picker', ['model' => 'active[filter.name].from', 'pick' => "pickFilter(filter.name, 'from', \$event.detail)", 'label' => "filter.label + ' ' + t.from"])
                </x-filament::input.wrapper>
                <x-filament::input.wrapper class="ps-sheet-field">
                    <x-slot name="prefix"><span x-text="{{ $stacked ? 't.until' : "'–'" }}"></span></x-slot>
                    @include('packstub-spreadsheet::partials.date-picker', ['model' => 'active[filter.name].until', 'pick' => "pickFilter(filter.name, 'until', \$event.detail)", 'label' => "filter.label + ' ' + t.until"])
                </x-filament::input.wrapper>
            </div>
        </template>
    </div>
</template>
