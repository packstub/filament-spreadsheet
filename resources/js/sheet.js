/**
 * packstub/filament-spreadsheet — the pure parts of the browser side.
 *
 * Nothing here touches the DOM, Tabulator or Livewire: TSV parsing, coercion per
 * column type (the same rules as the server's columns), the dirty buffer that
 * survives paging, sorting and searching until Save, the payload builder, the
 * undo stack, fill-down, clear and paste planning, and how a save's answer is
 * applied. tests/js runs all of it on plain Node.
 */

/* ------------------------------------------------------------------ TSV */

/**
 * Text from the clipboard (Excel, Sheets, Numbers, a text editor) as rows of
 * cells. Tabs separate cells, newlines rows; a cell may be quoted the way Excel
 * quotes a cell holding a newline, a tab or a quote (`""` is a quote). One
 * trailing newline (Excel always adds it) is not a row.
 */
export function parseTsv(text) {
    const src = String(text ?? '').replace(/\r\n?/g, '\n')
    const rows = []
    let row = []
    let cell = ''
    let i = 0
    let quoted = false

    while (i < src.length) {
        const c = src[i]

        if (quoted) {
            if (c === '"') {
                if (src[i + 1] === '"') { cell += '"'; i += 2; continue }
                quoted = false
                i++
                continue
            }
            cell += c
            i++
            continue
        }

        if (c === '"' && cell === '') { quoted = true; i++; continue }
        if (c === '\t') { row.push(cell); cell = ''; i++; continue }
        if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue }
        cell += c
        i++
    }

    if (cell !== '' || row.length) {
        row.push(cell)
        rows.push(row)
    }

    return rows
}

