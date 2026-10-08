/**
 * packstub/filament-spreadsheet — the grid adapter.
 *
 * The only file that knows Tabulator. It turns the sheet's column definitions
 * into Tabulator columns, Tabulator's events into a small set of callbacks the
 * Alpine component understands (edit, rangeEdit, sort, paste, select, context),
 * and offers the handful of operations the component needs (set rows, update
 * rows, repaint, the selection, start editing, navigate). Swapping the engine
 * means rewriting this file only.
 *
 * Every row handed to the grid is a flat object { id, <column>: value…, _m }
 * where _m carries what the cells paint: { dirty, errors, conflicts, locked,
 * readOnly, deleted, created, rowError }.
 */

import {
    AccessorModule,
    ClipboardModule,
    EditModule,
    ExportModule,
    FormatModule,
    FrozenColumnsModule,
    InteractionModule,
    KeybindingsModule,
    ResizeColumnsModule,
    ResizeTableModule,
    SelectRangeModule,
    Tabulator,
} from 'tabulator-tables'
import { display, phpDate } from './sheet.js'

Tabulator.registerModule([
    AccessorModule, ClipboardModule, EditModule, ExportModule, FormatModule,
    FrozenColumnsModule, InteractionModule, KeybindingsModule, ResizeColumnsModule, ResizeTableModule, SelectRangeModule,
])

const ROWNUM = '_rownum'

/** An <input type="date"> / <input type="datetime-local"> editor on ISO strings, the wire format. */
function isoEditor(withTime) {
    return function (cell, onRendered, success, cancel) {
        const input = document.createElement('input')
        input.type = withTime ? 'datetime-local' : 'date'
        input.className = 'ps-sheet-editor'
        const value = cell.getValue()
        if (value) {
            const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(String(value))
            if (m) input.value = withTime ? `${m[1]}T${m[2] ?? '00:00'}` : m[1]
        }
        onRendered(() => { input.focus({ preventScroll: true }); input.style.height = '100%' })
        // A picked date fires change and then blur (Enter and Escape are followed by a blur too): the first one settles the edit.
        let settled = false
        const once = (fn) => { if (settled) return; settled = true; fn() }
        const done = () => once(() => {
            const v = input.value
            // A part missing (the day cleared, a year not typed yet) reads as '' with badInput: not a cleared
            // date, the cell keeps its value. Every part cleared reads as '' without it: that one empties the cell.
            if (! v && input.validity.badInput) { cancel(); return }
            success(v ? (withTime ? v.replace('T', ' ') + ':00' : v) : null)
        })
        // A typed date fires change on every key that alters the value (each digit, Backspace, an arrow
        // that steps a segment): only Enter, Tab or a blur settle that one. The pointer going down on the
        // field (its calendar button) makes the next change a picked date again.
        let keyed = false
        // A digit typed on the selected cell opened this editor (api.edit()): the field takes that digit as its
        // default action and never sees the keydown, so the grid says the change that follows is a typed one.
        input.addEventListener('ps-keyed', () => { keyed = true })
        input.addEventListener('pointerdown', () => { keyed = false })
        input.addEventListener('change', () => { if (! keyed) done() })
        input.addEventListener('blur', done)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(); return }
            if (e.key === 'Escape') { once(cancel); return }
            if (e.key === 'Tab') return
            keyed = true
            // ArrowUp / ArrowDown step the focused segment: the grid's own arrows (commit, next row) never see them.
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation()
        })

        return input
    }
}

/** A cell's classes and tooltip from its row's meta; called by every formatter. */
function paint(cell, column, t) {
    const el = cell.getElement()
    if (! el || ! el.classList) return
    const m = cell.getRow().getData()._m ?? {}
    const name = column.name
    const error = m.errors?.[name]
    const conflict = m.conflicts ? m.conflicts[name] : undefined
    const hasConflict = m.conflicts && Object.prototype.hasOwnProperty.call(m.conflicts, name)
    const locked = ! column.editable || column.readOnly || m.readOnly || (Array.isArray(m.locked) && m.locked.includes(name))

    el.classList.toggle('ps-sheet-cell-dirty', !! m.dirty?.[name])
    el.classList.toggle('ps-sheet-cell-error', !! error)
    el.classList.toggle('ps-sheet-cell-conflict', !! hasConflict)
    el.classList.toggle('ps-sheet-cell-locked', locked)

    let title = ''
    if (error) title = error
    else if (hasConflict) title = `${t.conflict}\n${t.your_value}: ${display(column, cell.getValue())}\n${t.their_value}: ${display(column, conflict)}`
    if (title) el.setAttribute('title', title)
    else el.removeAttribute('title')
    // A refused cell says so to assistive tech as well as by its colour (the message is in the title and the status line).
    if (error) el.setAttribute('aria-invalid', 'true')
    else el.removeAttribute('aria-invalid')
}

