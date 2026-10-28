{{--
    Filament's own date picker (the Alpine component behind DatePicker), driven by the
    component instead of a form: the value flows in through x-effect, a pick flows out
    as a `ps-sheet-pick` event (the day as `Y-m-d H:i:s`, or null when cleared). The
    markup follows Filament's DateTimePicker::toEmbeddedHtml() so the forms stylesheet
    styles it; only the state binding and the pick event differ.

    Two shapes of the component are served: up to Filament 5.9 / 4.15 the panel is an
    `x-float` popover (`$refs.panel.toggle()`) over a flat list of days; from 5.10 / 4.16
    the component keeps `isPanelOpen` itself, positions the panel, lays the month out
    in rows of seven (`weeksInFocusedMonth`), focuses a day by its `data-date` and
    handles the keys on the trigger and the grid. Each attribute below asks which one
    it is talking to, so one partial serves both.

    @param  string  $model  the expression holding a `Y-m-d` string (`active[filter.name].from`)
    @param  string  $pick   what to run on a pick, with `$event.detail`
    @param  string  $label  a JS expression for the accessible name
--}}
@php
    $displayFormat = convert_date_format(config('packstub-spreadsheet.date_format') ?? 'M j, Y')->to('day.js');
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
    {{-- 5.10+ closes its own panel; before, x-float closes on a click outside --}}
    x-on:click.outside="typeof isPanelOpen !== 'undefined' && isOpen() && closePanel()"
    x-on:focusout="typeof handleFocusOut === 'function' ? handleFocusOut($event) : (isOpen() && ! $el.contains($event.relatedTarget) && $refs.panel.close())"
    x-on:keydown.esc="if (isOpen()) { $event.stopPropagation(); if (typeof isPanelOpen !== 'undefined') { $event.preventDefault(); closePanel(true) } }"
    class="fi-fo-date-time-picker"
>
    <input x-ref="maxDate" type="hidden" value="" />
    <input x-ref="minDate" type="hidden" value="" />
    <input x-ref="disabledDates" type="hidden" value="[]" />

    <button
        x-ref="button"
        x-on:click="togglePanelVisibility()"
        x-on:keydown.enter.prevent.stop="isOpen() ? (selectDate(), $dispatch('ps-sheet-pick', state)) : togglePanelVisibility()"
        x-on:keydown.space.prevent.stop="typeof handleTriggerKeydown === 'function' ? handleTriggerKeydown($event) : togglePanelVisibility()"
        x-on:keydown.arrow-left.prevent.stop="typeof handleTriggerKeydown === 'function' ? handleTriggerKeydown($event) : focusPreviousDay()"
        x-on:keydown.arrow-right.prevent.stop="typeof handleTriggerKeydown === 'function' ? handleTriggerKeydown($event) : focusNextDay()"
        x-on:keydown.arrow-up.prevent.stop="typeof handleTriggerKeydown === 'function' ? handleTriggerKeydown($event) : focusPreviousWeek()"
        x-on:keydown.arrow-down.prevent.stop="typeof handleTriggerKeydown === 'function' ? handleTriggerKeydown($event) : focusNextWeek()"
        x-on:keydown.backspace.prevent.stop="clearState(); $dispatch('ps-sheet-pick', null)"
        x-on:keydown.delete.prevent.stop="clearState(); $dispatch('ps-sheet-pick', null)"
        x-bind:aria-label="{{ $label }}"
        x-bind:aria-expanded="isOpen() ? 'true' : 'false'"
        type="button"
        class="fi-fo-date-time-picker-trigger"
    >
        <input readonly x-model="displayText" x-bind:aria-label="{{ $label }}" class="fi-fo-date-time-picker-display-text-input" />
    </button>

    <div
        x-ref="panel"
        x-cloak
        role="dialog"
        x-bind:aria-label="{{ $label }}"
        x-float.placement.bottom-start.offset.flip.shift="{ offset: 8 }"
        {{-- 5.10+ shows the panel from isPanelOpen and sets left/top itself; before, x-float toggles the display --}}
        x-bind:style="typeof isPanelOpen === 'undefined' ? {} : { display: isPanelOpen ? 'block' : 'none' }"
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

        <div
            x-ref="calendar"
            role="grid"
            tabindex="-1"
            x-on:keydown="typeof handleCalendarKeydown === 'function' && handleCalendarKeydown($event)"
            class="fi-fo-date-time-picker-calendar"
        >
            {{-- Filament 5.10+ and 4.16+ lay the month out in rows of seven (null for a blank cell) --}}
            <template x-if="typeof weeksInFocusedMonth !== 'undefined'">
                <div style="display: contents">
                    <template x-for="(week, weekIndex) in weeksInFocusedMonth" x-bind:key="weekIndex">
                        <div role="row" class="fi-fo-date-time-picker-calendar-week">
                            <template x-for="(day, dayIndex) in week" x-bind:key="day ?? ('empty-' + dayIndex)">
                                <div
                                    role="gridcell"
                                    x-text="day"
                                    x-bind:data-date="day ? focusedDate.date(day).format('YYYY-MM-DD') : null"
                                    x-bind:tabindex="day ? (focusedDate.date() === day ? 0 : -1) : null"
                                    x-on:focus="day && setFocusedDay(day)"
                                    x-on:click="if (day && ! dayIsDisabled(day)) { $el.focus(); selectDate(day); $dispatch('ps-sheet-pick', state) }"
                                    x-on:mouseenter="day && setFocusedDay(day)"
                                    x-bind:aria-selected="day && dayIsSelected(day) ? 'true' : 'false'"
                                    x-bind:aria-disabled="day && dayIsDisabled(day) ? 'true' : 'false'"
                                    x-bind:class="{
                                        'fi-fo-date-time-picker-calendar-day': day,
                                        'fi-fo-date-time-picker-calendar-day-today': day && dayIsToday(day),
                                        'fi-focused': day && focusedDate.date() === day,
                                        'fi-selected': day && dayIsSelected(day),
                                        'fi-disabled': day && dayIsDisabled(day),
                                    }"
                                ></div>
                            </template>
                        </div>
                    </template>
                </div>
            </template>
            {{-- Filament up to 5.9 and 4.15: the month's leading blanks, then its days, on one grid --}}
            <template x-if="typeof weeksInFocusedMonth === 'undefined'">
                <div style="display: contents">
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
            </template>
        </div>
    </div>
</div>
