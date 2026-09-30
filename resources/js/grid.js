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
    SelectRangeModule,
    Tabulator,
} from 'tabulator-tables'
import { display, phpDate } from './sheet.js'

Tabulator.registerModule([
    AccessorModule, ClipboardModule, EditModule, ExportModule, FormatModule,
    FrozenColumnsModule, InteractionModule, KeybindingsModule, ResizeColumnsModule, SelectRangeModule,
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
        const done = () => {
            const v = input.value
            if (! v) return success(null)
            success(withTime ? v.replace('T', ' ') + ':00' : v)
        }
        input.addEventListener('change', done)
        input.addEventListener('blur', done)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done() }
            if (e.key === 'Escape') cancel()
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
            return (cell) => {
                const v = cell.getValue()
                if (v === null || v === undefined || v === '') return ''
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

function editorFor(column) {
    switch (column.type) {
        case 'boolean':
            // No editor: a double-click, Enter or Space flips the cell (see toggleBoolean).
            return { editor: false }
        case 'select':
            return { editor: 'list', editorParams: { values: (column.options ?? []).map((o) => ({ label: o.label, value: o.value })), autocomplete: true, listOnEmpty: true, allowEmpty: true, selectContents: true, filterFunc: (term, label) => String(label).toLowerCase().includes(String(term).toLowerCase()) } }
        case 'date':
            return { editor: isoEditor(false) }
        case 'datetime':
            return { editor: isoEditor(true) }
        case 'computed':
            return { editor: false }
        default:
            return { editor: 'input', editorParams: { selectContents: true } }
    }
}

/**
 * Build the grid. `options`:
 *   columns, rowHeight, frozenFirstColumn, readOnly, locale, t (strings)
 *   rowOffset()         the number of the first row on the page, minus one
 *   sortState()         { column, direction } for the header arrows
 *   on.edit(id, col, from, to)          one cell edited in place
 *   on.rangeEdit([{ id, col, value }])  cells written by the fill handle or a cleared range
 *   on.sort(col)                        header clicked
 *   on.paste(text)                      text pasted into the grid
 *   on.select(count)                    rows in the active range
 *   on.context(event, id)               right-click on a row
 */
export function createGrid(element, options) {
    const { columns, t, locale = 'en', readOnly = false, on = {} } = options
    const sortState = options.sortState ?? (() => ({ column: null, direction: 'asc' }))

    const editableCell = (cell) => {
        if (readOnly) return false
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
            hozAlign: column.type === 'number' ? 'right' : column.type === 'boolean' ? 'center' : 'left',
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
        height: '100%',
        layout: 'fitDataStretch',
        renderHorizontal: 'virtual',
        renderVertical: 'virtual',
        rowHeight: options.rowHeight ?? 32,
        placeholder: t.empty,
        rowHeader: {
            field: ROWNUM,
            headerSort: false,
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
        selectableRangeClearCells: ! readOnly,
        selectableRangeClearCellsValue: null,
        selectableRangeFill: ! readOnly,
        editTriggerEvent: 'dblclick',
        clipboard: 'copy',
        clipboardCopyRowRange: 'range',
        clipboardCopyStyled: false,
        clipboardCopyConfig: { columnHeaders: false, rowHeaders: false, columnGroups: false, columnCalcs: false, formatCells: false },
        columnDefaults: { headerSort: false, resizable: 'header', headerHozAlign: 'left' },
        columns: defs,
    })

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

    const selectionChanged = () => on.select?.(api.selection()?.rows.length ?? 0)
    table.on('rangeAdded', selectionChanged)
    table.on('rangeChanged', selectionChanged)
    table.on('rangeRemoved', selectionChanged)

    table.on('rowContext', (e, row) => on.context?.(e, String(row.getIndex())))

    element.addEventListener('paste', (e) => {
        if (table.modules.edit.currentCell) return
        const text = e.clipboardData?.getData('text/plain') ?? ''
        if (text === '') return
        e.preventDefault()
        e.stopPropagation()
        on.paste?.(text)
    })

    const api = {
        table,

        ready,

        /** Replace every row (a new page). */
        async setRows(rows) {
            await ready
            current.clear()
            remember(rows)

            return table.replaceData(rows)
        },

        /** Update rows in place (values and meta) and repaint them; a changed cell re-renders itself, the others are painted here. */
        async updateRows(rows) {
            await ready
            remember(rows)

            return table.updateData(rows).then(() => api.repaint(rows.map((r) => r.id)))
        },

        async addRows(rows, top = false) {
            await ready
            remember(rows)

            return table.addData(rows, top)
        },

        async removeRows(ids) {
            await ready
            for (const id of ids) {
                current.delete(String(id))
                table.getRow(id)?.delete()
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

        /** Start editing the active cell; `initial` replaces its content (typing on a selected cell). True when an editor opened. */
        edit(initial = null) {
            const a = api.activeCell()
            if (! a) return false
            const cell = table.getRow(a.id)?.getCell(a.col)
            if (! cell || ! editableCell(cell)) return false
            cell.edit(true)
            const ok = api.isEditing()
            if (ok && initial !== null) {
                const input = cell.getElement().querySelector('input, textarea')
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

        focus() {
            table.rowManager.element.focus({ preventScroll: true })
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
                el.textContent = column.label + (s.column === column.name ? (s.direction === 'desc' ? ' ▼' : ' ▲') : '')
            }
        },

        destroy() {
            table.destroy()
        },
    }

    return api
}
