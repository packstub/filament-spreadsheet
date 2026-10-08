{{--
    The filter fields, one Filament input wrapper per filter (a select, or two dates for a range), the label as the
    wrapper's prefix; `$stacked` lays them one under the other (the dropdown panel). Included by spreadsheet.blade.php
    where the sheet's filtersLayout() puts them.
--}}
@php
    use Illuminate\Support\HtmlString;

    $filterLabel = new HtmlString('<span x-text="filter.label"></span>');
    $stacked ??= false;
@endphp
<template x-for="filter in filters" :key="filter.name">
    <div @class(['ps-sheet-filter-wrap', 'ps-sheet-filter-stacked' => $stacked])>
        <template x-if="filter.type === 'dateRange'">
            <div class="ps-sheet-range ps-sheet-filter" :class="{ 'ps-sheet-filter-on': active[filter.name].from || active[filter.name].until }">
                <x-filament::input.wrapper :prefix="$filterLabel" class="ps-sheet-field">
                    <x-filament::input type="date" x-model="active[filter.name].from" x-on:change="refresh()" x-bind:aria-label="filter.label + ' ' + t.from" />
                </x-filament::input.wrapper>
                <span class="ps-sheet-dash">–</span>
                <x-filament::input.wrapper class="ps-sheet-field">
                    <x-filament::input type="date" x-model="active[filter.name].until" x-on:change="refresh()" x-bind:aria-label="filter.label + ' ' + t.until" />
                </x-filament::input.wrapper>
            </div>
        </template>
        <template x-if="filter.type !== 'dateRange'">
            <x-filament::input.wrapper :prefix="$filterLabel" class="ps-sheet-field ps-sheet-filter" x-bind:class="{ 'ps-sheet-filter-on': active[filter.name] }">
                <x-filament::input.select x-model="active[filter.name]" x-on:change="refresh()" x-bind:aria-label="filter.label">
                    <option value="" x-text="t.all"></option>
                    <template x-for="option in filter.options" :key="option.value">
                        <option :value="option.value" x-text="option.label"></option>
                    </template>
                </x-filament::input.select>
            </x-filament::input.wrapper>
        </template>
    </div>
</template>
