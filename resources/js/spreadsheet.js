/**
 * packstub/filament-spreadsheet — the Alpine component behind a sheet.
 *
 * The browser owns the sheet: a page of rows from the server, the unsaved cells
 * in a buffer that survives paging, sorting and searching (sheet.js), and the
 * grid that shows them (grid.js). Livewire only answers renderless calls: a page
 * of rows, a save, a delete. Nothing here re-renders through Livewire.
 */

import * as S from './sheet.js'
import { choice } from './sheet.js'
import { createGrid } from './grid.js'

export { choice }

export default function packstubSpreadsheet(config) {
    const t = config.i18n ?? {}
    const keys = {}
    for (const [name, spec] of Object.entries({ ...S.DEFAULT_KEYS, ...(config.keybindings ?? {}) })) keys[name] = S.parseKeybinding(spec)

    return {
        t,
        columns: config.columns ?? [],
        filters: config.filters ?? [],
        active: {},
        search: '',
        page: 1,
        lastPage: 1,
        total: 0,
        perPage: config.perPage ?? 100,
        pageSizes: config.pageSizes ?? [100],
        sort: { ...(config.sort ?? { column: null, direction: 'asc' }) },
        searchable: !! config.searchable,
        creatable: !! config.creatable,
        deletable: !! config.deletable,
        readOnly: !! config.readOnly,
        confirmLeave: config.confirmLeave !== false,
        loading: false,
        saving: false,
        dirty: { cells: 0, rows: 0, pages: 0, created: 0, deleted: 0, total: 0 },
        canUndo: false,
        canRedo: false,
        errorCount: 0,
        selected: 0,
        menu: null,
        hint: null,
        height: config.height ?? null,

        rows: [],
        buffer: S.createBuffer(),
        grid: null,

        /* ------------------------------------------------------------ lifecycle */

        init() {
            for (const f of this.filters) this.active[f.name] = f.type === 'dateRange' ? { from: '', until: '' } : ''

            this._req = 0
            this._keydown = (e) => this.onKeydown(e)
            this._beforeUnload = (e) => this.onBeforeUnload(e)
            this._navigate = (e) => this.onNavigate(e)
            this.$root.addEventListener('keydown', this._keydown, true)
            window.addEventListener('beforeunload', this._beforeUnload)
            document.addEventListener('livewire:navigate', this._navigate)

            this.$nextTick(() => {
                this.grid = createGrid(this.$refs.grid, {
                    columns: this.columns,
                    t,
                    locale: config.locale ?? 'en',
                    readOnly: this.readOnly,
                    rowHeight: config.rowHeight,
                    frozenFirstColumn: config.frozenFirstColumn !== false,
                    rowOffset: () => (this.page - 1) * this.perPage,
                    sortState: () => this.sort,
                    on: {
                        edit: (id, col, from, to) => this.onEdit(id, col, from, to),
                        rangeEdit: (edits) => this.onRangeEdit(edits),
                        sort: (col) => this.sortBy(col),
                        paste: (text) => this.onPaste(text),
                        select: (count) => { this.selected = this.readOnly || ! this.deletable ? 0 : count },
                    },
                })

                if (config.state && Array.isArray(config.state.rows)) this.applyPage(config.state)
                else this.refresh()
            })
        },

        destroy() {
            this.$root.removeEventListener('keydown', this._keydown, true)
            window.removeEventListener('beforeunload', this._beforeUnload)
            document.removeEventListener('livewire:navigate', this._navigate)
            clearTimeout(this._hint)
            this.grid?.destroy()
        },

        /* ------------------------------------------------------------ rows */

        column(name) {
            return this.columns.find((c) => c.name === name)
        },

        /** The values a new row starts with. */
        defaults() {
            const values = {}
            for (const c of this.columns) if (c.editable && ! c.readOnly && c.default !== null && c.default !== undefined) values[c.name] = c.default

            return values
        },

        /** A server row as the grid shows it: the buffer laid over, the flags in _m. */
        displayRow(row) {
            const o = S.overlay(this.buffer, row)

            return { id: row.id, ...o.values, _m: { dirty: o.dirty, errors: o.errors, conflicts: o.conflicts, rowError: o.rowError, locked: row.locked ?? [], readOnly: !! row.readOnly, deleted: o.deleted, created: false } }
        },

        createdRow(temp) {
            const values = this.buffer.created[temp] ?? {}
            const dirty = {}
            for (const c of this.columns) if (c.editable) dirty[c.name] = true

            return { id: temp, ...values, _m: { dirty, errors: this.buffer.errors[temp] ?? {}, conflicts: {}, rowError: this.buffer.rowErrors[temp] ?? null, locked: [], readOnly: false, deleted: false, created: true } }
        },

        /** Every row on the grid, in order, with the values shown now (for paste and fill-down). */
        visibleRows() {
            const rows = this.rows.map((row) => {
                const o = S.overlay(this.buffer, row)

                return { id: row.id, values: o.values, locked: row.locked ?? [], readOnly: !! row.readOnly, deleted: o.deleted, version: row.version ?? null }
            })
            for (const temp of this.buffer.createdOrder) rows.push({ id: temp, values: { ...this.buffer.created[temp] }, locked: [], readOnly: false, deleted: false, version: null })

            return rows
        },

        renderPage() {
            if (! this.grid) return
            this.grid.setRows([...this.rows.map((r) => this.displayRow(r)), ...this.buffer.createdOrder.map((temp) => this.createdRow(temp))])
            this.sync()
        },

        /** Re-send some rows to the grid with their current values and flags. */
        repaint(ids) {
            if (! this.grid) return
            const rows = []
            for (const id of new Set(ids)) {
                if (S.isCreated(this.buffer, id)) rows.push(this.createdRow(id))
                else {
                    const row = this.rows.find((r) => r.id === id)
                    if (row) rows.push(this.displayRow(row))
                }
            }
            if (rows.length) this.grid.updateRows(rows)
            this.sync()
        },

        sync() {
            this.dirty = S.summary(this.buffer)
            this.canUndo = this.buffer.undo.length > 0
            this.canRedo = this.buffer.redo.length > 0
            this.errorCount = S.errorCount(this.buffer)
        },

        request() {
            return { page: this.page, perPage: this.perPage, sort: this.sort, search: this.search, filters: JSON.parse(JSON.stringify(this.active)) }
        },

        /** Ask for the page the toolbar describes. Requests can overlap (search, paging, a sort): only the latest one's answer is applied. */
        async refresh() {
            if (! this.grid) return
            const seq = ++this._req
            this.loading = true
            try {
                const r = await this.$wire.spreadsheetRows(this.request())
                if (seq !== this._req) return
                if (! r || r.ok === false) this.notify(r?.message ?? t.load_failed, 'danger')
                else this.applyPage(r)
            } catch (e) {
                if (seq === this._req) this.notify(t.offline, 'danger')
            } finally {
                if (seq === this._req) this.loading = false
            }
        },

        applyPage(r) {
            this.rows = Array.isArray(r.rows) ? r.rows : []
            this.page = r.page ?? 1
            this.lastPage = Math.max(1, r.lastPage ?? 1)
            this.total = r.total ?? this.rows.length
            if (r.perPage) this.perPage = r.perPage
            if (r.sort) this.sort = { ...r.sort }
            this.renderPage()
        },

        /* ------------------------------------------------------------ editing */

        /** A cell edited in place: what the editor gave, read by the column's rules. */
        onEdit(id, col, from, to) {
            const column = this.column(col)
            if (! column) return
            const res = S.coerce(column, to, t)
            const row = this.rows.find((r) => r.id === id)
            const applied = S.applyEdits(this.buffer, [{ id, col, from, to: res.value, version: row?.version ?? null }], { page: this.page })
            if (! res.ok) {
                this.buffer.errors[id] ??= {}
                this.buffer.errors[id][col] = res.error
            }
            if (applied.length || ! res.ok) this.repaint([id])
            else this.sync()
        },

        /** Cells written by the fill handle. Each is checked again here: what the grid wrote into a cell it must not edit is repainted back. */
        onRangeEdit(edits) {
            const rows = this.visibleRows()
            const list = []
            const invalid = []
            const touched = new Set()
            for (const e of edits) {
                const column = this.column(e.col)
                if (! column) continue
                touched.add(e.id)
                const row = rows.find((r) => r.id === e.id)
                if (! S.editable(column, row, this.readOnly)) continue
                const res = S.coerce(column, e.to, t)
                list.push({ id: e.id, col: e.col, from: e.from, to: res.value, version: row.version })
                if (! res.ok) invalid.push({ id: e.id, col: e.col, error: res.error })
            }
            S.applyEdits(this.buffer, list, { page: this.page })
            for (const i of invalid) { this.buffer.errors[i.id] ??= {}; this.buffer.errors[i.id][i.col] = i.error }
            this.repaint([...touched])
        },

        /** Delete / Backspace: every editable cell of the selection becomes empty; locked, read-only and computed cells stay. */
        clearSelection() {
            if (this.readOnly) return
            const sel = this.grid.selection()
            if (! sel || sel.left < 0) return
            const edits = S.clearPlan({ rows: this.visibleRows(), columns: this.columns, top: sel.top, bottom: sel.bottom, left: sel.left, right: sel.right, readOnly: this.readOnly })
            const applied = S.applyEdits(this.buffer, edits, { page: this.page })
            if (applied.length) this.repaint(applied.map((e) => e.id))
        },

        /** Ctrl+X: the selection goes to the clipboard as Ctrl+C would send it, then the editable cells are cleared. */
        cut() {
            this.grid.copy()
            this.clearSelection()
        },

        onPaste(text) {
            if (this.readOnly) return
            const sel = this.grid.selection()
            if (! sel || sel.left < 0) return
            const matrix = S.parseTsv(text)
            if (! matrix.length) return

            const plan = S.pastePlan({
                matrix, startRow: sel.top, startCol: sel.left,
                rows: this.visibleRows(), columns: this.columns,
                creatable: this.creatable, readOnly: this.readOnly, defaults: this.defaults(),
                selection: { rows: sel.rows.length, cols: sel.cols.length }, t,
            })

            S.applyEdits(this.buffer, plan.edits, { page: this.page })
            const added = []
            for (const c of plan.created) {
                const temp = S.addCreated(this.buffer, c.values)
                added.push(temp)
            }
            for (const i of plan.invalid) {
                if (i.id === null) continue
                this.buffer.errors[i.id] ??= {}
                this.buffer.errors[i.id][i.col] = i.error
            }
            if (added.length) this.grid.addRows(added.map((temp) => this.createdRow(temp)))
            this.repaint(plan.edits.map((e) => e.id))
            if (plan.skipped) this.flash(choice(t.paste_skipped ?? ':count cells could not be pasted', plan.skipped))
        },

        fillDown() {
            if (this.readOnly) return
            const sel = this.grid.selection()
            if (! sel || sel.left < 0) return
            const edits = S.fillDownPlan({ rows: this.visibleRows(), columns: this.columns, top: sel.top, bottom: sel.bottom, left: sel.left, right: sel.right, readOnly: this.readOnly })
            const applied = S.applyEdits(this.buffer, edits, { page: this.page })
            if (applied.length) this.repaint(applied.map((e) => e.id))
        },

        undo() {
            const r = S.undo(this.buffer)
            if (r) this.applyReplay(r)
        },

        redo() {
            const r = S.redo(this.buffer)
            if (r) this.applyReplay(r)
        },

        applyReplay(r) {
            if (r.removed.length) this.grid.removeRows(r.removed)
            if (r.created.length) this.grid.addRows(r.created.map((c) => this.createdRow(c.id)))
            this.repaint([...r.edits.map((e) => e.id), ...r.deleted, ...r.undeleted])
        },

        addRow() {
            if (this.readOnly || ! this.creatable) return
            const temp = S.addCreated(this.buffer, this.defaults())
            this.grid.addRows([this.createdRow(temp)])
            this.sync()
        },

        deleteSelected() {
            if (this.readOnly || ! this.deletable) return
            const sel = this.grid.selection()
            if (! sel || ! sel.rows.length) return
            const ids = sel.rows.filter((id) => S.isCreated(this.buffer, id) || this.rows.find((r) => r.id === id)?.deletable)
            if (! ids.length) return
            if (! window.confirm(choice(t.confirm_delete, ids.length))) return
            this.markDeleted(ids)
        },

        markDeleted(ids) {
            const r = S.markDeleted(this.buffer, ids)
            if (r.dropped.length) this.grid.removeRows(r.dropped)
            this.repaint(r.deleted)
        },

        keepRow(id) {
            const kept = S.unmarkDeleted(this.buffer, [id])
            this.repaint(kept)
        },

        /* ------------------------------------------------------------ saving */

        async save() {
            if (this.saving || this.readOnly) return
            if (! this.dirty.total) { this.flash(t.nothing_to_save); return }
            if (this.grid.isEditing()) { this.grid.focus(); await new Promise((r) => setTimeout(r, 0)) }

            const payload = S.buildPayload(this.buffer)
            this.saving = true
            let result

            try {
                result = await this.$wire.spreadsheetSave(payload)
            } catch (e) {
                this.saving = false
                this.notify(t.offline, 'danger')

                return
            }

            this.saving = false
            if (! result || typeof result !== 'object') { this.notify(t.failed, 'danger'); return }

            const out = S.applyResult(this.buffer, result)
            const touched = []

            for (const { id, row } of out.saved) {
                const i = this.rows.findIndex((r) => r.id === id)
                if (i > -1) this.rows[i] = row
                touched.push(id)
            }

            if (out.created.length) {
                this.grid.removeRows(out.created.map((c) => c.temp))
                const fresh = out.created.map((c) => c.row)
                this.rows.push(...fresh)
                this.total += fresh.length
                this.grid.addRows(fresh.map((r) => this.displayRow(r)))
            }

            if (out.deleted.length) {
                this.rows = this.rows.filter((r) => ! out.deleted.includes(r.id))
                this.total = Math.max(0, this.total - out.deleted.length)
                this.grid.removeRows(out.deleted)
            }

            this.repaint([...touched, ...out.failed])
            this.sync()

            const written = out.saved.length + out.created.length + out.deleted.length
            if (result.message) this.notify(result.message, result.rolledBack ? 'danger' : 'warning')
            else if (out.failed.length) this.notify(choice(t.partly_saved, written, { saved: written, failed: out.failed.length }), 'warning')
            else if (written) this.notify(choice(t.saved, written), 'success')
            if (Object.keys(this.buffer.conflicts).length) this.notify(t.has_conflicts, 'warning')
        },

        discard() {
            if (! this.dirty.total) return
            if (! window.confirm(t.confirm_discard)) return
            S.discard(this.buffer)
            this.renderPage()
        },

        /* ------------------------------------------------------------ navigation */

        setPage(n) {
            const page = Math.max(1, Math.min(this.lastPage, Number(n) || 1))
            if (page === this.page) return
            this.page = page
            this.refresh()
        },

        prev() { this.setPage(this.page - 1) },

        next() { this.setPage(this.page + 1) },

        setPerPage(n) {
            this.perPage = Number(n) || this.perPage
            this.page = 1
            this.refresh()
        },

        sortBy(col) {
            const column = this.column(col)
            if (! column || ! column.sortable) return
            this.sort = { column: col, direction: this.sort.column === col && this.sort.direction === 'asc' ? 'desc' : 'asc' }
            this.page = 1
            this.grid.redrawHeader()
            this.refresh()
        },

        /* ------------------------------------------------------------ keyboard */

        onKeydown(e) {
            if (! this.grid) return
            const editing = this.grid.isEditing()

            if (S.matchesKey(e, keys.save)) { e.preventDefault(); this.save(); return }

            // Outside the grid (the search box, a filter, a toolbar button) every other key keeps its browser meaning: Ctrl+Z there undoes the typing, not the sheet.
            if (! this.$refs.grid?.contains(e.target)) return

            if (S.matchesKey(e, keys.undo) && ! editing) { e.preventDefault(); this.undo(); return }
            if ((S.matchesKey(e, keys.redo) || S.matchesKey(e, S.parseKeybinding('mod+shift+z'))) && ! editing) { e.preventDefault(); this.redo(); return }
            if (S.matchesKey(e, keys.fill_down) && ! editing) { e.preventDefault(); this.fillDown(); return }
            if (S.matchesKey(e, keys.cut) && ! editing) { e.preventDefault(); this.cut(); return }
            if (S.matchesKey(e, keys.add_row)) { e.preventDefault(); this.addRow(); return }

            if (editing) {
                // Enter commits and moves down, Tab commits and moves sideways (without
                // opening the next editor, which is what the grid would do on its own).
                if (e.key === 'Enter' && ! e.shiftKey && ! e.altKey && e.target?.tagName !== 'TEXTAREA') {
                    setTimeout(() => { if (! this.grid.isEditing()) this.grid.navigate('down') }, 0)
                } else if (e.key === 'Tab') {
                    e.preventDefault()
                    e.stopPropagation()
                    const direction = e.shiftKey ? 'left' : 'right'
                    e.target?.blur?.()
                    // The editor commits on blur, synchronously: the selection can move at once.
                    if (! this.grid.isEditing()) this.grid.navigate(direction)
                    else setTimeout(() => { if (! this.grid.isEditing()) this.grid.navigate(direction) }, 0)
                }

                return
            }

            if (this.readOnly || e.target?.closest?.('input, select, textarea, button')) return

            if ((e.key === 'Delete' || e.key === 'Backspace') && ! e.ctrlKey && ! e.metaKey && ! e.altKey) { e.preventDefault(); this.clearSelection(); return }

            if ((e.key === 'Enter' || e.key === ' ') && ! e.ctrlKey && ! e.metaKey && this.grid.toggleActive()) { e.preventDefault(); e.stopPropagation(); return }

            if (e.key === 'F2') { e.preventDefault(); this.grid.edit(); return }

            if (e.key.length === 1 && ! e.ctrlKey && ! e.metaKey && ! e.altKey) {
                if (this.grid.edit(e.key)) e.preventDefault()
            }
        },

        onEscape() {
            this.closeMenu()
        },

        /* ------------------------------------------------------------ leaving */

        onBeforeUnload(e) {
            if (! this.confirmLeave || ! this.dirty.total) return
            e.preventDefault()
            e.returnValue = ''
        },

        onNavigate(e) {
            if (! this.confirmLeave || ! this.dirty.total) return
            if (! window.confirm(t.confirm_leave)) e.preventDefault()
        },

        /* ------------------------------------------------------------ menu */

        /** The view's contextmenu handler on the grid element (the one path: Tabulator's rowContext would open it a second time). */
        openMenu(e) {
            const id = this.grid?.rowAt(e)
            if (! id || this.readOnly || ! this.deletable) return
            const created = S.isCreated(this.buffer, id)
            const row = this.rows.find((r) => r.id === id)
            if (! created && ! row?.deletable) return
            const items = S.isDeleted(this.buffer, id)
                ? [{ name: 'keep', label: t.restore_row }]
                : [{ name: 'delete', label: t.delete_row, color: 'danger' }]
            const box = this.$root.getBoundingClientRect()
            this.menu = { id, items, x: e.clientX - box.left, y: e.clientY - box.top }
            this.$nextTick(() => this.$refs.menu?.querySelector('button')?.focus())
        },

        runMenu(name) {
            const id = this.menu?.id
            this.closeMenu()
            if (! id) return
            if (name === 'delete') this.markDeleted([id])
            if (name === 'keep') this.keepRow(id)
        },

        closeMenu() {
            this.menu = null
        },

        menuMove(step) {
            const buttons = [...(this.$refs.menu?.querySelectorAll('button') ?? [])]
            if (! buttons.length) return
            const i = buttons.indexOf(document.activeElement)
            buttons[(i + step + buttons.length) % buttons.length].focus()
        },

        /* ------------------------------------------------------------ labels */

        changesLabel() {
            const d = this.dirty
            const parts = []
            if (d.cells) parts.push(d.pages > 1 ? choice(t.changes_on_pages, d.cells, { changes: choice(t.changes, d.cells), pages: d.pages }) : choice(t.changes, d.cells))
            if (d.created) parts.push(choice(t.new_rows, d.created))
            if (d.deleted) parts.push(choice(t.deleted_rows, d.deleted))

            return parts.join(' · ')
        },

        rowsLabel() {
            return choice(t.rows, this.total)
        },

        errorsLabel() {
            return choice(t.error_count, this.errorCount)
        },

        flash(message) {
            this.hint = message
            clearTimeout(this._hint)
            this._hint = setTimeout(() => { this.hint = null }, 4000)
        },

        notify(message, status = 'info') {
            if (window.FilamentNotification) {
                new window.FilamentNotification().title(message)[status]().send()
            } else {
                this.flash(message)
            }
        },
    }
}