/** Rows of cells as TSV for the clipboard: a cell with a tab, a newline or a quote is quoted. */
export function toTsv(rows) {
    return rows.map((row) => row.map((v) => {
        const s = v === null || v === undefined ? '' : String(v)
        return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join('\t')).join('\n')
}

/* ------------------------------------------------------------------ coercion */

const TRUTHY = ['1', 'true', 'yes', 'y', 'on', 'da', 'ja', 'oui', 'si', 'sí', 'да', '✓', 'x']
const FALSY = ['0', 'false', 'no', 'n', 'off', 'nu', 'nein', 'non', 'нет', '']

/**
 * A number as a paste from any locale writes it: "1 234,50", "1,234.50",
 * "1.234,50", "1'234.5". Both separators: the last one is the decimal mark. A lone
 * separator is read by `decimal`, the sheet's decimal mark (NumberColumn::parse()
 * alike): the mark itself is decimal when it is alone, the other one is decimal
 * with one or two digits after it and groups thousands otherwise. null for an
 * empty string, NaN for anything else.
 */
export function parseNumber(raw, decimal = '.') {
    if (typeof raw === 'number') return raw
    if (typeof raw === 'boolean') return raw ? 1 : 0
    let s = String(raw ?? '').replace(/[  \s']/g, '')
    if (s === '') return null
    const comma = s.lastIndexOf(',')
    const dot = s.lastIndexOf('.')

    if (comma > -1 && dot > -1) {
        s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
    } else if (comma > -1 || dot > -1) {
        const mark = comma > -1 ? ',' : '.'
        const last = Math.max(comma, dot)
        const after = s.length - last - 1
        const single = s.indexOf(mark) === last
        if (mark === decimal) {
            if (single) s = s.replace(mark, '.')
        } else {
            s = single && after > 0 && after !== 3 ? s.replace(mark, '.') : s.split(mark).join('')
        }
    }

    if (! /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN

    return Number(s)
}

/** true / false for the words a paste brings, null for an empty cell, undefined for anything else. */
export function parseBoolean(raw) {
    if (typeof raw === 'boolean') return raw
    if (raw === null || raw === undefined) return null
    if (typeof raw === 'number') return raw !== 0
    const w = String(raw).trim().toLowerCase()
    if (w === '') return null
    if (TRUTHY.includes(w)) return true
    if (FALSY.includes(w)) return false

    return undefined
}

const ORDER = ['Y', 'y', 'm', 'n', 'd', 'j', 'H', 'G', 'h', 'g', 'i', 's', 'A', 'a']

/**
 * A date (and time) from a string: ISO ("2026-02-28", "2026-02-28T09:30",
 * "2026-02-28 09:30:00"), or the column's own PHP display format when it is
 * numeric ("d/m/Y", "d.m.Y H:i"; month names are not read back). Returns
 * { y, m, d, h, i, s } or undefined; null for an empty string.
 */
export function parseDateParts(raw, format = null) {
    const s = String(raw ?? '').trim()
    if (s === '') return null

    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s)
    let parts = m ? { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), i: +(m[5] || 0), s: +(m[6] || 0) } : null

    if (! parts && format) {
        // The display format as a regex: each numeric token captures digits, the rest is literal.
        const tokens = []
        let re = '^'
        for (let k = 0; k < format.length; k++) {
            const c = format[k]
            if (c === '\\' && k + 1 < format.length) { re += escapeRe(format[++k]); continue }
            if (ORDER.includes(c)) { tokens.push(c); re += c === 'A' || c === 'a' ? '\\s*([AaPp][Mm])' : c === 'Y' ? '(\\d{4})' : '(\\d{1,2})'; continue }
            if (c === ' ') { re += '\\s+'; continue }
            re += escapeRe(c)
        }
        re += '$'
        m = new RegExp(re).exec(s)
        if (m) {
            parts = { y: NaN, m: NaN, d: NaN, h: 0, i: 0, s: 0, pm: null }
            tokens.forEach((t, k) => {
                const v = m[k + 1]
                if (t === 'Y') parts.y = +v
                else if (t === 'y') parts.y = 2000 + +v
                else if (t === 'm' || t === 'n') parts.m = +v
                else if (t === 'd' || t === 'j') parts.d = +v
                else if (t === 'H' || t === 'G' || t === 'h' || t === 'g') parts.h = +v
                else if (t === 'i') parts.i = +v
                else if (t === 's') parts.s = +v
                else parts.pm = v.toLowerCase() === 'pm'
            })
            if (parts.pm === true && parts.h < 12) parts.h += 12
            if (parts.pm === false && parts.h === 12) parts.h = 0
            delete parts.pm
        }
    }

    if (! parts) return undefined
    if (parts.y < 1000 || parts.y > 9999 || parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.h > 23 || parts.i > 59 || parts.s > 59) return undefined
    if (parts.d > new Date(Date.UTC(parts.y, parts.m, 0)).getUTCDate()) return undefined

    return parts
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
}

const pad = (n) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" or undefined / null (see parseDateParts). */
export function parseDate(raw, format = null) {
    const p = parseDateParts(raw, format)

    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : p
}

/** "YYYY-MM-DD HH:MM:SS" or undefined / null. */
export function parseDateTime(raw, format = null) {
    const p = parseDateParts(raw, format)

    return p ? `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.i)}:${pad(p.s)}` : p
}

/** A PHP date format ("d/m/Y", "M j, Y H:i") applied to an ISO date or date-time string. */
export function phpDate(iso, pattern, locale = 'en') {
    const p = parseDateParts(iso)
    if (! p) return iso ?? ''
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d, p.h, p.i, p.s))
    const name = (options) => new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(d)
    const h12 = p.h % 12 || 12
    const tokens = {
        d: pad(p.d), j: String(p.d), D: name({ weekday: 'short' }), l: name({ weekday: 'long' }),
        m: pad(p.m), n: String(p.m), M: name({ month: 'short' }), F: name({ month: 'long' }),
        y: String(p.y).slice(-2), Y: String(p.y),
        H: pad(p.h), G: String(p.h), h: pad(h12), g: String(h12), i: pad(p.i), s: pad(p.s),
        a: p.h < 12 ? 'am' : 'pm', A: p.h < 12 ? 'AM' : 'PM',
    }
    let out = ''
    for (let k = 0; k < pattern.length; k++) {
        const c = pattern[k]
        if (c === '\\' && k + 1 < pattern.length) { out += pattern[++k]; continue }
        out += tokens[c] ?? c
    }

    return out
}

/** The option whose label (case and spaces aside) or value matches; undefined when none. */
export function matchOption(options, raw) {
    if (raw === null || raw === undefined) return null
    const s = String(raw).trim()
    if (s === '') return null
    const exact = options.find((o) => o.value === s)
    if (exact) return exact.value
    const lower = s.toLowerCase()
    const byLabel = options.find((o) => String(o.label).trim().toLowerCase() === lower)
    if (byLabel) return byLabel.value
    const byValue = options.find((o) => String(o.value).toLowerCase() === lower)

    return byValue ? byValue.value : undefined
}

/**
 * What a typed or pasted value becomes for a column: { ok: true, value } with
 * the value the server expects (a number, a boolean, an option key, an ISO date),
 * or { ok: false, value, error } with the message for the cell. The same rules
 * as the server's columns, so what the browser accepts the server accepts.
 */
export function coerce(column, raw, t = {}) {
    const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
    const fail = (key, fallback) => ({ ok: false, value: raw, error: t[key] ?? fallback })

    if (empty) return { ok: true, value: null }

    switch (column.type) {
        case 'number': {
            const n = parseNumber(raw, column.decimal ?? '.')
            if (n === null || Number.isNaN(n) || ! Number.isFinite(n)) return fail('not_a_number', 'Not a number.')
            if (column.integer && ! Number.isInteger(n)) return fail('not_an_integer', 'Not a whole number.')
            if (column.integer && ! Number.isSafeInteger(n)) return fail('integer_too_large', 'Too large a whole number.')

            return { ok: true, value: column.decimals != null ? round(n, column.decimals) : n }
        }
        case 'boolean': {
            const b = parseBoolean(raw)

            return b === undefined ? fail('not_a_boolean', 'Not a yes/no value.') : { ok: true, value: b }
        }
        case 'select': {
            const v = matchOption(column.options ?? [], raw)

            return v === undefined ? fail('not_an_option', 'Not one of the options.') : { ok: true, value: v }
        }
        case 'date': {
            const v = parseDate(raw, column.format)

            return v === undefined ? fail('not_a_date', 'Not a date (YYYY-MM-DD).') : { ok: true, value: v }
        }
        case 'datetime': {
            const v = parseDateTime(raw, column.format)

            return v === undefined ? fail('not_a_datetime', 'Not a date and time (YYYY-MM-DD HH:MM).') : { ok: true, value: v }
        }
        default:
            return { ok: true, value: typeof raw === 'string' ? raw : String(raw) }
    }
}

// A number column rounds as a formula does (half away from zero, NumberColumn::coerce() alike).
const round = (n, decimals) => formulaRound(n, decimals)

/** A value as text for the clipboard or a tooltip: labels for options, ISO dates, TRUE/FALSE. */
export function display(column, value, locale = 'en') {
    if (value === null || value === undefined) return ''

    switch (column.type) {
        case 'select':
            return (column.options ?? []).find((o) => o.value === String(value))?.label ?? String(value)
        case 'boolean':
            return value ? 'TRUE' : 'FALSE'
        case 'number':
        case 'computed':
            return typeof value === 'number' && column.decimals != null ? value.toFixed(column.decimals) : String(value)
        case 'date':
            return column.format ? phpDate(value, column.format, locale) : String(value)
        case 'datetime':
            return column.format ? phpDate(value, column.format, locale) : String(value)
        default:
            return String(value)
    }
}

/* ------------------------------------------------------------------ formulas */

/*
 * A ComputedColumn's formula arrives as the tree the server parsed (Formula::toArray()):
 * ['num', 1.5], ['str', 'a'], ['lit', true|false|null], ['ref', 'price'], ['neg', x],
 * ['op', '+', a, b], ['call', 'round', [args]]. This evaluator mirrors Formula.php rule
 * for rule, so a row recomputed here shows what the server sends after the save.
 */

// ASCII blanks only around the number, as Formula::number(): `\s` and trim() would take a no-break space too.
const NUMERIC = /^[ \t\n\r]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[ \t\n\r]*$/

/** A value as a number: null for an empty cell and for text that is not a number. */
export function formulaNumber(v) {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string' && NUMERIC.test(v)) {
        const n = Number(v)

        return Number.isFinite(n) ? n : null
    }

    return null
}

