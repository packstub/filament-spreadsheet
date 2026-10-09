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
    const specs = { ...S.DEFAULT_KEYS, ...(config.keybindings ?? {}) }
    // The $wire calls not answered yet (see call()). Kept out of the Alpine data: a reactive copy would never compare equal.
    let waiting = []
    for (const [name, spec] of Object.entries(specs)) keys[name] = S.parseKeybinding(spec)
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '')

    return {
        t,
        columns: config.columns ?? [],
        filters: config.filters ?? [],
        // Where the filters are shown: 'dropdown' (a funnel button), 'toolbar' (inline) or 'above' (a row over the grid).
        filtersLayout: config.filtersLayout ?? 'dropdown',
        active: {},
        search: '',
        page: 1,
        lastPage: 1,
        total: 0,
        perPage: config.perPage ?? 100,
        pageSizes: config.pageSizes ?? [100],
        maxRowsPerSave: Number(config.maxRowsPerSave) > 0 ? Number(config.maxRowsPerSave) : null,
        sort: { ...(config.sort ?? { column: null, direction: 'asc' }) },
        searchable: !! config.searchable,
        creatable: !! config.creatable,
        deletable: !! config.deletable,
        readOnly: !! config.readOnly,
        // The page holds no row the user may edit or delete and no row can be added (a viewer): the read-only pill says why nothing responds.
        lockedPage: false,
        confirmLeave: config.confirmLeave !== false,
        loading: false,
        saving: false,
        editing: false,
        dirty: { cells: 0, rows: 0, pages: 0, created: 0, deleted: 0, total: 0 },
        canUndo: false,
        canRedo: false,
        errorCount: 0,
        selected: 0,
        menu: null,
        hint: null,
        // The active cell's error or conflict, shown under the grid for the keyboard and touch (the title needs a pointer).
        status: null,
        // The question the dialog asks (Discard, Delete rows): { text, confirm, danger, resolve, answer }.
        dialog: null,
        height: config.height ?? null,

        rows: [],
        buffer: S.createBuffer(),
        grid: null,

        /* ------------------------------------------------------------ lifecycle */

        init() {
            for (const f of this.filters) this.active[f.name] = f.type === 'dateRange' ? { from: '', until: '' } : ''

            this._req = 0
            // What the grid shows: the page, page size and sort of the last answer applied, and the search and
            // filters it was asked with (see applyPage() and restoreApplied()).
            this._applied = { page: this.page, perPage: this.perPage, sort: { ...this.sort }, query: this.queryKey(this.request()) }
            this._keydown = (e) => this.onKeydown(e)
            this._beforeUnload = (e) => this.onBeforeUnload(e)
            this._navigate = (e) => this.onNavigate(e)
            this._url = location.href
            this._state = history.state
            this.$root.addEventListener('keydown', this._keydown, true)
            window.addEventListener('beforeunload', this._beforeUnload)
            document.addEventListener('livewire:navigate', this._navigate)
            // The grid's height follows the window and the rows (see fit()): measured again when the root changes
            // size (the toolbar wrapping, a hidden sheet shown) and when the window does.
            this._fitHeight = null
            this._onResize = () => this.fit()
            window.addEventListener('resize', this._onResize)
            this._observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.fit()) : null
            this._observer?.observe(this.$root)

            // The view renders the root with visibility: hidden: its stylesheet comes on request (x-load-css),
            // and until it is in the toolbar's icons, sized by nothing, fill the page. Shown as soon as the
            // stylesheet is seen (now, when it was cached; on the event x-load-css dispatches once it is loaded,
            // `data-dispatch` on the root; or after a while regardless, a sheet is never left invisible).
            // The first page is rendered as the grid is built (config.state), so when the stylesheet lands after that
            // the columns were measured on unstyled cells (every auto-width column as wide as the grid, the sheet looking
            // collapsed to its pinned column: a slow first load of the script on a panel): the event re-measures them.
            this._onCss = () => { this.reveal(); this.grid?.relayout() }
            window.addEventListener('packstub-spreadsheet-css', this._onCss)
            this._revealTimer = setTimeout(() => this.reveal(true), 3000)
            this.reveal()

            // Livewire 3 never settles an action's promise when its request fails (Livewire 4 rejects it):
            // the commit hook's `fail` is the one signal both have. See call().
            this._unhook = window.Livewire?.hook?.('commit', ({ component, commit, fail } = {}) => {
                if (typeof fail !== 'function' || ! component || component.id !== this.$wire?.$id) return
                fail(() => this.requestFailed(commit))
            })

            this.$nextTick(() => {
                this.fit()
                this.grid = createGrid(this.$refs.grid, {
                    columns: this.columns,
                    t,
                    locale: config.locale ?? 'en',
                    readOnly: this.readOnly,
                    rowHeight: config.rowHeight,
                    frozenFirstColumn: config.frozenFirstColumn !== false,
                    // Rows are numbered (and render, as they scroll into view) by the page shown, not by one still asked for.
                    rowOffset: () => (this._applied.page - 1) * this._applied.perPage,
                    sortState: () => this.sort,
                    saving: () => this.saving,
                    on: {
                        edit: (id, col, from, to) => this.onEdit(id, col, from, to),
                        rangeEdit: (edits) => this.onRangeEdit(edits),
                        sort: (col) => this.sortBy(col),
                        paste: (text) => this.onPaste(text),
                        // The rows Delete rows would delete: a row the policy keeps (a viewer's) is not counted, so the
                        // button is not offered for a selection it would do nothing with.
                        // A single cell is the active cell, not a selection of rows: Delete rows is offered for a range of
                        // cells or a whole row (a click on its number), counting the rows the user may delete.
                        select: (count, ids = [], cols = 0) => { this.selected = this.readOnly || ! this.deletable || (count === 1 && cols === 1) ? 0 : this.deletableIds(ids).length; this.updateStatus() },
                        editing: (open) => { this.editing = open },
                        // The first page is applied before tableBuilt: the rows land later than sync(), and the height follows them.
                        rows: () => this.fit(),
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
            if (typeof this._unhook === 'function') this._unhook()
            window.removeEventListener('resize', this._onResize)
            window.removeEventListener('packstub-spreadsheet-css', this._onCss)
            clearTimeout(this._revealTimer)
            this._observer?.disconnect()
            cancelAnimationFrame(this._fitFrame)
            clearTimeout(this._hint)
            this.grid?.destroy()
        },

        /**
         * Show the sheet once its stylesheet applies (the `--ps-sheet-bg` variable it sets reads '' before
         * that; not `--ps-sheet-height`, which a configured height binds on the root before any stylesheet), or regardless when `force`: the inline visibility the view renders is cleared, once.
         * The stylesheet's event stays listened to (see init(): it re-measures the columns), until destroy().
         */
        reveal(force = false) {
            if (this._revealed) return
            if (! force && getComputedStyle(this.$root).getPropertyValue('--ps-sheet-bg').trim() === '') return
            this._revealed = true
            this.$root.style.visibility = ''
            clearTimeout(this._revealTimer)
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
            // A row with unsaved cells shows its formulas over them; a clean row the server's values.
            const values = Object.keys(o.dirty).length ? S.computeRow(this.columns, o.values, o.errors) : o.values

            return { id: row.id, ...values, _m: { dirty: o.dirty, errors: o.errors, conflicts: o.conflicts, rowError: o.rowError, locked: row.locked ?? [], readOnly: !! row.readOnly, deleted: o.deleted, created: false } }
        },

        createdRow(temp) {
            const values = this.buffer.created[temp] ?? {}
            const dirty = {}
            for (const c of this.columns) if (c.editable) dirty[c.name] = true

            return { id: temp, ...S.computeRow(this.columns, values, this.buffer.errors[temp] ?? {}), _m: { dirty, errors: this.buffer.errors[temp] ?? {}, conflicts: {}, rowError: this.buffer.rowErrors[temp] ?? null, locked: [], readOnly: false, deleted: false, created: true } }
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

        /** Lay the rows on the grid; `top` scrolls it to the first row (other rows than before), false keeps the scroll (the same rows again). */
        renderPage(top = false) {
            if (! this.grid) return
            this.grid.setRows([...this.rows.map((r) => this.displayRow(r)), ...this.buffer.createdOrder.map((temp) => this.createdRow(temp))], top)
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
            this.updateStatus()
            this.fit()
        },

        /* ------------------------------------------------------------ height */

        /**
         * The grid's height when nothing fixes it (`--ps-sheet-height` is `auto`: no getSpreadsheetHeight(), no
         * length from a theme): what the window holds below the grid's top edge once what follows the grid (the
         * line under it, the page's padding, anything after the sheet) has its room, so the page does not scroll
         * for the sheet alone; and no more than the rows need (a short page is a short grid; at least three rows,
         * so the empty message has a box). A sheet far down a long page (under a form) is not squeezed into what
         * is left of the first screen: it may take the window below the top bar, and the page scrolls to it.
         * Written as the variable on the root, so the stylesheet and Tabulator's inline height both follow; a value
         * that did not change is not written (the ResizeObserver sees the write).
         */
        fit() {
            const grid = this.$refs.grid
            if (! grid || this.height) return
            const rootStyle = getComputedStyle(this.$root)
            // The stylesheet is loaded on request (x-load-css): until it is here the variable reads '' and nothing
            // is known yet; a value that is not `auto` (a theme's length) fixes the height, read once.
            if (this._fixed === undefined) {
                const value = rootStyle.getPropertyValue('--ps-sheet-height').trim()
                if (value === '') return
                this._fixed = value !== 'auto'
            }
            if (this._fixed) return
            const rect = grid.getBoundingClientRect()
            if (! rect.width) return // hidden: nothing to measure, the observer calls again when it is shown
            const rem = parseFloat(rootStyle.fontSize) || 16
            const length = (v, fallback) => { const m = /^\s*([\d.]+)(px|rem)?\s*$/.exec(v ?? ''); return m ? parseFloat(m[1]) * (m[2] === 'rem' ? rem : 1) : fallback }
            const rowHeight = Math.max(24, Number(config.rowHeight) || 32)
            const header = grid.querySelector('.tabulator-header')?.getBoundingClientRect().height || rowHeight + 8
            // A row element is the row plus its border; the grid's borders are not inside its height.
            const pitch = grid.querySelector('.tabulator-row')?.getBoundingClientRect().height || rowHeight + 1
            const rows = this.grid ? this.grid.ids().length : this.rows.length
            const needed = Math.ceil(header + Math.max(3, rows) * pitch + 2)
            const top = rect.top + window.scrollY
            const gs = getComputedStyle(grid)
            // The variable is the grid's content height: its own borders come on top of it.
            const borders = gs.boxSizing === 'border-box' ? 0 : (parseFloat(gs.borderTopWidth) || 0) + (parseFloat(gs.borderBottomWidth) || 0)
            const below = this.after(grid) + borders
            let available = Math.floor(window.innerHeight - top - below)
            if (available < header + 8 * pitch) available = Math.max(available, Math.floor(window.innerHeight - length(rootStyle.getPropertyValue('--topbar-height'), 4 * rem) - rem - below))
            const px = Math.max(Math.ceil(header + 3 * pitch + 2), Math.min(needed, available))
            // A write redraws the grid and the observer sees the root change: a difference of a pixel is left alone.
            if (this._fitHeight !== null && Math.abs(px - this._fitHeight) < 2) return
            this._fitHeight = px
            this.$root.style.setProperty('--ps-sheet-height', `${px}px`)
        },

        /**
         * The room what follows an element takes down to the end of the page: the following siblings at each
         * level (their margins and the flex gap before them), the padding of each ancestor, the body's margin.
         * Not the document's height: a body with a min-height of the window would count its empty rest.
         */
        after(el) {
            const px = (v) => parseFloat(v) || 0
            let sum = 0
            for (let node = el; node && node !== document.body; node = node.parentElement) {
                const parent = node.parentElement
                if (! parent) break
                const cs = getComputedStyle(parent)
                sum += px(cs.paddingBottom) + px(cs.borderBottomWidth) + px(getComputedStyle(node).marginBottom)
                let seen = false
                for (const sib of parent.children) {
                    if (sib === node) { seen = true; continue }
                    if (! seen) continue
                    const r = sib.getBoundingClientRect()
                    const ss = getComputedStyle(sib)
                    if ((! r.height && ! r.width) || ss.position === 'fixed' || ss.position === 'absolute') continue
                    sum += r.height + px(ss.marginTop) + px(ss.marginBottom) + px(cs.rowGap)
                }
            }
            const body = getComputedStyle(document.body)

            return sum + px(body.paddingBottom) + px(body.marginBottom)
        },

        /* ------------------------------------------------------------ status */

        /** The active cell's error, conflict or row error for the line under the grid, null when it has none. */
        updateStatus() {
            const a = this.grid?.activeCell()
            const m = a ? this.marks(a.id) : null
            let next = null
            if (m?.errors[a.col]) next = { kind: 'error', text: m.errors[a.col] }
            else if (m && Object.prototype.hasOwnProperty.call(m.conflicts, a.col)) {
                // The row's version moved, but this cell's value on the server is still the one the user loaded: someone
                // changed another cell of the row, and "their value" would only blame this one.
                const unchanged = Object.prototype.hasOwnProperty.call(this.buffer.originals[a.id] ?? {}, a.col) && S.same(this.buffer.originals[a.id][a.col], m.conflicts[a.col])
                next = { kind: 'conflict', text: unchanged ? `${t.conflict} ${t.conflict_elsewhere}` : `${t.conflict} ${t.their_value}: ${this.plain(a.col, m.conflicts[a.col])} · ${t.your_value}: ${this.plain(a.col, this.grid.value(a.id, a.col))}` }
            }
            else if (m?.rowError) next = { kind: 'error', text: m.rowError }
            if ((next?.text ?? null) !== (this.status?.text ?? null)) this.status = next
        },

        /** What the buffer holds against a row: the refused cells, the conflicts and the row's own error. */
        marks(id) {
            return { errors: this.buffer.errors[id] ?? {}, conflicts: this.buffer.conflicts[id] ?? {}, rowError: this.buffer.rowErrors[id] ?? null }
        },

        /** A value as text for a message: an option's label, a boolean as a word, the rest as it is. */
        plain(col, value) {
            if (value === null || value === undefined || value === '') return '—'
            const column = this.column(col)
            if (column?.type === 'select') return (column.options ?? []).find((o) => String(o.value) === String(value))?.label ?? String(value)
            if (column?.type === 'boolean') return value ? (t.yes ?? 'yes') : (t.no ?? 'no')

            return String(value)
        },

        /**
         * Move the active cell to the next marked cell of the page (a refused cell, a conflict, a row the server
         * refused), after the active one in row order, wrapping; the toolbar's count is a button for it.
         */
        async nextError() {
            if (! this.grid) return
            const cols = this.columns.filter((c) => ! c.hidden).map((c) => c.name)
            const first = this.columns.find((c) => c.editable && ! c.readOnly)?.name ?? cols[0]
            const marked = []
            for (const id of this.grid.ids()) {
                const m = this.marks(id)
                for (const col of cols) if (m.errors[col] || Object.prototype.hasOwnProperty.call(m.conflicts, col)) marked.push({ id, col })
                if (m.rowError && ! marked.some((x) => x.id === id)) marked.push({ id, col: first })
            }
            if (! marked.length) { if (this.errorCount) this.flash(t.errors_elsewhere); this.refocus(); return }
            const a = this.grid.activeCell()
            const at = a ? marked.findIndex((x) => x.id === a.id && x.col === a.col) : -1
            let i = at + 1
            if (at === -1 && a) {
                // No mark on the active cell: the first one after it in the page's order.
                const ids = this.grid.ids()
                const pos = (x) => ids.indexOf(x.id) * cols.length + cols.indexOf(x.col)
                const here = pos(a)
                i = marked.findIndex((x) => pos(x) > here)
                if (i === -1) i = 0
            }
            const target = marked[i % marked.length]
            await this.grid.scrollTo(target.id)
            this.grid.select(target.id, target.col)
            this.updateStatus()
            this.refocus()
        },

        /** A shortcut as the tooltip of its button reads it: the configured binding, ⌘ on a Mac. */
        /** The filters that narrow the rows: a select with a value, a range with either date. */
        activeFilterCount() {
            return this.filters.filter((f) => f.type === 'dateRange' ? (this.active[f.name]?.from || this.active[f.name]?.until) : this.active[f.name]).length
        },

        resetFilters() {
            for (const f of this.filters) this.active[f.name] = f.type === 'dateRange' ? { from: '', until: '' } : ''
            this.refresh()
        },

        /** The shortcuts as bound (the configurable ones) and the grid's own, for the help modal. */
        shortcutList() {
            const fixed = (label, spec) => ({ label, keys: S.shortcutLabel(spec, mac) })
            return [
                { label: t.save, keys: this.keyLabel('save') },
                { label: t.undo, keys: this.keyLabel('undo') },
                { label: t.redo, keys: this.keyLabel('redo') },
                { label: t.add_row, keys: this.keyLabel('add_row') },
                { label: t.shortcut_fill_down, keys: this.keyLabel('fill_down') },
                fixed(t.shortcut_copy, 'mod+c'),
                fixed(t.shortcut_paste, 'mod+v'),
                { label: t.shortcut_cut, keys: this.keyLabel('cut') },
                fixed(t.shortcut_clear, 'delete'),
                fixed(t.shortcut_edit, 'enter'),
                fixed(t.shortcut_select, 'shift+arrowdown'),
                fixed(t.shortcut_jump, 'mod+arrowdown'),
                fixed(t.shortcut_toggle, 'space'),
                fixed(t.shortcut_menu, 'shift+f10'),
            ]
        },

        openHelp() {
            const el = this.$root.querySelector('.ps-sheet-help')
            if (el?.id) window.dispatchEvent(new CustomEvent('open-modal', { detail: { id: el.id } }))
        },

        /**
         * A Filament modal of the sheet reports `modal-closed` (bubbling to the root): the dialog resolves its
         * question, the help modal hands the keyboard back to the grid once its focus trap has let go.
         */
        modalClosed(e) {
            const id = e?.detail?.id
            if (id && id === this.$root.querySelector('.ps-sheet-dialog')?.id) this.dialogClosed(e)
            else if (id && id === this.$root.querySelector('.ps-sheet-help')?.id) this.$nextTick(() => this.refocus())
        },

        keyLabel(name) {
            return S.shortcutLabel(specs[name] ?? S.DEFAULT_KEYS[name] ?? '', mac)
        },

        request() {
            return { page: this.page, perPage: this.perPage, sort: this.sort, search: this.search, filters: JSON.parse(JSON.stringify(this.active)) }
        },

        /** The search and the filters of a request, as one comparable string. */
        queryKey(request) {
            return JSON.stringify([request?.search ?? '', request?.filters ?? {}])
        },

        /**
         * A $wire call that settles whatever happens to its request: with the answer, with
         * the promise's own rejection (Livewire 4), or with the failure Livewire reports for
         * the commit that carried it (Livewire 3, where the promise stays pending for good).
         * Whichever comes first wins; an answer that lands after a reported failure is ignored.
         */
        call(method, ...params) {
            const waiter = { method, reject: null }
            const failed = new Promise((_, reject) => { waiter.reject = () => reject(new Error('The request failed.')) })
            waiting.push(waiter)
            let answer
            try { answer = this.$wire[method](...params) } catch (e) { answer = Promise.reject(e) }

            return Promise.race([answer, failed])
                .finally(() => { waiting = waiting.filter((w) => w !== waiter) })
        },

        /** How many calls wait for an answer (the browser harness reads it). */
        waitingCalls() {
            return waiting.length
        },

        /**
         * A commit of this component failed. Livewire sends a component's commits one after
         * the other, so the calls it carried are the oldest ones waiting, per method; a commit
         * that does not say what it carried releases everything that waits.
         */
        requestFailed(commit) {
            const calls = Array.isArray(commit?.calls) ? commit.calls.map((c) => c?.method) : null
            const open = [...waiting]
            if (! calls) { for (const w of open) w.reject(); return }
            for (const method of calls) {
                const i = open.findIndex((w) => w && w.method === method)
                if (i > -1) { open[i].reject(); open[i] = null }
            }
        },

        /** Ask for the page the toolbar describes. Requests can overlap (search, paging, a sort): only the latest one's answer is applied. */
        async refresh() {
            if (! this.grid) return
            const seq = ++this._req
            this.loading = true
            try {
                const request = this.request()
                const r = await this.call('spreadsheetRows', request)
                if (seq !== this._req) return
                if (! r || r.ok === false) {
                    this.restoreApplied()
                    this.notify(r?.message ?? t.load_failed, 'danger')

                    return
                }
                // An open editor is committed before its row is replaced (as save() does): the typed text
                // becomes an unsaved cell, and the grid is not rebuilt under an editor (Tabulator throws).
                if (this.grid.isEditing()) {
                    this.grid.focus()
                    await new Promise((resolve) => setTimeout(resolve, 0))
                    if (seq !== this._req) return
                }
                this.applyPage(r, request)
            } catch (e) {
                if (seq === this._req) {
                    this.restoreApplied()
                    this.notify(t.offline, 'danger')
                }
            } finally {
                if (seq === this._req) this.loading = false
            }
        },

        /**
         * Show an answer. `request` is what it was asked with (none for the rows the page was rendered with).
         * Other rows than the ones on screen (another page, page size, sort, search or filters) open at the
         * top; the same page read again (the refresh event, the re-read after a save) keeps the scroll.
         */
        applyPage(r, request = null) {
            const was = this._applied
            this.rows = Array.isArray(r.rows) ? r.rows : []
            this.page = r.page ?? 1
            this.lastPage = Math.max(1, r.lastPage ?? 1)
            this.total = r.total ?? this.rows.length
            if (r.perPage) this.perPage = r.perPage
            if (r.sort) this.sort = { ...r.sort }
            this.lockedPage = ! this.readOnly && ! this.creatable && this.rows.length > 0 && this.rows.every((row) => row.readOnly && ! (this.deletable && row.deletable))
            this._applied = { page: this.page, perPage: this.perPage, sort: { ...this.sort }, query: request ? this.queryKey(request) : was.query }
            const a = this._applied
            const same = a.page === was.page && a.perPage === was.perPage && a.sort.column === was.sort.column && a.sort.direction === was.sort.direction && a.query === was.query
            this.renderPage(! same)
        },

        /**
         * The latest page request failed: the pager, the page size and the sort arrow go back to
         * what the rows on screen are (they were set when the request left). The search text and
         * the filter fields stay as typed: the next request sends them again.
         */
        restoreApplied() {
            const a = this._applied
            const sorted = a.sort.column !== this.sort.column || a.sort.direction !== this.sort.direction
            this.page = a.page
            this.perPage = a.perPage
            this.sort = { ...a.sort }
            if (sorted) this.grid?.redrawHeader()
        },

        /* ------------------------------------------------------------ editing */

        /*
         * While a save is in flight (`saving`) the sheet takes no edits: the grid opens no
         * editor (grid.js asks `saving()`), and every operation below returns early, so a
         * keystroke meanwhile is dropped, never queued. The answer forgets the saved cells
         * wholesale (S.applyResult), so an edit made meanwhile would have been lost with them.
         */

        /** A cell edited in place: what the editor gave, read by the column's rules. */
        onEdit(id, col, from, to) {
            const column = this.column(col)
            if (! column) return
            if (this.saving) { this.repaint([id]); return }
            const res = S.coerce(column, to, t)
            const row = this.rows.find((r) => r.id === id)
            const applied = S.applyEdits(this.buffer, [{ id, col, from, to: res.value, version: row?.version ?? null }], { page: this._applied.page })
            if (! res.ok) {
                this.buffer.errors[id] ??= {}
                this.buffer.errors[id][col] = res.error
            }
            if (applied.length || ! res.ok) this.repaint([id])
            else this.sync()
        },

        /** Cells written by the fill handle. Each is checked again here: what the grid wrote into a cell it must not edit is repainted back. */
        onRangeEdit(edits) {
            if (this.saving) { this.repaint(edits.map((e) => e.id)); return }
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
            S.applyEdits(this.buffer, list, { page: this._applied.page })
            for (const i of invalid) { this.buffer.errors[i.id] ??= {}; this.buffer.errors[i.id][i.col] = i.error }
            this.repaint([...touched])
        },

        /** Delete / Backspace: every editable cell of the selection becomes empty; locked, read-only and computed cells stay. */
        clearSelection() {
            if (this.readOnly || this.saving) return
            const sel = this.grid.selection()
            if (! sel || sel.left < 0) return
            const edits = S.clearPlan({ rows: this.visibleRows(), columns: this.columns, top: sel.top, bottom: sel.bottom, left: sel.left, right: sel.right, readOnly: this.readOnly })
            const applied = S.applyEdits(this.buffer, edits, { page: this._applied.page })
            if (applied.length) this.repaint(applied.map((e) => e.id))
        },

        /** Ctrl+X: the selection goes to the clipboard as Ctrl+C would send it, then the editable cells are cleared. */
        cut() {
            this.grid.copy()
            this.clearSelection()
        },

        onPaste(text) {
            if (this.readOnly || this.saving) return
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

            // One undo step for the whole paste; new rows stop at the server's cap on rows per save.
            const out = S.applyPaste(this.buffer, plan, { page: this._applied.page, maxRows: this.maxRowsPerSave })
            if (out.created.length) this.grid.addRows(out.created.map((c) => this.createdRow(c.id)))
            this.repaint(plan.edits.map((e) => e.id))

            const hints = []
            if (out.capped) hints.push(choice(t.paste_capped ?? ':count rows were not added: a save takes at most :max rows.', out.capped, { max: this.maxRowsPerSave }))
            if (plan.skipped) hints.push(choice(t.paste_skipped ?? ':count cells could not be pasted', plan.skipped))
            if (hints.length) this.flash(hints.join(' '))
        },

        fillDown() {
            if (this.readOnly || this.saving) return
            const sel = this.grid.selection()
            if (! sel || sel.left < 0) return
            const edits = S.fillDownPlan({ rows: this.visibleRows(), columns: this.columns, top: sel.top, bottom: sel.bottom, left: sel.left, right: sel.right, readOnly: this.readOnly })
            const applied = S.applyEdits(this.buffer, edits, { page: this._applied.page })
            if (applied.length) this.repaint(applied.map((e) => e.id))
        },

        undo() {
            if (this.saving) return
            const r = S.undo(this.buffer)
            if (r) this.applyReplay(r)
            this.refocus()
        },

        redo() {
            if (this.saving) return
            const r = S.redo(this.buffer)
            if (r) this.applyReplay(r)
            this.refocus()
        },

        applyReplay(r) {
            if (r.removed.length) this.grid.removeRows(r.removed)
            if (r.created.length) this.grid.addRows(r.created.map((c) => this.createdRow(c.id)))
            this.repaint([...r.edits.map((e) => e.id), ...r.deleted, ...r.undeleted])
        },

        addRow() {
            if (this.readOnly || ! this.creatable || this.saving) return
            // An editor still open (the shortcut bound to a key that is not the editor's Enter) is committed first: its blur settles it.
            if (this.grid.isEditing()) this.grid.focus()
            const temp = S.addCreated(this.buffer, this.defaults())
            // The new row is appended below the last one: out of the rendered window on a long page, so it is scrolled
            // to. The active cell goes with it, to the row's first editable cell: what is typed next is the new row's.
            const first = (this.columns.find((c) => S.editable(c, { created: true }, this.readOnly)) ?? this.columns[0])?.name
            this.grid.addRows([this.createdRow(temp)]).then(() => {
                if (first) this.grid?.select(temp, first)
                this.grid?.scrollTo(temp, 'bottom')
            })
            this.sync()
            this.refocus()
        },

        deletableIds(ids) {
            return ids.filter((id) => S.isCreated(this.buffer, id) || this.rows.find((r) => r.id === id)?.deletable)
        },

        async deleteSelected() {
            if (this.readOnly || ! this.deletable || this.saving) return
            const sel = this.grid.selection()
            if (! sel || ! sel.rows.length || (sel.rows.length === 1 && sel.cols.length === 1)) return
            const ids = this.deletableIds(sel.rows)
            if (! ids.length) return
            if (! await this.confirm({ heading: t.delete_rows, text: choice(t.confirm_delete, ids.length), confirm: t.delete_rows, danger: true })) { this.refocus(); return }
            if (this.saving) return
            this.markDeleted(ids)
            this.refocus()
        },

        /**
         * Ask in Filament's modal (the one the view renders with the sheet, opened and closed by its id through
         * the `open-modal` / `close-modal` window events; Escape, the overlay and the focus trap are its),
         * resolved with the answer when it reports `modal-closed`; a page without the modal falls back to
         * the browser's confirm().
         */
        confirm({ heading, text, confirm, danger = false }) {
            const el = this.$root.querySelector('.ps-sheet-dialog')
            if (! el || ! el.id) return Promise.resolve(window.confirm(text))

            return new Promise((resolve) => {
                this.dialog = { heading, text, confirm, danger, resolve, answer: false }
                // The confirm button takes the focus once the modal is open (its focus trap has put it on the first
                // button by then): the shown OK button, the danger or the primary one.
                const opened = (e) => {
                    if (e.detail?.id !== el.id) return
                    document.removeEventListener('x-modal-opened', opened)
                    setTimeout(() => [...el.querySelectorAll('.ps-sheet-dialog-ok')].find((b) => b.getClientRects().length)?.focus(), 30)
                }
                document.addEventListener('x-modal-opened', opened)
                window.dispatchEvent(new CustomEvent('open-modal', { detail: { id: el.id } }))
            })
        },

        /**
         * A dialog button: remember the answer and close; `modal-closed` then resolves (see dialogClosed()). The
         * button sits inside the modal's own Alpine component, where `$root` is the modal: it passes the id.
         */
        answerDialog(answer, id) {
            if (this.dialog) this.dialog.answer = answer
            if (id) window.dispatchEvent(new CustomEvent('close-modal', { detail: { id } }))
        },

        dialogClosed(e) {
            const el = this.$root.querySelector('.ps-sheet-dialog')
            if (e?.detail?.id && el?.id && e.detail.id !== el.id) return
            const asked = this.dialog
            this.dialog = null
            asked?.resolve(asked.answer === true)
        },

        /**
         * After a toolbar button or a menu item the keyboard goes back to the grid, so
         * the next shortcut reaches the sheet (a clicked button keeps the focus, or
         * drops it on the body when it disables itself). A text field keeps it: Ctrl+S
         * in the search box must not move the caret into the grid.
         */
        refocus() {
            if (! this.grid) return
            const el = document.activeElement
            if (el && el !== document.body && this.$refs.grid?.contains(el)) return
            if (el && el.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
            this.grid.focus()
        },

        markDeleted(ids) {
            if (this.saving) return
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
            // An open editor is committed first: it may be the only unsaved change.
            if (this.grid.isEditing()) { this.grid.focus(); await new Promise((r) => setTimeout(r, 0)) }
            if (this.saving) return
            if (! this.dirty.total) { this.flash(t.nothing_to_save); this.refocus(); return }

            // A page request still in flight (a debounced search, say) would land after the
            // save and lay its stale rows and versions over the saved ones: its answer is
            // dropped here, and the page asked for again once the save is answered.
            const pending = this.loading
            this._req++
            this.loading = false

            try {
                await this.performSave()
            } finally {
                if (pending) this.refresh()
                this.refocus()
            }
        },

        async performSave() {
            const payload = S.buildPayload(this.buffer)
            this.saving = true
            let result

            try {
                result = await this.call('spreadsheetSave', payload)
            } catch (e) {
                // The buffer and the undo stack are untouched: Save again retries.
                this.notify(t.offline, 'danger')

                return
            } finally {
                this.saving = false
            }

            if (! result || typeof result !== 'object') { this.notify(t.failed, 'danger'); return }

            const out = S.applyResult(this.buffer, result)
            const touched = []

            for (const { id, row } of out.saved) {
                const i = this.rows.findIndex((r) => r.id === id)
                if (i > -1) this.rows[i] = row
                touched.push(id)
            }

            if (out.created.length) {
                // The active cell follows its row through the change of id (a new row is where Add row left it).
                const active = this.grid.activeCell()
                const follow = active && out.created.find((c) => c.temp === active.id)
                this.grid.removeRows(out.created.map((c) => c.temp))
                const fresh = out.created.map((c) => c.row)
                this.rows.push(...fresh)
                this.total += fresh.length
                this.grid.addRows(fresh.map((r) => this.displayRow(r))).then(() => { if (follow) this.grid?.select(follow.row.id, active.col) })
            }

            if (out.deleted.length) {
                this.rows = this.rows.filter((r) => ! out.deleted.includes(r.id))
                this.total = Math.max(0, this.total - out.deleted.length)
                this.grid.removeRows(out.deleted)
            }

            this.repaint([...touched, ...out.failed])
            this.sync()

            const written = out.saved.length + out.created.length + out.deleted.length
            const conflicts = Object.keys(this.buffer.conflicts).length > 0
            // Only conflicts refused the batch: one message, the one that says what to do ("fix the marked
            // cells" would ask to change values that are fine).
            const onlyConflicts = conflicts && ! Object.keys(this.buffer.errors).length && ! Object.keys(this.buffer.rowErrors).length
            if (result.message && ! (result.rolledBack && onlyConflicts)) this.notify(result.message, result.rolledBack ? 'danger' : 'warning')
            else if (out.failed.length && (written || ! onlyConflicts)) this.notify(choice(t.partly_saved, written, { saved: written, failed: out.failed.length }), 'warning')
            else if (written) this.notify(choice(t.saved, written), 'success')
            if (conflicts) this.notify(t.has_conflicts, 'warning')
        },

        async discard() {
            if (! this.dirty.total || this.saving) return
            if (! await this.confirm({ heading: t.discard, text: t.confirm_discard, confirm: t.discard })) { this.refocus(); return }
            if (! this.dirty.total || this.saving) return
            S.discard(this.buffer)
            this.renderPage()
            this.refocus()
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

        /**
         * The root's keydown listener, in the capture phase: every key is seen here before the grid's own handlers.
         * A key the sheet acts on is the sheet's alone (`own()`): it stops here, so Tabulator's keydown handlers (Enter
         * opens the active cell's editor, the keybindings module) never act on it too. The one key shared on purpose
         * is Enter in an open editor: the editor's own listener commits, the sheet only moves down afterwards.
         */
        onKeydown(e) {
            if (! this.grid) return
            // The dialog's keys are its own: Enter answers, Escape cancels, Tab moves between its buttons.
            if (e.target?.closest?.('.ps-sheet-dialog')) return
            const editing = this.grid.isEditing()
            const own = () => { e.preventDefault(); e.stopPropagation() }

            if (S.matchesKey(e, keys.save)) { own(); this.save(); return }

            // In a text field outside the grid (the search box, a filter) every other key keeps its
            // browser meaning: Ctrl+Z there undoes the typing, not the sheet. A toolbar button is
            // no such field: Ctrl+Y right after a click on Undo redoes.
            const field = e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
            if (field && ! this.$refs.grid?.contains(field)) return

            // The row menu from the keyboard, on the active cell's row (not in an open editor: Shift+F10 is the field's there).
            if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && ! editing && ! this.menu) { if (this.openMenuAtActive()) own(); return }

            if (S.matchesKey(e, keys.undo) && ! editing) { own(); this.undo(); return }
            if ((S.matchesKey(e, keys.redo) || S.matchesKey(e, S.parseKeybinding('mod+shift+z'))) && ! editing) { own(); this.redo(); return }
            if (S.matchesKey(e, keys.fill_down) && ! editing) { own(); this.fillDown(); return }
            if (S.matchesKey(e, keys.cut) && ! editing) { own(); this.cut(); return }
            // Ctrl+Enter is still an Enter to Tabulator: it would open the editor of the cell the row was added from.
            // In an open editor that Enter is the editor's (it commits, a select takes the highlighted option): the row
            // is added once it has.
            if (S.matchesKey(e, keys.add_row)) {
                if (editing && e.key === 'Enter') { e.preventDefault(); setTimeout(() => this.addRow(), 0); return }
                own()
                this.addRow()

                return
            }

            if (editing) {
                // Enter commits and moves down, Tab commits and moves sideways (without
                // opening the next editor, which is what the grid would do on its own).
                if (e.key === 'Enter' && ! e.shiftKey && ! e.altKey && e.target?.tagName !== 'TEXTAREA') {
                    setTimeout(() => { if (! this.grid.isEditing()) this.grid.navigate('down') }, 0)
                } else if (e.key === 'Tab') {
                    own()
                    const direction = e.shiftKey ? 'left' : 'right'
                    e.target?.blur?.()
                    // The editor commits on blur, synchronously: the selection can move at once.
                    if (! this.grid.isEditing()) this.grid.navigate(direction)
                    else setTimeout(() => { if (! this.grid.isEditing()) this.grid.navigate(direction) }, 0)
                }

                return
            }

            // A column without an editor (computed; a boolean): Tabulator's Enter would call editCell on it and throw,
            // with any modifier held. An editable boolean is flipped below by a plain Enter; with Ctrl or Meta
            // (not the add-row key, handled above) the key does nothing.
            if (e.key === 'Enter') {
                const a = this.grid.activeCell()
                const type = a && this.column(a.col)?.type
                if (type === 'computed' || (type === 'boolean' && (this.readOnly || e.ctrlKey || e.metaKey))) { own(); return }
            }

            if (this.readOnly || e.target?.closest?.('input, select, textarea, button')) return

            if ((e.key === 'Delete' || e.key === 'Backspace') && ! e.ctrlKey && ! e.metaKey && ! e.altKey) { own(); this.clearSelection(); return }

            if ((e.key === 'Enter' || e.key === ' ') && ! e.ctrlKey && ! e.metaKey && this.grid.toggleActive()) { own(); return }

            if (e.key === 'F2') { own(); this.grid.edit(); return }

            if (e.key.length === 1 && ! e.ctrlKey && ! e.metaKey && ! e.altKey) {
                const opened = this.grid.edit(e.key)
                // A digit on a date or date-time cell is the field's to take (it has no text to set): the default
                // action stays, and only that. Any other first key is in the editor already, or opened it and no more.
                if (opened === 'native') e.stopPropagation()
                else if (opened) own()
            }
        },

        onEscape() {
            if (! this.menu) return
            this.closeMenu()
            // The menu's button held the focus: without this Escape left it on the body and the arrows did nothing.
            this.refocus()
        },

        /* ------------------------------------------------------------ leaving */

        /** Something would be lost by leaving: unsaved cells, or text in an open editor (not a buffered change yet). */
        unsaved() {
            return !! (this.dirty.total || this.grid?.isEditing())
        },

        onBeforeUnload(e) {
            if (! this.confirmLeave || ! this.unsaved()) return
            e.preventDefault()
            e.returnValue = ''
        },

        onNavigate(e) {
            if (! this.confirmLeave || ! this.unsaved()) return
            if (window.confirm(t.confirm_leave)) return
            e.preventDefault()
            // Back / Forward: the browser has moved the address bar already (popstate), and a prevented navigation leaves
            // the sheet under the other page's URL. The sheet's own URL is put back as a new entry (its state is this
            // page's); the one the user left for is one more Back away.
            if (e.detail?.history && this._url && location.href !== this._url) history.pushState(this._state, '', this._url)
        },

        /* ------------------------------------------------------------ menu */

        /** The view's contextmenu handler on the grid element (the one path: Tabulator's rowContext would open it a second time). */
        openMenu(e) {
            this.openMenuFor(this.grid?.rowAt(e), e.clientX, e.clientY)
        },

        /** The menu from the keyboard (Shift+F10, the ContextMenu key): on the active cell's row, at its cell. */
        openMenuAtActive() {
            const a = this.grid?.activeCell()
            const box = this.grid?.activeBox()
            if (! a || ! box) return false
            this.openMenuFor(a.id, box.left + Math.min(box.width, 24), box.top + box.height / 2)

            return !! this.menu
        },

        openMenuFor(id, clientX, clientY) {
            if (! id || this.readOnly || ! this.deletable || this.saving) return
            const created = S.isCreated(this.buffer, id)
            const row = this.rows.find((r) => r.id === id)
            if (! created && ! row?.deletable) return
            const items = S.isDeleted(this.buffer, id)
                ? [{ name: 'keep', label: t.restore_row }]
                : [{ name: 'delete', label: t.delete_row, color: 'danger' }]
            const box = this.$root.getBoundingClientRect()
            this.menu = { id, items, x: clientX - box.left, y: clientY - box.top }
            this.$nextTick(() => this.$refs.menu?.querySelector('button')?.focus())
        },

        runMenu(name) {
            const id = this.menu?.id
            this.closeMenu()
            if (! id || this.saving) return
            if (name === 'delete') this.markDeleted([id])
            if (name === 'keep') this.keepRow(id)
            this.refocus()
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
