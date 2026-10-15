{{--
    Filament's own date picker (the Alpine component behind DatePicker), driven by the
    component instead of a form: the value flows in through x-effect, a pick flows out
    as a `ps-sheet-pick` event (the day as `Y-m-d H:i:s`, or null when cleared). The
    markup follows Filament's DateTimePicker::toEmbeddedHtml() so the forms stylesheet
    styles it; only the state binding and the pick event differ.

    @param  string  $model  the expression holding a `Y-m-d` string (`active[filter.name].from`)
    @param  string  $pick   what to run on a pick, with `$event.detail`
    @param  string  $label  a JS expression for the accessible name
--}}
@php
    // The sheet's date format (what a date cell shows, the config's `date_format`) and first day of the week.
    $displayFormat = convert_date_format(config('packstub-spreadsheet.date_format') ?? 'M j, Y')->to('day.js');
    $firstDayOfWeek ??= (int) config('packstub-spreadsheet.first_day_of_week', 1);
@endphp
<div
    x-load
    x-load-src="{{ \Filament\Support\Facades\FilamentAsset::getAlpineComponentSrc('date-time-picker', 'filament/forms') }}"
    x-data="dateTimePickerFormComponent({
        defaultFocusedDate: null,
        displayFormat: @js($displayFormat),
        firstDayOfWeek: {{ (int) ($firstDayOfWeek ?? 1) }},
        isAutofocused: false,
        locale: @js(str_replace('_', '-', app()->getLocale())),
        shouldCloseOnDateSelection: true,
        state: null,
    })"
    x-effect="state = ({{ $model }}) || null"
    x-on:ps-sheet-pick="{{ $pick }}"
    x-on:keydown.esc="isOpen() && $event.stopPropagation()"
    class="fi-fo-date-time-picker"
>
    <input x-ref="maxDate" type="hidden" value="" />
    <input x-ref="minDate" type="hidden" value="" />
    <input x-ref="disabledDates" type="hidden" value="[]" />

    <button
        x-ref="button"
        x-on:click="togglePanelVisibility()"
        x-on:keydown.enter.prevent.stop="isOpen() ? (selectDate(), $dispatch('ps-sheet-pick', state)) : togglePanelVisibility()"
        x-on:keydown.arrow-left.prevent.stop="focusPreviousDay()"
        x-on:keydown.arrow-right.prevent.stop="focusNextDay()"
        x-on:keydown.arrow-up.prevent.stop="focusPreviousWeek()"
        x-on:keydown.arrow-down.prevent.stop="focusNextWeek()"
        x-on:keydown.backspace.prevent.stop="clearState(); $dispatch('ps-sheet-pick', null)"
        x-on:keydown.delete.prevent.stop="clearState(); $dispatch('ps-sheet-pick', null)"
        x-bind:aria-label="{{ $label }}"
        type="button"
        class="fi-fo-date-time-picker-trigger"
    >
        <input readonly x-model="displayText" x-bind:aria-label="{{ $label }}" class="fi-fo-date-time-picker-display-text-input" />
    </button>

    <div
        x-ref="panel"
        x-cloak
        x-float.placement.bottom-start.offset.flip.shift="{ offset: 8 }"
        class="fi-fo-date-time-picker-panel"
    >
        <div class="fi-fo-date-time-picker-panel-header">
            <select aria-label="{{ __('filament-forms::components.date_time_picker.month_select.label') }}" x-model="focusedMonth" class="fi-fo-date-time-picker-month-select">
                <template x-for="(month, index) in months">
                    <option x-bind:value="index" x-text="month"></option>
                </template>
            </select>
            <input type="number" inputmode="numeric" aria-label="{{ __('filament-forms::components.date_time_picker.year_input.label') }}" x-model.debounce="focusedYear" class="fi-fo-date-time-picker-year-input" />
        </div>

        <div class="fi-fo-date-time-picker-calendar-header">
            <template x-for="(day, index) in dayLabels" x-bind:key="index">
                <div x-text="day" class="fi-fo-date-time-picker-calendar-header-day"></div>
            </template>
        </div>

        <div role="grid" class="fi-fo-date-time-picker-calendar">
            <template x-for="day in emptyDaysInFocusedMonth" x-bind:key="day">
                <div></div>
            </template>
            <template x-for="day in daysInFocusedMonth" x-bind:key="day">
                <div
                    x-text="day"
                    x-on:click="dayIsDisabled(day) || (selectDate(day), $dispatch('ps-sheet-pick', state))"
                    x-on:mouseenter="setFocusedDay(day)"
                    role="option"
                    x-bind:aria-selected="focusedDate.date() === day"
                    x-bind:class="{
                        'fi-fo-date-time-picker-calendar-day-today': dayIsToday(day),
                        'fi-focused': focusedDate.date() === day,
                        'fi-selected': dayIsSelected(day),
                        'fi-disabled': dayIsDisabled(day),
                    }"
                    class="fi-fo-date-time-picker-calendar-day"
                ></div>
            </template>
        </div>
    </div>
</div>