function baseFormatter(column, locale) {
    switch (column.type) {
        case 'boolean':
            return (cell) => {
                const v = cell.getValue()
                if (v === null || v === undefined || v === '') return ''

                return v ? '<svg class="ps-sheet-tick" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 10 3.5 3.5L15 7"/></svg>' : '<svg class="ps-sheet-cross" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"/></svg>'
            }
        case 'select':
            return (cell) => escapeHtml(display(column, cell.getValue()))
        case 'number':
        case 'computed':
            return (cell) => {
                const v = cell.getValue()
                if (v === null || v === undefined || v === '') return ''
                if (typeof v === 'boolean' && column.type === 'computed') return v ? 'true' : 'false'
                if (typeof v !== 'number') return escapeHtml(String(v))

                return new Intl.NumberFormat(locale, { minimumFractionDigits: column.decimals ?? 0, maximumFractionDigits: column.decimals ?? 20, useGrouping: false }).format(v)
            }
        case 'date':
        case 'datetime':
            return (cell) => {
                const v = cell.getValue()

                return v ? escapeHtml(column.format ? phpDate(String(v), column.format, locale) : String(v)) : ''
            }
        default:
            return (cell) => {
                const v = cell.getValue()

                return v === null || v === undefined ? '' : escapeHtml(String(v))
            }
    }
}

function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

/** The empty-table message as an element (a string would be set as innerHTML). */
function placeholder(text) {
    const el = document.createElement('div')
    el.className = 'tabulator-placeholder-contents'
    el.textContent = text ?? ''

    return el
}

/** An element carrying a string as text: what Tabulator would otherwise set as innerHTML. */
function textNode(text) {
    const el = document.createElement('span')
    el.textContent = text === null || text === undefined ? '' : String(text)

    return el
}

function editorFor(column) {
    switch (column.type) {
        case 'boolean':
            // No editor: a double-click, Enter or Space flips the cell (see toggleBoolean).
            return { editor: false }
        case 'select':
            return {
                editor: 'list',
                editorParams: {
                    values: (column.options ?? []).map((o) => ({ label: o.label, value: o.value })),
                    autocomplete: true,
                    listOnEmpty: true,
                    allowEmpty: true,
                    selectContents: true,
                    // Labels are data (a category's name, a related record's title): the list shows them as text, never as HTML.
                    itemFormatter: (label) => textNode(label),
                    filterFunc: (term, label) => String(label).toLowerCase().includes(String(term).toLowerCase()),
                },
            }
        case 'date':
            return { editor: isoEditor(false) }
        case 'datetime':
            return { editor: isoEditor(true) }
        case 'computed':
            return { editor: false }
        default:
            return { editor: 'input', editorParams: { selectContents: true, ...(column.maxLength ? { elementAttributes: { maxlength: String(column.maxLength) } } : {}) } }
    }
}

/**
 * Build the grid. `options`:
 *   columns, rowHeight, frozenFirstColumn, readOnly, locale, t (strings)
 *   rowOffset()         the number of the first row on the page, minus one
 *   sortState()         { column, direction } for the header arrows
 *   saving()            true while a save is in flight: no cell is editable then
 *   on.edit(id, col, from, to)          one cell edited in place
 *   on.rangeEdit([{ id, col, from, to }])  cells written by the fill handle (the component re-checks each)
 *   on.sort(col)                        header clicked
 *   on.paste(text)                      text pasted into the grid
 *   on.select(count, ids)               rows in the active range, and their ids
 *   on.rows(count)                      the table's rows changed (a page applied, rows added or removed)
 *   on.editing(open)                    an editor opened or closed
 *
 * Delete/Backspace and Ctrl+X are the component's (clear() through its own
 * editability check), never Tabulator's range clearing; a right-click is the
 * view's contextmenu handler with rowAt().
 */