/** Round half away from zero, the same arithmetic as Formula::round(). */
export function formulaRound(x, digits = 0) {
    digits = Math.max(-12, Math.min(12, digits))
    const f = 10 ** Math.abs(digits)
    const sign = x < 0 ? -1 : 1
    // Cut to 15 significant digits first, as Formula::significant() does: round(1.005, 2) is 1.01.
    const raw = digits >= 0 ? Math.abs(x) * f : Math.abs(x) / f
    const scaled = raw < 1e14 ? Number(raw.toExponential(14)) : raw
    // From 2^52 on every double is whole, and + 0.5 would round to even (2^53 - 1 becoming 2^53).
    const whole = scaled >= 4503599627370496 ? scaled : Math.floor(scaled + 0.5)
    const r = digits >= 0 ? whole / f : whole * f

    return r === 0 ? 0 : sign * r
}

const formulaText = (v) => v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)

const truthy = (v) => v === null || v === undefined ? false : typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : String(v) !== ''

function finish(v) {
    if (v === undefined) return null
    if (typeof v === 'number') return Number.isFinite(v) ? (v === 0 ? 0 : v) : null

    return v === '' ? null : v
}

function compare(op, a, b) {
    a = a === '' || a === undefined ? null : a
    b = b === '' || b === undefined ? null : b
    if (a === null || b === null) {
        const same = a === b

        return op === '=' ? same : op === '!=' ? ! same : false
    }
    const na = formulaNumber(a)
    const nb = formulaNumber(b)
    let c
    if (na !== null && nb !== null) c = na < nb ? -1 : na > nb ? 1 : 0
    else {
        const ta = formulaText(a)
        const tb = formulaText(b)
        c = ta < tb ? -1 : ta > tb ? 1 : 0
    }

    return { '=': c === 0, '!=': c !== 0, '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[op]
}

function evalNode(node, get) {
    switch (node[0]) {
        case 'num':
        case 'str':
        case 'lit':
            return node[1]
        case 'ref':
            return get(node[1])
        case 'neg': {
            const x = formulaNumber(evalNode(node[1], get))

            return x === null ? null : 0 - x
        }
        case 'op': {
            const op = node[1]
            const a = evalNode(node[2], get)
            const b = evalNode(node[3], get)
            if (op === '&') return formulaText(finish(a)) + formulaText(finish(b))
            if (['=', '!=', '<', '<=', '>', '>='].includes(op)) return compare(op, a, b)
            const x = formulaNumber(a)
            const y = formulaNumber(b)
            if (x === null || y === null || ((op === '/' || op === '%') && y === 0)) return null
            const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x % y

            return Number.isFinite(r) ? r : null
        }
        case 'call':
            return callFn(node[1], node[2], get)
    }

    return null
}

function callFn(name, args, get) {
    const arg = (i) => args[i] ? evalNode(args[i], get) : null
    const numbers = () => args.map((a) => formulaNumber(evalNode(a, get))).filter((n) => n !== null)

    switch (name) {
        case 'if': return truthy(arg(0)) ? arg(1) : arg(2)
        case 'and': return args.every((_, i) => truthy(arg(i)))
        case 'or': return args.some((_, i) => truthy(arg(i)))
        case 'not': return ! truthy(arg(0))
        case 'coalesce': {
            for (let i = 0; i < args.length; i++) {
                const v = arg(i)
                if (v !== null && v !== undefined && v !== '') return v
            }

            return null
        }
        case 'sum': return numbers().reduce((carry, n) => carry + n, 0)
        case 'min':
        case 'max': {
            const list = numbers()

            return list.length ? list.reduce((carry, n) => (name === 'min' ? (n < carry ? n : carry) : (n > carry ? n : carry))) : null
        }
    }

    const x = formulaNumber(arg(0))
    if (x === null) return null

    switch (name) {
        case 'round': return formulaRound(x, Math.trunc(formulaNumber(args[1] ? arg(1) : 0) ?? 0))
        case 'floor': return Math.floor(x)
        case 'ceil': return Math.ceil(x)
        case 'abs': return Math.abs(x)
    }

    return null
}

/** A formula tree's value; `get(name)` is a column's value in the row. */
export function evaluateFormula(tree, get) {
    return finish(evalNode(tree, get))
}

/**
 * The row's values with every formula column computed from the others (a formula
 * column read by another is computed first). What the server's presentRow() does.
 */
export function computeRow(columns, values) {
    const formulas = {}
    for (const c of columns) if (c.type === 'computed' && Array.isArray(c.formula)) formulas[c.name] = c
    const names = Object.keys(formulas)
    if (! names.length) return values

    const out = { ...values }
    const done = {}
    const get = (name) => {
        if (formulas[name] && ! done[name]) {
            done[name] = true
            let v = evaluateFormula(formulas[name].formula, get)
            if (typeof v === 'number' && formulas[name].decimals != null) v = formulaRound(v, formulas[name].decimals)
            out[name] = v
        }

        return out[name] ?? null
    }
    for (const name of names) get(name)

    return out
}

/** Two cell values are the same for the buffer (null and '' both mean empty). */
export function same(a, b) {
    const na = a === '' ? null : a
    const nb = b === '' ? null : b

    return na === nb || (typeof na === 'number' && typeof nb === 'number' && Object.is(na, nb))
}

/* ------------------------------------------------------------------ the buffer */

/**
 * Everything unsaved: the changed cells by record id with the original values
 * (so a change back to the original is no change), the version each record had
 * when first touched, the page it was on, the new rows by a temporary id, the
 * ids marked for deletion, the undo and redo stacks, and what the last save
 * refused (errors per cell, per row, conflicts).
 */
export function createBuffer() {
    return {
        changes: {}, originals: {}, versions: {}, pages: {},
        created: {}, createdOrder: [], deleted: {},
        undo: [], redo: [],
        errors: {}, rowErrors: {}, conflicts: {},
        seq: 0,
    }
}

export function isCreated(buffer, id) {
    return Object.prototype.hasOwnProperty.call(buffer.created, id)
}

export function isDeleted(buffer, id) {
    return buffer.deleted[id] === true
}

/** The dirty value of a cell, or undefined when it is not dirty. */
export function dirtyValue(buffer, id, col) {
    if (isCreated(buffer, id)) return buffer.created[id][col]
    const row = buffer.changes[id]

    return row && Object.prototype.hasOwnProperty.call(row, col) ? row[col] : undefined
}

/** Counts for the toolbar: changed cells, rows touched, pages they sit on, new rows, deletions. */
export function summary(buffer) {
    let cells = 0
    const rows = Object.keys(buffer.changes)
    for (const id of rows) cells += Object.keys(buffer.changes[id]).length
    const pages = new Set(rows.map((id) => buffer.pages[id] ?? 1))
    const created = buffer.createdOrder.length
    const deleted = Object.keys(buffer.deleted).length

    return { cells, rows: rows.length, pages: pages.size, created, deleted, total: cells + created + deleted }
}

function forget(buffer, id) {
    delete buffer.changes[id]
    delete buffer.originals[id]
    delete buffer.versions[id]
    delete buffer.pages[id]
}

/**
 * Apply cell edits: [{ id, col, from, to, version?, page? }]. `from` is the value
 * the cell shows now; the original (what the server sent) is remembered the first
 * time a cell is touched, and a value equal to it clears the change. Records one
 * undo step for the edits that changed something (record: false for an undo/redo
 * replay). Returns those edits.
 */
export function applyEdits(buffer, edits, { record = true, page = null } = {}) {
    const applied = []

    for (const e of edits) {
        if (same(e.from, e.to)) continue
        // The version and page travel with the undo step: a redo of a row's first edit needs them too.
        applied.push({ id: e.id, col: e.col, from: e.from, to: e.to, version: e.version ?? null, page: e.page ?? page ?? 1 })

        // A cell edited again is no longer the one the last save refused: its error and conflict go, on a new row too.
        if (buffer.errors[e.id]) delete buffer.errors[e.id][e.col]
        if (buffer.conflicts[e.id]) delete buffer.conflicts[e.id][e.col]

        if (isCreated(buffer, e.id)) {
            buffer.created[e.id][e.col] = e.to
            continue
        }

        buffer.originals[e.id] ??= {}
        if (! Object.prototype.hasOwnProperty.call(buffer.originals[e.id], e.col)) buffer.originals[e.id][e.col] = e.from
        if (e.version !== undefined && e.version !== null && buffer.versions[e.id] === undefined) buffer.versions[e.id] = e.version
        if (buffer.pages[e.id] === undefined) buffer.pages[e.id] = e.page ?? page ?? 1

        if (same(buffer.originals[e.id][e.col], e.to)) {
            if (buffer.changes[e.id]) delete buffer.changes[e.id][e.col]
            delete buffer.originals[e.id][e.col]
            if (buffer.changes[e.id] && Object.keys(buffer.changes[e.id]).length === 0) forget(buffer, e.id)
        } else {
            buffer.changes[e.id] ??= {}
            buffer.changes[e.id][e.col] = e.to
        }
    }

    if (record && applied.length) {
        buffer.undo.push({ type: 'edit', edits: applied })
        buffer.redo = []
    }

    return applied
}

/** A new row from the columns' defaults (plus values): its temporary id. */
export function addCreated(buffer, values, { record = true, id = null } = {}) {
    const temp = id ?? `n${++buffer.seq}`
    buffer.created[temp] = { ...values }
    buffer.createdOrder.push(temp)
    if (record) {
        buffer.undo.push({ type: 'create', id: temp, values: { ...values } })
        buffer.redo = []
    }

    return temp
}

export function removeCreated(buffer, id, { record = true } = {}) {
    if (! isCreated(buffer, id)) return null
    const values = buffer.created[id]
    delete buffer.created[id]
    buffer.createdOrder = buffer.createdOrder.filter((x) => x !== id)
    delete buffer.errors[id]
    delete buffer.rowErrors[id]
    if (record) {
        buffer.undo.push({ type: 'uncreate', id, values })
        buffer.redo = []
    }

    return values
}

/** Mark records for deletion (a new row is simply dropped). Returns { deleted: ids marked, dropped: temp ids removed }. */
export function markDeleted(buffer, ids, { record = true } = {}) {
    const deleted = []
    const dropped = []

    for (const id of ids) {
        if (isCreated(buffer, id)) {
            removeCreated(buffer, id, { record })
            dropped.push(id)
        } else if (! buffer.deleted[id]) {
            buffer.deleted[id] = true
            deleted.push(id)
        }
    }

    if (record && deleted.length) {
        buffer.undo.push({ type: 'delete', ids: deleted })
        buffer.redo = []
    }

    return { deleted, dropped }
}

export function unmarkDeleted(buffer, ids, { record = true } = {}) {
    const kept = ids.filter((id) => buffer.deleted[id])
    for (const id of kept) delete buffer.deleted[id]
    if (record && kept.length) {
        buffer.undo.push({ type: 'undelete', ids: kept })
        buffer.redo = []
    }

    return kept
}

/**
 * Undo the last step. Answers with what the grid must do: { edits } to write
 * back (from → to already inverted), { created } rows to show again,
 * { removed } temp ids to take away, { undeleted } / { deleted } ids to repaint.
 */
export function undo(buffer) {
    const step = buffer.undo.pop()
    if (! step) return null
    buffer.redo.push(step)

    return replay(buffer, step, true)
}

export function redo(buffer) {
    const step = buffer.redo.pop()
    if (! step) return null
    buffer.undo.push(step)

    return replay(buffer, step, false)
}

function replay(buffer, step, inverse) {
    const out = { edits: [], created: [], removed: [], deleted: [], undeleted: [] }

    switch (step.type) {
        case 'edit': {
            const edits = (inverse ? [...step.edits].reverse() : step.edits).map((e) => inverse ? { ...e, from: e.to, to: e.from } : e)
            out.edits = applyEdits(buffer, edits, { record: false })
            break
        }
        case 'create':
        case 'uncreate': {
            const create = (step.type === 'create') !== inverse
            if (create) {
                addCreated(buffer, step.values, { record: false, id: step.id })
                out.created.push({ id: step.id, values: { ...step.values } })
            } else {
                removeCreated(buffer, step.id, { record: false })
                out.removed.push(step.id)
            }
            break
        }
        case 'delete':
        case 'undelete': {
            const del = (step.type === 'delete') !== inverse
            if (del) {
                markDeleted(buffer, step.ids, { record: false })
                out.deleted = [...step.ids]
            } else {
                unmarkDeleted(buffer, step.ids, { record: false })
                out.undeleted = [...step.ids]
            }
            break
        }
        case 'paste': {
            // One step for the whole paste: the edits and the rows it created go and come back together.
            if (inverse) {
                for (const c of [...step.created].reverse()) {
                    removeCreated(buffer, c.id, { record: false })
                    out.removed.push(c.id)
                }
                out.edits = applyEdits(buffer, [...step.edits].reverse().map((e) => ({ ...e, from: e.to, to: e.from })), { record: false })
            } else {
                out.edits = applyEdits(buffer, step.edits, { record: false })
                for (const c of step.created) {
                    addCreated(buffer, c.values, { record: false, id: c.id })
                    out.created.push({ id: c.id, values: { ...c.values } })
                }
                paintInvalid(buffer, step.invalid ?? [])
            }
            break
        }
    }

    return out
}

/** @param {Array<{ id: string, col: string, error: string }>} invalid */
function paintInvalid(buffer, invalid) {
    for (const i of invalid) {
        buffer.errors[i.id] ??= {}
        buffer.errors[i.id][i.col] = i.error
    }
}

/**
 * Apply a paste plan to the buffer as one undo step: the edits, the rows it
 * creates and the cells it could not read, so Ctrl+Z after a paste that made a
 * thousand rows takes the whole paste back at once. `maxRows` (the server's
 * `max_rows_per_save`) caps the rows the buffer may hold: past it no row is
 * created and `capped` counts the lines left out. Returns { edits, created:
 * [{ id, values }], invalid: [{ id, col, error }] (the new rows' by their temp
 * id), capped }.
 */
export function applyPaste(buffer, plan, { page = null, maxRows = null } = {}) {
    const edits = applyEdits(buffer, plan.edits, { record: false, page })

    const s = summary(buffer)
    const room = maxRows === null || maxRows === undefined ? Infinity : Math.max(0, maxRows - (s.rows + s.created + s.deleted))
    const created = []
    for (const c of plan.created.slice(0, room)) {
        const id = addCreated(buffer, c.values, { record: false })
        created.push({ id, values: { ...c.values } })
    }
    const capped = plan.created.length - created.length

    const invalid = []
    for (const i of plan.invalid) {
        if (i.id !== null) invalid.push({ id: i.id, col: i.col, error: i.error })
        else if (created[i.created]) invalid.push({ id: created[i.created].id, col: i.col, error: i.error })
    }
    paintInvalid(buffer, invalid)

    if (edits.length || created.length) {
        buffer.undo.push({ type: 'paste', edits, created, invalid })
        buffer.redo = []
    }

    return { edits, created, invalid, capped }
}

/** The Save payload: what the server's SavePayload::fromArray() reads. */
export function buildPayload(buffer) {
    const changed = {}
    const versions = {}
    for (const id of Object.keys(buffer.changes)) {
        changed[id] = { ...buffer.changes[id] }
        if (buffer.versions[id] !== undefined && buffer.versions[id] !== null) versions[id] = buffer.versions[id]
    }
    const created = {}
    for (const id of buffer.createdOrder) created[id] = { ...buffer.created[id] }

    return { changed, versions, created, deleted: Object.keys(buffer.deleted) }
}

/**
 * Apply a save's answer. Saved rows leave the buffer (their authoritative rows
 * are returned for the grid), refused ones stay with their errors and conflicts
 * painted; a rolled-back save keeps everything and paints the errors. Returns
 * { saved: [{ id, row }], created: [{ temp, row }], deleted: [ids], failed: [ids] }.
 */
export function applyResult(buffer, result) {
    const out = { saved: [], created: [], deleted: [], failed: [] }
    const obj = (v) => (v && typeof v === 'object' && ! Array.isArray(v)) ? v : {}
    const saved = obj(result.saved)
    const created = obj(result.created)

    buffer.errors = {}
    buffer.rowErrors = {}
    buffer.conflicts = {}

    for (const [id, errors] of Object.entries(obj(result.errors))) buffer.errors[id] = { ...obj(errors) }
    for (const [id, message] of Object.entries(obj(result.rowErrors))) buffer.rowErrors[id] = String(message)
    for (const [id, theirs] of Object.entries(obj(result.conflicts))) {
        buffer.conflicts[id] = { ...obj(theirs) }
        const version = obj(result.versions)[id]
        if (version !== undefined && buffer.changes[id]) buffer.versions[id] = version
    }

    if (result.rolledBack) {
        out.failed = [...new Set([...Object.keys(buffer.errors), ...Object.keys(buffer.rowErrors), ...Object.keys(buffer.conflicts)])]

        return out
    }

    for (const [id, row] of Object.entries(saved)) {
        forget(buffer, id)
        out.saved.push({ id, row })
    }

    for (const [temp, row] of Object.entries(created)) {
        if (isCreated(buffer, temp)) removeCreated(buffer, temp, { record: false })
        out.created.push({ temp, row })
    }

    for (const id of Array.isArray(result.deleted) ? result.deleted : []) {
        delete buffer.deleted[id]
        forget(buffer, id)
        out.deleted.push(String(id))
    }

    out.failed = [...new Set([...Object.keys(buffer.errors), ...Object.keys(buffer.rowErrors), ...Object.keys(buffer.conflicts)])]

    // What was saved can no longer be undone: the stacks are cleared when anything went through.
    if (out.saved.length || out.created.length || out.deleted.length) {
        buffer.undo = []
        buffer.redo = []
    }

    return out
}

/** Drop everything unsaved. Returns the ids the grid must repaint (changed, deleted) and the temp rows to remove. */
export function discard(buffer) {
    const ids = [...new Set([...Object.keys(buffer.changes), ...Object.keys(buffer.deleted), ...Object.keys(buffer.errors), ...Object.keys(buffer.conflicts), ...Object.keys(buffer.rowErrors)])]
    const removed = [...buffer.createdOrder]
    const fresh = createBuffer()
    fresh.seq = buffer.seq
    Object.assign(buffer, fresh)

    return { ids, removed }
}

/** A server row with the buffer laid over it: the values shown and per-cell flags. */
export function overlay(buffer, row) {
    const values = { ...row.values }
    const dirty = {}
    const changes = buffer.changes[row.id]
    if (changes) for (const col of Object.keys(changes)) { values[col] = changes[col]; dirty[col] = true }

    return {
        values, dirty,
        errors: buffer.errors[row.id] ?? {},
        conflicts: buffer.conflicts[row.id] ?? {},
        rowError: buffer.rowErrors[row.id] ?? null,
        deleted: isDeleted(buffer, row.id),
    }
}

/** How many cells and rows the last save refused. */
export function errorCount(buffer) {
    let n = 0
    for (const id of Object.keys(buffer.errors)) n += Object.keys(buffer.errors[id]).length
    for (const id of Object.keys(buffer.conflicts)) n += Object.keys(buffer.conflicts[id]).length
    n += Object.keys(buffer.rowErrors).length

    return n
}

/* ------------------------------------------------------------------ paste and fill */

/** Whether a cell may be edited: the column must be editable and not read-only, the row not read-only, deleted or locked for that column. */
export function editable(column, row, readOnly = false) {
    if (readOnly || ! column || ! column.editable || column.readOnly) return false
    if (! row) return false
    if (row.readOnly || row.deleted) return false
    if (Array.isArray(row.locked) && row.locked.includes(column.name)) return false

    return true
}

/**
 * Plan a paste: a matrix of strings dropped at (startRow, startCol) over the
 * rows on the page (each { id, values, locked, readOnly, deleted }) and the
 * visible columns. A single pasted cell over a wider selection fills it (as in
 * Excel); rows past the last one become new rows when creatable. Returns
 * { edits: [{ id, col, from, to }], created: [{ values }], invalid: [{ id, col, error }], skipped: count };
 * an unreadable cell of a new row has `id: null` and `created`, its index into `created`
 * (the row has no id until applyPaste() adds it).
 */
export function pastePlan({ matrix, startRow, startCol, rows, columns, creatable = false, readOnly = false, defaults = {}, selection = null, t = {} }) {
    let cells = matrix
    if (cells.length === 1 && cells[0].length === 1 && selection && (selection.rows > 1 || selection.cols > 1)) {
        cells = Array.from({ length: selection.rows }, () => Array.from({ length: selection.cols }, () => cells[0][0]))
    }

    const out = { edits: [], created: [], invalid: [], skipped: 0 }

    cells.forEach((line, r) => {
        const rowIndex = startRow + r
        let row = rows[rowIndex]
        let fresh = null

        if (! row) {
            if (! creatable || readOnly) { out.skipped += line.length; return }
            fresh = { values: { ...defaults } }
            out.created.push(fresh)
        }

        line.forEach((raw, c) => {
            const column = columns[startCol + c]
            if (! column) { out.skipped++; return }

            if (fresh) {
                if (! column.editable || column.readOnly) { out.skipped++; return }
                const res = coerce(column, raw, t)
                fresh.values[column.name] = res.value
                if (! res.ok) out.invalid.push({ id: null, created: out.created.length - 1, col: column.name, error: res.error })

                return
            }

            if (! editable(column, row, readOnly)) { out.skipped++; return }
            const res = coerce(column, raw, t)
            out.edits.push({ id: row.id, col: column.name, from: row.values[column.name] ?? null, to: res.value, version: row.version })
            if (! res.ok) out.invalid.push({ id: row.id, col: column.name, error: res.error })
        })
    })

    return out
}

/**
 * Plan a fill-down (Ctrl+D): the first row of the selection is copied into the
 * rows below it, column by column, where the cell may be edited.
 */
export function fillDownPlan({ rows, columns, top, bottom, left, right, readOnly = false }) {
    const edits = []
    const source = rows[top]
    if (! source || bottom <= top) return edits

    for (let c = left; c <= right; c++) {
        const column = columns[c]
        if (! column) continue
        const value = source.values[column.name] ?? null

        for (let r = top + 1; r <= bottom; r++) {
            const row = rows[r]
            if (! editable(column, row, readOnly)) continue
            edits.push({ id: row.id, col: column.name, from: row.values[column.name] ?? null, to: value, version: row.version })
        }
    }

    return edits
}

/**
 * Plan a clear (Delete, Backspace, the second half of a cut): every cell of the
 * selection that may be edited becomes null; a locked, read-only or computed
 * cell is left alone.
 */
export function clearPlan({ rows, columns, top, bottom, left, right, readOnly = false }) {
    const edits = []

    for (let r = top; r <= bottom; r++) {
        const row = rows[r]
        if (! row) continue

        for (let c = left; c <= right; c++) {
            const column = columns[c]
            if (! editable(column, row, readOnly)) continue
            edits.push({ id: row.id, col: column.name, from: row.values[column.name] ?? null, to: null, version: row.version })
        }
    }

    return edits
}

/* ------------------------------------------------------------------ strings */

/** Laravel's "{0} none|{1} one|[2,*] :count many" strings. */
export function choice(text, count, replace = {}) {
    const parts = String(text ?? '').split('|')
    let chosen = null

    for (const part of parts) {
        const m = /^\s*(?:\{(-?\d+)\}|\[(-?\d+|\*),\s*(-?\d+|\*)\])\s*(.*)$/s.exec(part)
        if (! m) continue
        if (m[1] !== undefined && Number(m[1]) === count) { chosen = m[4]; break }
        if (m[2] !== undefined) {
            const lo = m[2] === '*' ? -Infinity : Number(m[2])
            const hi = m[3] === '*' ? Infinity : Number(m[3])
            if (count >= lo && count <= hi) { chosen = m[4]; break }
        }
    }

    if (chosen === null) {
        const plain = parts.map((p) => p.replace(/^\s*(?:\{[^}]*\}|\[[^\]]*\])\s*/, ''))
        chosen = plain.length > 1 ? (count === 1 ? plain[0] : plain[1]) : plain[0]
    }

    let out = chosen.replace(/:count/g, String(count))
    for (const [k, v] of Object.entries(replace)) out = out.replace(new RegExp(`:${k}`, 'g'), String(v))

    return out
}