export function createGrid(element, options) {
    const { columns, t, locale = 'en', readOnly = false, on = {} } = options
    const sortState = options.sortState ?? (() => ({ column: null, direction: 'asc' }))
    const saving = options.saving ?? (() => false)

    const editableCell = (cell) => {
        if (readOnly || saving()) return false
        const column = columns.find((c) => c.name === cell.getField())
        if (! column || ! column.editable || column.readOnly) return false
        const m = cell.getRow().getData()._m ?? {}
        if (m.readOnly || m.deleted) return false

        return ! (Array.isArray(m.locked) && m.locked.includes(column.name))
    }

    const defs = columns.map((column, i) => {
        const base = baseFormatter(column, locale)
        const def = {
            title: column.label,
            field: column.name,
            width: column.width ?? undefined,
            minWidth: { number: 90, date: 120, datetime: 160, boolean: 70 }[column.type] ?? 80,
            frozen: column.frozen || (options.frozenFirstColumn && i === 0),
            hozAlign: column.type === 'number' || (column.type === 'computed' && column.decimals != null) ? 'right' : column.type === 'boolean' ? 'center' : 'left',
            cssClass: `ps-sheet-col-${column.type}`,
            formatter: (cell) => { paint(cell, column, t); return base(cell) },
            titleFormatter: (cell) => {
                const s = sortState()
                const arrow = s.column === column.name ? (s.direction === 'desc' ? ' ▼' : ' ▲') : ''
                const el = document.createElement('span')
                el.className = 'ps-sheet-title'
                el.textContent = column.label + arrow

                return el
            },
            headerClick: (e, col) => { if (column.sortable) on.sort?.(column.name) },
            cellDblClick: (e, cell) => { if (column.type === 'boolean') toggleBoolean(cell) },
            accessorClipboard: (value) => display(column, value, locale),
            editable: editableCell,
            editorEmptyValue: null,
            ...editorFor(column),
        }
        if (column.sortable) def.cssClass += ' ps-sheet-col-sortable'
        if (! column.editable || column.readOnly) def.cssClass += ' ps-sheet-col-readonly'

        return def
    })

    /** The row's classes from its meta (deleted, new, read-only, refused). */
    const rowClasses = (rowComponent) => {
        const el = rowComponent.getElement()
        if (! el || ! el.classList) return
        const m = rowComponent.getData()._m ?? {}
        el.classList.toggle('ps-sheet-row-deleted', !! m.deleted)
        el.classList.toggle('ps-sheet-row-created', !! m.created)
        el.classList.toggle('ps-sheet-row-readonly', !! m.readOnly)
        el.classList.toggle('ps-sheet-row-error', !! m.rowError)
    }

    const toggleBoolean = (cell) => {
        if (! editableCell(cell)) return false
        cell.setValue(cell.getValue() === true ? false : true)

        return true
    }

    const table = new Tabulator(element, {
        data: [],
        index: 'id',
        // The grid's own height, never '100%': the element is .ps-sheet-grid itself, its parent has no
        // height, so a percentage would resolve to "as tall as the rows" and nothing would be windowed.
        // The variable is set on .ps-sheet (the stylesheet's default, or the page's getSpreadsheetHeight()).
        height: 'var(--ps-sheet-height)',
        layout: 'fitDataStretch',
        renderHorizontal: 'virtual',
        renderVertical: 'virtual',
        rowHeight: options.rowHeight ?? 32,
        placeholder: placeholder(t.empty),
        rowHeader: {
            field: ROWNUM,
            resizable: false,
            frozen: true,
            width: 56,
            minWidth: 40,
            hozAlign: 'center',
            cssClass: 'ps-sheet-rownum',
            editor: false,
            formatter: (cell) => {
                const m = cell.getRow().getData()._m ?? {}
                rowClasses(cell.getRow())
                const el = cell.getElement()
                if (el && m.rowError) el.setAttribute('title', m.rowError)
                else if (el) el.removeAttribute('title')
                if (m.created) return '+'

                return String((options.rowOffset?.() ?? 0) + cell.getRow().getPosition())
            },
        },
        selectableRange: 1,
        // A header click sorts (server-side); selecting whole columns would make it a selection too.
        selectableRangeColumns: false,
        selectableRangeRows: true,
        // Tabulator's Delete would clear locked and computed cells too: the component handles the key (see clearSelection()).
        selectableRangeClearCells: false,
        selectableRangeFill: ! readOnly,
        editTriggerEvent: 'dblclick',
        clipboard: 'copy',
        clipboardCopyRowRange: 'range',
        clipboardCopyStyled: false,
        clipboardCopyConfig: { columnHeaders: false, rowHeaders: false, columnGroups: false, columnCalcs: false, formatCells: false },
        // No headerSort: the Sort module is not registered (a header click asks the server), and Tabulator warns
        // about the option on every column without it.
        columnDefaults: { resizable: 'header', headerHozAlign: 'left' },
        columns: defs,
    })

    // Tabulator hands the focus back to the holder when an editor closes, without preventScroll: on a
    // sheet taller than the window the page would jump under the pointer, and a click that closed the
    // editor (on Save, say) would land somewhere else. The holder never scrolls the page for the focus.
    //
    // And it never takes the focus from a field the pointer just went down on: a click into the
    // search box with an editor open closes the editor (Tabulator's own mousedown listener), which
    // focuses the holder before the browser focuses the clicked field, and the click would end in the
    // grid. A pointer-down outside the grid is remembered for the current tick; Tabulator's focus is
    // dropped meanwhile. api.focus() (the component's refocus()) goes to the original directly. A select
    // editor's option list is the grid's own although Tabulator appends it to the body: picking an option
    // with the mouse hands the keyboard back to the grid as before.
    //
    // With the holder not focused there is no focusout from the grid either, and an editor closed
    // without a change (a date editor left as it was) fires no edit event: the editing state is
    // reported once the tick is over.
    const holder = table.rowManager?.element
    const focusHolder = holder ? holder.focus.bind(holder) : () => {}
    let outside = false
    const pointerDown = (e) => {
        outside = ! element.contains(e.target) && ! e.target?.closest?.('.tabulator-popup-container')
        const was = outside
        setTimeout(() => {
            outside = false
            if (was && ! destroyed) on.editing?.(api.isEditing())
        }, 0)
    }
    document.addEventListener('mousedown', pointerDown, true)
    if (holder) {
        holder.focus = (options) => {
            if (outside) return
            focusHolder({ ...(options ?? {}), preventScroll: true })
        }
    }

    // An editable cell has a tabindex (Tabulator's Edit module), so a click on one while an editor is open
    // focuses that cell: the browser's focus follows Tabulator's holder.focus() in the editor's blur and
    // wins. The keyboard then lives on a cell element, which goes away when its row leaves the window, and
    // the focus with it (to the body: the sheet takes no keys until the next click). A cell that still
    // holds the focus once the tick is over, without an editor in it, hands it to the holder.
    const cellFocus = (e) => {
        const target = e.target
        if (! target?.classList?.contains('tabulator-cell')) return
        setTimeout(() => {
            if (destroyed || document.activeElement !== target || target.classList.contains('tabulator-editing')) return
            focusHolder({ preventScroll: true })
        }, 0)
    }
    element.addEventListener('focusin', cellFocus)

    let destroyed = false

    const current = new Map()

    // Tabulator builds itself asynchronously: data calls wait for it.
    const ready = new Promise((r) => table.on('tableBuilt', r))

    const remember = (rows) => {
        for (const row of rows) {
            const values = {}
            for (const c of columns) values[c.name] = row[c.name]
            current.set(String(row.id), values)
        }
    }

    table.on('cellEdited', (cell) => {
        const id = String(cell.getRow().getIndex())
        const col = cell.getField()
        const from = current.get(id)?.[col] ?? null
        const to = cell.getValue() === '' ? null : cell.getValue()
        if (current.has(id)) current.get(id)[col] = to
        on.edit?.(id, col, from, to)
    })

    // Whether an editor is open, told after the event settles (an editor that closes without a change fires no cellEdited).
    const editingChanged = () => setTimeout(() => on.editing?.(api.isEditing()), 0)
    table.on('cellEditing', editingChanged)
    table.on('cellEdited', editingChanged)
    table.on('cellEditCancelled', editingChanged)
    element.addEventListener('focusout', editingChanged)

    table.on('rangeEdited', (range) => {
        const edits = []
        for (const cell of range.getCells()) {
            const field = cell.getField()
            if (! field || field === ROWNUM) continue
            const id = String(cell.getRow().getIndex())
            const from = current.get(id)?.[field] ?? null
            const to = cell.getValue() === '' ? null : cell.getValue()
            if (current.has(id)) current.get(id)[field] = to
            edits.push({ id, col: field, from, to })
        }
        if (edits.length) on.rangeEdit?.(edits)
    })

    const selectionChanged = () => { const rows = api.selection()?.rows ?? []; on.select?.(rows.length, rows) }
    table.on('rangeAdded', selectionChanged)
    table.on('rangeChanged', selectionChanged)
    table.on('rangeRemoved', selectionChanged)
    // The rows the table holds changed (a page set, rows added or removed), also when it was asked before tableBuilt.
    table.on('dataProcessed', () => on.rows?.(table.getRows().length))

    // Ctrl+ArrowDown / Ctrl+ArrowUp (with Shift too) jump to the end of the column: Tabulator scrolls there
    // from estimated row heights and can leave the cell it jumped to outside the window. Once it has
    // handled the key, the row the range moved to is brought into view by scrollTo(), which corrects.
    // The range overlay is laid out first: Tabulator does that 200 ms after a scroll, the overlay still
    // at its old place holds the holder's scroll height until then, and the holder would move again
    // (the row out of view once more) when it lets go. Alt is not looked at: Tabulator's keybinding
    // jumps with it held too.
    const layoutRanges = () => table.modules.selectRange?.layoutRanges?.()
    const jumped = (e) => {
        if (! (e.ctrlKey || e.metaKey) || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || api.isEditing()) return
        const down = e.key === 'ArrowDown'
        setTimeout(() => {
            if (destroyed || api.isEditing()) return
            const rows = table.getRanges().at(-1)?.getRows() ?? []
            const row = down ? rows.at(-1) : rows[0]
            if (! row) return
            layoutRanges()
            api.scrollTo(row.getIndex())
        }, 0)
    }
    element.addEventListener('keydown', jumped)

    // The keys an open editor keeps from the grid, in the capture phase (Tabulator's input editor stops
    // Home / End before they bubble, and the browser's own scroll is not a binding that could be switched off).
    //
    // PageUp / PageDown / Home / End: Tabulator's bindings page or jump the grid, macOS scrolls the holder
    // on Home / End, and the row leaving the window commits the editor. They do nothing to the grid here;
    // Home / End put the caret at the start / end of a text field (with a modifier they are the field's own).
    //
    // ArrowUp / ArrowDown in a text or number editor commit and move the selection one row, as Enter and
    // Tab do, without opening the next row's editor (Tabulator's own navUp / navDown would open it). The
    // editor commits on blur, synchronously. With Alt they are the field's (the caret, on macOS); with
    // Shift, Ctrl or Meta nothing changes here. A select's option list keeps its arrows, and a date
    // editor stops them itself (see isoEditor: they step the focused segment).
    const editorKeys = (e) => {
        if (! api.isEditing()) return
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (e.shiftKey || e.ctrlKey || e.metaKey || e.target?.tagName !== 'INPUT') return
            if (table.modules.edit.currentCell?.column.definition.editor !== 'input') return
            e.stopPropagation()
            if (e.altKey) return
            e.preventDefault()
            const direction = e.key === 'ArrowUp' ? 'up' : 'down'
            e.target.blur()
            if (! api.isEditing()) api.navigate(direction)

            return
        }
        if (! ['PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) return
        e.stopPropagation()
        if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); return }
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault()
        const input = e.target
        if (input?.tagName === 'INPUT' && input.type === 'text') {
            const at = e.key === 'Home' ? 0 : input.value.length
            input.setSelectionRange(at, at)
        }
    }
    element.addEventListener('keydown', editorKeys, true)

    // Alt+ArrowLeft / Alt+ArrowRight are the browser's Back / Forward (Windows, Linux) and a text field's word
    // step (macOS). Tabulator's keybindings do not look at Alt: they would move the active cell and prevent the
    // default. The key never reaches them (capture phase, only the propagation stops); with Ctrl or Meta held it
    // is Tabulator's jump, as before.
    const altArrows = (e) => {
        if (e.altKey && ! e.ctrlKey && ! e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.stopPropagation()
    }
    element.addEventListener('keydown', altArrows, true)

    // Tabulator's keybindings read a one-character key as that character's code, and the codes of ! " # $ % & ' (
    // are 33 to 40: the key codes of PageUp, PageDown, End, Home and the four arrows. Where one of them is a key of
    // its own (an unshifted `(`, `&`, `!` or `#` on many layouts) typing it in an open editor would page the grid,
    // jump to its end or open the next row's editor instead of writing the character, and on a selected cell it
    // would do both. A character is never a grid key: it stops at the holder, in the bubble phase, after the editor
    // has had it.
    const characterKeys = (e) => {
        if (e.key.length === 1 && e.key >= '!' && e.key <= '(') e.stopPropagation()
    }
    holder?.addEventListener('keydown', characterKeys)

    // currentCell is false, not null, while nothing is edited.
    const listOpen = () => { const c = table.modules.edit.currentCell; return !! c && c.column.definition.editor === 'list' }

    // Tabulator's list editor filters its options by the field's text on every keyup but the arrows, Enter and
    // Escape: the keyup of F2 itself (the key that opened it), of a modifier, of Home / End / PageUp / PageDown
    // would shrink the list to the current label. Those never reach it. A deny-list: any other key may have
    // changed the text (a character, Backspace, Delete, an IME's `Process`).
    const LIST_KEYUPS = ['F2', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Home', 'End', 'PageUp', 'PageDown']
    const listKeyup = (e) => {
        if (listOpen() && LIST_KEYUPS.includes(e.key)) e.stopPropagation()
    }
    element.addEventListener('keyup', listKeyup, true)

    // The list editor ignores selectContents and leaves the caret after the label: a letter typed after F2 / Enter /
    // a double-click would be appended to it and match nothing. The label is selected once the editor is open, so
    // the letter replaces it and filters. Not when the cell was opened by typing (api.edit(initial)): that text stays.
    let typedOpen = false
    table.on('cellEditing', (cell) => {
        if (typedOpen || cell.getColumn().getDefinition().editor !== 'list') return
        setTimeout(() => {
            const input = document.activeElement
            if (destroyed || ! listOpen() || input?.tagName !== 'INPUT' || ! cell.getElement()?.contains(input)) return
            input.select()
        }, 0)
    })

    element.addEventListener('paste', (e) => {
        if (table.modules.edit.currentCell) return
        const text = e.clipboardData?.getData('text/plain') ?? ''
        if (text === '') return
        e.preventDefault()
        e.stopPropagation()
        on.paste?.(text)
    })

    /** The first row in the visible window: its id, its place in the list and how far its top is from the window's (negative when cut off). */
    const topRow = () => {
        if (destroyed || ! holder || holder.scrollTop <= 0) return null
        const top = holder.getBoundingClientRect().top + holder.clientTop
        const el = [...holder.querySelectorAll('.tabulator-row')].find((r) => r.getBoundingClientRect().bottom > top + 0.5)
        if (! el) return null
        const rows = table.getRows()
        const position = rows.findIndex((r) => r.getElement() === el)

        return position < 0 ? null : { id: rows[position].getIndex(), position, offset: el.getBoundingClientRect().top - top }
    }

    /** Put that row back where it was (the same id, or the row now at its place), correcting what Tabulator's estimates leave. */
    const restoreTop = async (anchor) => {
        const rows = table.getRows()
        const row = rows.find((r) => String(r.getIndex()) === String(anchor.id)) ?? rows[Math.min(anchor.position, rows.length - 1)]
        if (! row || destroyed) return
        await table.scrollToRow(row, 'top', true).catch(() => {})
        for (let round = 0, still = 0; round < 8 && still < 2; round++) {
            const el = row.getElement()
            if (destroyed || ! el?.isConnected) return
            // The range overlay follows its rows at once (Tabulator lays it out 200 ms after a scroll): left
            // where the rows were, under the last row it holds the scroll height open, and the holder
            // moves when it lets go (under a click, which then misses its cell).
            layoutRanges()
            const before = holder.scrollTop
            holder.scrollTop += el.getBoundingClientRect().top - (holder.getBoundingClientRect().top + holder.clientTop) - anchor.offset
            still = Math.abs(holder.scrollTop - before) < 1 ? still + 1 : 0
            await new Promise((resolve) => setTimeout(resolve, 16))
        }
    }

    /**
     * Put the active range back on the same rows and columns after the data was replaced (Tabulator
     * resets it to the first cell, and the next keystroke would go there); a row that is gone gives its
     * place to the one now there.
     */
    const restoreRange = (kept) => {
        if (destroyed || ! kept?.rows.length || ! kept.cols.length) return
        const rows = table.getRows()
        if (! rows.length) return
        const at = (id, position) => rows.find((r) => String(r.getIndex()) === id) ?? rows[Math.min(Math.max(position, 0), rows.length - 1)]
        const first = at(kept.rows[0], kept.top)?.getCell(kept.cols[0])
        const last = at(kept.rows.at(-1), kept.bottom)?.getCell(kept.cols.at(-1))
        if (first && last) table.getRanges().at(-1)?.setBounds(first, last)
    }

    const api = {
        table,

        ready,

        /**
         * Replace every row. Other rows (a new page, a sort, a search or filter result) open at the top:
         * setData renders from the first row. `top` false is for the same rows read again (a refresh, a
         * discard), which stay where they are scrolled to: replaceData re-renders around the old position,
         * from estimated heights, so the row that was at the top of the window is put back there. The
         * active range is put back too, before the scroll is corrected: a key typed meanwhile reaches the
         * cell the user was on (a restore after the correction would undo a move made during it).
         */
        async setRows(rows, top = true) {
            await ready
            current.clear()
            remember(rows)
            if (top) return table.setData(rows)

            const anchor = topRow()
            const kept = api.selection()
            await table.replaceData(rows)
            restoreRange(kept)
            if (anchor) await restoreTop(anchor)
        },

        /** Update rows in place (values and meta) and repaint them; a changed cell re-renders itself, the others are painted here. */
        async updateRows(rows) {
            await ready
            // An editor that commits while the table goes away (the sheet removed with it open) has nothing left to repaint.
            if (destroyed) return
            remember(rows)

            return table.updateData(rows).then(() => api.repaint(rows.map((r) => r.id)))
        },

        async addRows(rows, top = false) {
            await ready
            remember(rows)

            return table.addData(rows, top)
        },

        /**
         * Take rows away; many at once (the undo of a big paste) are removed under one redraw. A range that was on
         * the last rows is left past the end by Tabulator (no active cell: typing goes nowhere until an arrow key):
         * it is put on the row now at its place, the last one.
         */
        async removeRows(ids) {
            await ready
            const kept = api.selection()
            const many = ids.length > 1
            if (many) table.blockRedraw()
            try {
                for (const id of ids) {
                    current.delete(String(id))
                    table.getRow(id)?.delete()
                }
            } finally {
                if (many) table.restoreRedraw()
            }
            if (kept && ! api.activeCell()) restoreRange(kept)
        },

        /**
         * Bring a row into view. The grid renders only the rows around the visible window, so a row
         * further away has no element until it is scrolled to; a row already in view stays where it is.
         */
        async scrollTo(id, position = 'nearest') {
            await ready
            const row = destroyed ? null : table.getRows().find((r) => String(r.getIndex()) === String(id))
            if (! row) return
            await table.scrollToRow(row, position, false).catch(() => {})
            // Tabulator places the row from estimated heights and can stop short of it (the last row of a
            // long page, say): what is still cut off is scrolled the rest of the way.
            // The renderer re-pads the table on each scroll it sees, which moves the row again: the check is
            // repeated over the next frames until the row stays put (a handful of rounds at most).
            const reveal = () => {
                const el = row.getElement()
                if (destroyed || ! holder || ! el?.isConnected) return false
                const top = holder.getBoundingClientRect().top + holder.clientTop
                const rect = el.getBoundingClientRect()
                const before = holder.scrollTop
                if (rect.bottom > top + holder.clientHeight) holder.scrollTop += rect.bottom - top - holder.clientHeight
                else if (rect.top < top) holder.scrollTop -= top - rect.top

                return holder.scrollTop !== before
            }
            for (let round = 0, still = 0; round < 8 && still < 2; round++) {
                still = reveal() ? 0 : still + 1
                await new Promise((resolve) => setTimeout(resolve, 16))
            }
        },

        /** The value a cell shows now. */
        value(id, col) {
            return current.get(String(id))?.[col]
        },

        ids() {
            return table.getRows().map((r) => String(r.getIndex()))
        },

        /** Refresh the classes and tooltips of some rows (or all) without rebuilding their cells, so an open editor survives. */
        repaint(ids = null) {
            const rows = ids ? ids.map((id) => table.getRow(id)).filter(Boolean) : table.getRows()
            for (const row of rows) {
                rowClasses(row)
                for (const cell of row.getCells()) {
                    const field = cell.getField()
                    if (field === ROWNUM) {
                        const m = row.getData()._m ?? {}
                        const el = cell.getElement()
                        if (el && m.rowError) el.setAttribute('title', m.rowError)
                        else if (el) el.removeAttribute('title')
                        continue
                    }
                    const column = columns.find((c) => c.name === field)
                    if (column) paint(cell, column, t)
                }
            }
        },

        /** The active range as row ids and column names, or null. */
        selection() {
            const ranges = table.getRanges()
            const range = ranges[ranges.length - 1]
            if (! range) return null
            const rows = range.getRows().map((r) => String(r.getIndex()))
            const cols = range.getColumns().map((c) => c.getField()).filter((f) => f && f !== ROWNUM)
            const all = table.getRows().map((r) => String(r.getIndex()))
            const top = all.indexOf(rows[0])
            const fields = columns.map((c) => c.name)
            const left = cols.length ? fields.indexOf(cols[0]) : -1

            return { rows, cols, top, bottom: top + rows.length - 1, left, right: left + cols.length - 1 }
        },

        activeCell() {
            const s = api.selection()
            if (! s || ! s.rows.length || ! s.cols.length) return null

            return { id: s.rows[0], col: s.cols[0] }
        },

        isEditing() {
            return !! table.modules.edit.currentCell
        },

        /**
         * Put the active cell on a row's cell (a new row's first editable one), the one cell selected. The row need
         * not be rendered: the range holds positions, the caller scrolls to it.
         */
        select(id, col) {
            if (destroyed) return false
            const cell = (table.getRow(id) || null)?.getCell(col)
            const range = table.getRanges().at(-1)
            if (! cell || ! range) return false
            range.setBounds(cell, cell)

            return true
        },

        /**
         * Start editing the active cell; `initial` replaces its content (typing on a selected cell). True when an
         * editor opened; 'native' when it is a date or date-time field and the key is a digit, which the field must
         * take itself (the caller leaves the key's default action alone): a date field has no text to set, the digit
         * goes into its first part as it would after F2.
         */
        edit(initial = null) {
            const a = api.activeCell()
            if (! a) return false
            const row = table.getRow(a.id) || null
            if (! row) return false
            // The active cell may have been scrolled out of the rendered window: an editor needs its element.
            if (! row.getElement()?.isConnected) table.scrollToRow(row, 'center', false).catch(() => {})
            // The cell is taken after the scroll: a row updated while it had no element (an editor committed
            // as it scrolled out, an undo, a save answer) rebuilds its cells when it renders again.
            const cell = row.getCell(a.col)
            // A column without an editor (a boolean, flipped by toggleActive(); a computed one) has nothing to open:
            // Tabulator's cell.edit() throws there.
            if (! cell || ! editableCell(cell) || ! cell.getColumn().getDefinition().editor) return false
            typedOpen = initial !== null
            try { cell.edit(true) } finally { typedOpen = false }
            const ok = api.isEditing()
            if (ok && initial !== null) {
                const input = cell.getElement().querySelector('input, textarea')
                if (input && (input.type === 'date' || input.type === 'datetime-local')) {
                    // The field never sees this keydown: without the mark its first change would commit at once, as a picked date does.
                    input.dispatchEvent(new Event('ps-keyed'))

                    return /^\d$/.test(initial) ? 'native' : true
                }
                if (input && (input.type === 'text' || input.type === 'search' || input.tagName === 'TEXTAREA')) {
                    input.value = initial
                    input.dispatchEvent(new Event('input', { bubbles: true }))
                    input.setSelectionRange?.(input.value.length, input.value.length)
                }
            }

            return ok
        },

        /** Flip the active cell when it is a boolean (Enter or Space on it). True when it was one. */
        toggleActive() {
            const a = api.activeCell()
            if (! a) return false
            const column = columns.find((c) => c.name === a.col)
            if (! column || column.type !== 'boolean') return false
            const cell = table.getRow(a.id)?.getCell(a.col)

            return cell ? toggleBoolean(cell) || true : false
        },

        /** Move the active cell (the arrow keys' path) — 'up', 'down', 'left', 'right'. */
        navigate(direction) {
            const keys = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39] }
            const [key, keyCode] = keys[direction] ?? keys.down
            table.element.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }))
        },

        /** Hand the keyboard to the grid (closing an open editor, which commits it). Not subject to the pointer-down rule above. */
        focus() {
            focusHolder({ preventScroll: true })
        },

        /** Put the active range on the clipboard as TSV (what Ctrl+C does). */
        copy() {
            table.copyToClipboard('range')
        },

        /** The id of the row under a pointer event, if any. */
        rowAt(event) {
            const el = event.target?.closest?.('.tabulator-row')
            if (! el) return null
            const row = table.getRows().find((r) => r.getElement() === el)

            return row ? String(row.getIndex()) : null
        },

        /** Refresh the sort arrows in the header (title formatters run once, at column creation). */
        redrawHeader() {
            const s = sortState()
            for (const col of table.getColumns()) {
                const column = columns.find((c) => c.name === col.getField())
                const el = col.getElement()?.querySelector('.ps-sheet-title')
                if (! column || ! el) continue
                const sorted = s.column === column.name
                el.textContent = column.label + (sorted ? (s.direction === 'desc' ? ' ▼' : ' ▲') : '')
                // Tabulator writes aria-sort="none" on every header itself (its Sort module, not registered, would keep it).
                col.getElement().setAttribute('aria-sort', sorted ? (s.direction === 'desc' ? 'descending' : 'ascending') : 'none')
            }
        },

        destroy() {
            destroyed = true
            element.removeEventListener('focusout', editingChanged)
            element.removeEventListener('focusin', cellFocus)
            element.removeEventListener('keydown', jumped)
            element.removeEventListener('keydown', editorKeys, true)
            element.removeEventListener('keydown', altArrows, true)
            element.removeEventListener('keyup', listKeyup, true)
            holder?.removeEventListener('keydown', characterKeys)
            document.removeEventListener('mousedown', pointerDown, true)
            table.destroy()
        },
    }

    // The default sort's arrow is drawn by the title formatter at creation; its aria-sort needs the header elements.
    ready.then(() => { if (! destroyed) api.redrawHeader() })

    return api
}