/* ------------------------------------------------------------------ keys */

/** "mod+s", "ctrl+shift+d", "f2", "mod+enter" → { key, mod, ctrl, meta, shift, alt }. */
export function parseKeybinding(spec) {
    const parts = String(spec ?? '').toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
    const b = { key: parts.pop() ?? '', mod: false, ctrl: false, meta: false, shift: false, alt: false }
    for (const p of parts) {
        if (p === 'mod' || p === 'cmd' || p === 'command') b.mod = true
        else if (p === 'ctrl' || p === 'control') b.ctrl = true
        else if (p === 'meta') b.meta = true
        else if (p === 'shift') b.shift = true
        else if (p === 'alt' || p === 'option') b.alt = true
    }

    return b
}

/** Whether a keyboard event is that binding ("mod" is Ctrl or ⌘). */
export function matchesKey(event, binding) {
    const key = String(event.key ?? '').toLowerCase()
    const wanted = binding.key === 'esc' ? 'escape' : binding.key === 'return' ? 'enter' : binding.key
    if (key !== wanted) return false
    const primary = !! (event.ctrlKey || event.metaKey)
    if (binding.mod && ! primary) return false
    if (! binding.mod && (!! event.ctrlKey !== binding.ctrl || !! event.metaKey !== binding.meta)) return false
    if (!! event.shiftKey !== binding.shift) return false
    if (!! event.altKey !== binding.alt) return false

    return true
}

export const DEFAULT_KEYS = { save: 'mod+s', fill_down: 'mod+d', undo: 'mod+z', redo: 'mod+y', add_row: 'mod+enter', cut: 'mod+x' }
