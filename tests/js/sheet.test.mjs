import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as S from '../../resources/js/sheet.js'

const T = { not_a_number: 'NaN!', not_an_option: 'Opt!', not_a_date: 'Date!', not_a_datetime: 'When!', not_a_boolean: 'Bool!' }

const columns = [
    { name: 'sku', type: 'text', editable: true, readOnly: false, default: null },
    { name: 'price', type: 'number', editable: true, readOnly: false, decimals: 2, default: null },
    { name: 'stock', type: 'number', editable: true, readOnly: false, integer: true, decimals: 0, default: 0 },
    { name: 'category_id', type: 'select', editable: true, readOnly: false, options: [{ value: '1', label: 'Tools' }, { value: '2', label: 'Paint' }], default: null },
    { name: 'is_active', type: 'boolean', editable: true, readOnly: false, default: true },
    { name: 'available_on', type: 'date', editable: true, readOnly: false, format: 'd/m/Y', default: null },
    { name: 'published_at', type: 'datetime', editable: true, readOnly: false, format: 'd.m.Y H:i', default: null },
    { name: 'margin', type: 'computed', editable: false, readOnly: true, default: null },
]

const row = (id, values = {}, over = {}) => ({ id: String(id), version: `v${id}`, values: { sku: `S-${id}`, price: 10, stock: 1, category_id: '1', is_active: true, available_on: '2026-10-05', published_at: null, margin: 4, ...values }, locked: [], readOnly: false, deleted: false, ...over })

/* ------------------------------------------------------------------ TSV */

test('parseTsv reads what Excel and Sheets put on the clipboard', () => {
    assert.deepEqual(S.parseTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']])
    assert.deepEqual(S.parseTsv('a\tb\nc'), [['a', 'b'], ['c']])
    assert.deepEqual(S.parseTsv('"multi\nline"\t"say ""hi"""\nx\t'), [['multi\nline', 'say "hi"'], ['x', '']])
    assert.deepEqual(S.parseTsv('single'), [['single']])
    assert.deepEqual(S.parseTsv(''), [])
    assert.deepEqual(S.parseTsv('\n'), [['']])
    assert.equal(S.toTsv([['a', 'b\tc'], [null, 'q"q']]), 'a\t"b\tc"\n\t"q""q"')
})

/* ------------------------------------------------------------------ coercion */

test('parseNumber reads every locale the way the server does', () => {
    assert.equal(S.parseNumber('1 234,50'), 1234.5)
    assert.equal(S.parseNumber('1,234.50'), 1234.5)
    assert.equal(S.parseNumber('1.234,50'), 1234.5)
    assert.equal(S.parseNumber("1'234.5"), 1234.5)
    assert.equal(S.parseNumber('1 234'), 1234)
    assert.equal(S.parseNumber('1,234'), 1234)
    assert.equal(S.parseNumber('1,234,567'), 1234567)
    assert.equal(S.parseNumber('0,5'), 0.5)
    assert.equal(S.parseNumber('12,50'), 12.5)
    assert.equal(S.parseNumber('-3'), -3)
    assert.equal(S.parseNumber('1e3'), 1000)
    assert.equal(S.parseNumber('12.'), 12)
    assert.equal(S.parseNumber(''), null)
    assert.ok(Number.isNaN(S.parseNumber('abc')))
    assert.ok(Number.isNaN(S.parseNumber('1.2.3')))
    assert.ok(Number.isNaN(S.parseNumber('0x1A')))

    // A comma locale: the comma is always the decimal mark, a lone dot with three-digit groups separates thousands.
    assert.equal(S.parseNumber('0,125', ','), 0.125)
    assert.equal(S.parseNumber('1,234', ','), 1.234)
    assert.equal(S.parseNumber('1.234', ','), 1234)
    assert.equal(S.parseNumber('1.5', ','), 1.5)
    assert.equal(S.parseNumber('1.234.567', ','), 1234567)
    assert.equal(S.parseNumber('1.234,5', ','), 1234.5)
    assert.ok(Number.isNaN(S.parseNumber('1,2,3', ',')))
    assert.equal(S.parseNumber('0,125', '.'), 125)
    assert.equal(S.coerce({ type: 'number', decimal: ',' }, '0,125').value, 0.125)
    assert.equal(S.coerce({ type: 'number' }, '0,125').value, 125)
    assert.equal(S.parseNumber(7), 7)
})

test('parseBoolean reads the words a paste brings', () => {
    assert.equal(S.parseBoolean('Yes'), true)
    assert.equal(S.parseBoolean(' on '), true)
    assert.equal(S.parseBoolean('да'), true)
    assert.equal(S.parseBoolean('N'), false)
    assert.equal(S.parseBoolean('0'), false)
    assert.equal(S.parseBoolean(''), null)
    assert.equal(S.parseBoolean(null), null)
    assert.equal(S.parseBoolean(2), true)
    assert.equal(S.parseBoolean('perhaps'), undefined)
})

test('dates are read as ISO or in the column\'s display format, never guessed', () => {
    assert.equal(S.parseDate('2026-02-28'), '2026-02-28')
    assert.equal(S.parseDate('2026-2-8'), '2026-02-08')
    assert.equal(S.parseDate('2026-02-28T10:00:00Z'), '2026-02-28')
    assert.equal(S.parseDate('28/02/2026', 'd/m/Y'), '2026-02-28')
    assert.equal(S.parseDate('8.2.26', 'j.n.y'), '2026-02-08')
    assert.equal(S.parseDate('02/28/2026', 'm/d/Y'), '2026-02-28')
    assert.equal(S.parseDate('28/02/2026', 'm/d/Y'), undefined)
    assert.equal(S.parseDate('2026-02-30'), undefined)
    assert.equal(S.parseDate('0999-01-01'), undefined)
    assert.equal(S.parseDate('tomorrow'), undefined)
    assert.equal(S.parseDate(''), null)
    assert.equal(S.parseDateTime('2026-02-28 09:30'), '2026-02-28 09:30:00')
    assert.equal(S.parseDateTime('2026-02-28T09:30:05'), '2026-02-28 09:30:05')
    assert.equal(S.parseDateTime('2026-02-28'), '2026-02-28 00:00:00')
    assert.equal(S.parseDateTime('28.02.2026 09:30', 'd.m.Y H:i'), '2026-02-28 09:30:00')
    assert.equal(S.parseDateTime('Feb 28, 2026 9:30 PM', 'M j, Y g:i A'), undefined)
    assert.equal(S.parseDateTime('28/02/2026 9:30 pm', 'd/m/Y g:i a'), '2026-02-28 21:30:00')
    assert.equal(S.parseDateTime('28/02/2026 12:05 am', 'd/m/Y g:i a'), '2026-02-28 00:05:00')
    assert.equal(S.parseDateTime('2026-02-28 24:00'), undefined)
})

test('phpDate formats an ISO value with a PHP pattern', () => {
    assert.equal(S.phpDate('2026-02-08', 'd/m/Y'), '08/02/2026')
    assert.equal(S.phpDate('2026-02-08 14:05:00', 'M j, Y g:i A'), 'Feb 8, 2026 2:05 PM')
    assert.equal(S.phpDate('2026-02-08 14:05:00', 'D \\a\\t H:i'), 'Sun at 14:05')
    assert.equal(S.phpDate('', 'd/m/Y'), '')
    assert.equal(S.phpDate('nope', 'd/m/Y'), 'nope')
})

test('matchOption finds by value, then by label, case and spaces aside', () => {
    const options = [{ value: '1', label: 'Tools' }, { value: 'p', label: 'Paint' }, { value: 'P', label: 'Pens' }]
    assert.equal(S.matchOption(options, '1'), '1')
    assert.equal(S.matchOption(options, ' tools '), '1')
    assert.equal(S.matchOption(options, 'PAINT'), 'p')
    assert.equal(S.matchOption(options, 'P'), 'P')
    assert.equal(S.matchOption(options, 'p'), 'p')
    assert.equal(S.matchOption(options, ''), null)
    assert.equal(S.matchOption(options, 'glue'), undefined)
})

test('matchOption prefers a label to another option\'s key', () => {
    const sizes = [{ value: '1', label: '5' }, { value: '5', label: '50' }]
    assert.equal(S.matchOption(sizes, '5'), '1')
    assert.equal(S.matchOption(sizes, '50'), '5')
    assert.equal(S.matchOption(sizes, '1'), '1')
})

test('coerce applies the column type and answers with the cell message when it cannot', () => {
    const c = (name, raw) => S.coerce(columns.find((x) => x.name === name), raw, T)
    assert.deepEqual(c('price', '1 234,5551'), { ok: true, value: 1234.56 })
    assert.deepEqual(c('price', '1.005'), { ok: true, value: 1.01 })
    assert.deepEqual(c('price', '-0.125'), { ok: true, value: -0.13 })
    assert.deepEqual(c('price', -2.675), { ok: true, value: -2.68 })
    assert.deepEqual(c('price', '1 234,555'), { ok: true, value: 1234555 })
    assert.deepEqual(c('price', '  '), { ok: true, value: null })
    assert.deepEqual(c('price', 'abc'), { ok: false, value: 'abc', error: 'NaN!' })
    assert.deepEqual(c('stock', '2.5'), { ok: false, value: '2.5', error: 'Not a whole number.' })
    assert.deepEqual(c('stock', '3'), { ok: true, value: 3 })
    assert.deepEqual(c('stock', '9007199254740991'), { ok: true, value: 9007199254740991 })
    assert.deepEqual(c('stock', '9007199254740992'), { ok: false, value: '9007199254740992', error: 'Too large a whole number.' })
    assert.deepEqual(c('stock', '-1e19'), { ok: false, value: '-1e19', error: 'Too large a whole number.' })
    assert.deepEqual(c('category_id', 'paint'), { ok: true, value: '2' })
    assert.deepEqual(c('category_id', 'glue'), { ok: false, value: 'glue', error: 'Opt!' })
    assert.deepEqual(c('is_active', 'no'), { ok: true, value: false })
    assert.deepEqual(c('is_active', 'x?'), { ok: false, value: 'x?', error: 'Bool!' })
    assert.deepEqual(c('available_on', '05/10/2026'), { ok: true, value: '2026-10-05' })
    assert.deepEqual(c('available_on', '2026-10-05'), { ok: true, value: '2026-10-05' })
    assert.deepEqual(c('available_on', '32/10/2026'), { ok: false, value: '32/10/2026', error: 'Date!' })
    assert.deepEqual(c('published_at', '05.10.2026 08:30'), { ok: true, value: '2026-10-05 08:30:00' })
    assert.deepEqual(c('published_at', 'soon'), { ok: false, value: 'soon', error: 'When!' })
    assert.deepEqual(c('sku', 12), { ok: true, value: '12' })
    assert.deepEqual(c('sku', 'a b'), { ok: true, value: 'a b' })
})

test('display renders labels, TRUE/FALSE, fixed decimals and formatted dates for the clipboard', () => {
    const d = (name, v) => S.display(columns.find((x) => x.name === name), v)
    assert.equal(d('category_id', '2'), 'Paint')
    assert.equal(d('category_id', '9'), '9')
    assert.equal(d('is_active', false), 'FALSE')
    assert.equal(d('price', 12.5), '12.50')
    assert.equal(d('price', null), '')
    assert.equal(d('available_on', '2026-10-05'), '05/10/2026')
    assert.equal(d('published_at', '2026-10-05 08:30:00'), '05.10.2026 08:30')
})

/* ------------------------------------------------------------------ buffer */

test('an edit is dirty until it goes back to the original; the version and page are remembered once', () => {
    const b = S.createBuffer()
    const applied = S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12, version: 'v1' }], { page: 2 })

    assert.deepEqual(applied, [{ id: '1', col: 'price', from: 10, to: 12, version: 'v1', page: 2 }])
    assert.deepEqual(b.changes, { 1: { price: 12 } })
    assert.deepEqual(b.originals, { 1: { price: 10 } })
    assert.deepEqual(b.versions, { 1: 'v1' })
    assert.deepEqual(b.pages, { 1: 2 })
    assert.deepEqual(S.summary(b), { cells: 1, rows: 1, pages: 1, created: 0, deleted: 0, total: 1 })

    S.applyEdits(b, [{ id: '1', col: 'price', from: 12, to: 15, version: 'v9' }], { page: 3 })
    assert.equal(b.versions['1'], 'v1')
    assert.equal(b.pages['1'], 2)
    assert.equal(b.originals['1'].price, 10)

    S.applyEdits(b, [{ id: '1', col: 'price', from: 15, to: 10 }])
    assert.deepEqual(b.changes, {})
    assert.deepEqual(b.versions, {})
    assert.equal(S.summary(b).total, 0)

    assert.deepEqual(S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 10 }, { id: '1', col: 'sku', from: '', to: null }]), [])
    assert.equal(b.undo.length, 3)
})

test('the summary counts cells, rows, the pages they sit on, new rows and deletions', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 1, to: 2 }, { id: '1', col: 'sku', from: 'a', to: 'b' }, { id: '7', col: 'price', from: 1, to: 3 }], { page: 1 })
    S.applyEdits(b, [{ id: '40', col: 'price', from: 1, to: 2 }], { page: 3 })
    S.addCreated(b, { sku: 'n' })
    S.markDeleted(b, ['9'])

    assert.deepEqual(S.summary(b), { cells: 4, rows: 3, pages: 2, created: 1, deleted: 1, total: 6 })
})

test('undo and redo walk edits, creates and deletes back and forth', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12 }, { id: '1', col: 'sku', from: 'a', to: 'b' }])
    const temp = S.addCreated(b, { sku: 'new' })
    S.applyEdits(b, [{ id: temp, col: 'price', from: null, to: 5 }])
    S.markDeleted(b, ['2'])

    assert.equal(b.undo.length, 4)
    assert.deepEqual(S.undo(b), { edits: [], created: [], removed: [], deleted: [], undeleted: ['2'] })
    assert.deepEqual(b.deleted, {})

    assert.deepEqual(S.undo(b), { edits: [{ id: temp, col: 'price', from: 5, to: null, version: null, page: 1 }], created: [], removed: [], deleted: [], undeleted: [] })
    assert.equal(b.created[temp].price, null)

    assert.deepEqual(S.undo(b), { edits: [], created: [], removed: [temp], deleted: [], undeleted: [] })
    assert.deepEqual(b.createdOrder, [])

    const r = S.undo(b)
    assert.deepEqual(r.edits.map(({ id, col, from, to }) => ({ id, col, from, to })), [{ id: '1', col: 'sku', from: 'b', to: 'a' }, { id: '1', col: 'price', from: 12, to: 10 }])
    assert.deepEqual(b.changes, {})
    assert.equal(S.undo(b), null)

    assert.deepEqual(S.redo(b).edits.map(({ id, col, from, to }) => ({ id, col, from, to })), [{ id: '1', col: 'price', from: 10, to: 12 }, { id: '1', col: 'sku', from: 'a', to: 'b' }])
    assert.deepEqual(S.redo(b).created, [{ id: temp, values: { sku: 'new' } }])
    assert.deepEqual(S.redo(b).edits.map(({ id, col, from, to }) => ({ id, col, from, to })), [{ id: temp, col: 'price', from: null, to: 5 }])
    assert.deepEqual(S.redo(b).deleted, ['2'])
    assert.equal(S.redo(b), null)
    assert.deepEqual(S.summary(b), { cells: 2, rows: 1, pages: 1, created: 1, deleted: 1, total: 4 })

    // A fresh edit forgets the redo stack.
    S.undo(b)
    S.applyEdits(b, [{ id: '3', col: 'price', from: 1, to: 2 }])
    assert.equal(b.redo.length, 0)
})

test('a redo of a row\'s first edit brings its version and page back', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12, version: 'v1' }], { page: 2 })
    S.undo(b)
    assert.deepEqual(b.versions, {})
    S.redo(b)
    assert.deepEqual(b.versions, { 1: 'v1' })
    assert.deepEqual(b.pages, { 1: 2 })
    assert.deepEqual(S.buildPayload(b).versions, { 1: 'v1' })
})

test('deleting a new row drops it; deleting a record marks it, twice is once', () => {
    const b = S.createBuffer()
    const temp = S.addCreated(b, { sku: 'x' })
    assert.deepEqual(S.markDeleted(b, [temp, '5', '5']), { deleted: ['5'], dropped: [temp] })
    assert.deepEqual(S.markDeleted(b, ['5']), { deleted: [], dropped: [] })
    assert.deepEqual(b.createdOrder, [])
    assert.deepEqual(S.unmarkDeleted(b, ['5', '6']), ['5'])
    assert.deepEqual(b.deleted, {})
})

test('the payload is what the server reads: changes with the versions seen, new rows by temp id, deletions', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12, version: 'v1' }, { id: '2', col: 'sku', from: 'a', to: 'b', version: null }])
    const temp = S.addCreated(b, { sku: 'n', stock: 0 })
    S.markDeleted(b, ['3'])

    assert.deepEqual(S.buildPayload(b), {
        changed: { 1: { price: 12 }, 2: { sku: 'b' } },
        versions: { 1: 'v1' },
        created: { [temp]: { sku: 'n', stock: 0 } },
        deleted: ['3'],
    })
})

test('a save\'s answer clears what was written and paints what was refused', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12, version: 'v1' }, { id: '2', col: 'price', from: 10, to: -1, version: 'v2' }, { id: '3', col: 'sku', from: 'a', to: 'b', version: 'v3' }])
    const temp = S.addCreated(b, { sku: 'n' })
    const temp2 = S.addCreated(b, { sku: '' })
    S.markDeleted(b, ['4', '5'])

    const out = S.applyResult(b, {
        ok: false,
        saved: { 1: row(1, { price: 12 }) },
        created: { [temp]: row(9, { sku: 'N' }) },
        deleted: ['4'],
        errors: { 2: { price: 'min' }, [temp2]: { sku: 'required' } },
        rowErrors: { 5: 'nope' },
        conflicts: { 3: { sku: 'theirs' } },
        versions: { 3: 'v3b' },
        rolledBack: false,
    })

    assert.deepEqual(out.saved, [{ id: '1', row: row(1, { price: 12 }) }])
    assert.deepEqual(out.created, [{ temp, row: row(9, { sku: 'N' }) }])
    assert.deepEqual(out.deleted, ['4'])
    assert.deepEqual(out.failed.sort(), ['2', '3', '5', temp2].sort())
    assert.deepEqual(Object.keys(b.changes).sort(), ['2', '3'])
    assert.deepEqual(b.versions, { 2: 'v2', 3: 'v3b' })
    assert.deepEqual(b.createdOrder, [temp2])
    assert.deepEqual(b.deleted, { 5: true })
    assert.deepEqual(b.errors, { 2: { price: 'min' }, [temp2]: { sku: 'required' } })
    assert.deepEqual(b.conflicts, { 3: { sku: 'theirs' } })
    assert.deepEqual(b.rowErrors, { 5: 'nope' })
    assert.equal(b.undo.length, 0)
    assert.equal(S.errorCount(b), 4)

    // Editing a refused cell clears its error; the conflict too.
    S.applyEdits(b, [{ id: '2', col: 'price', from: -1, to: 1 }, { id: '3', col: 'sku', from: 'b', to: 'c' }])
    assert.deepEqual(b.errors['2'], {})
    assert.deepEqual(b.conflicts['3'], {})
})

test('a rolled-back save keeps everything and paints the errors; a garbled answer paints nothing', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12 }, { id: '2', col: 'price', from: 10, to: -1 }])
    const out = S.applyResult(b, { ok: false, rolledBack: true, errors: { 2: { price: 'min' } }, saved: { 1: row(1) } })

    assert.deepEqual(out, { saved: [], created: [], deleted: [], failed: ['2'] })
    assert.deepEqual(Object.keys(b.changes), ['1', '2'])
    assert.equal(b.undo.length, 1)

    const c = S.createBuffer()
    S.applyEdits(c, [{ id: '1', col: 'price', from: 10, to: 12 }])
    assert.deepEqual(S.applyResult(c, { saved: 'x', errors: [1], deleted: 'no', created: null }), { saved: [], created: [], deleted: [], failed: [] })
    assert.deepEqual(Object.keys(c.changes), ['1'])
})

test('discard drops everything unsaved and says which rows to repaint', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12 }])
    const temp = S.addCreated(b, {})
    S.markDeleted(b, ['2'])
    b.errors['3'] = { sku: 'x' }

    assert.deepEqual(S.discard(b), { ids: ['1', '2', '3'], removed: [temp] })
    assert.deepEqual(S.summary(b).total, 0)
    assert.equal(b.undo.length, 0)
    assert.notEqual(S.addCreated(b, {}), temp)
})

test('overlay lays the buffer over a server row', () => {
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 12 }])
    b.errors['1'] = { sku: 'bad' }
    S.markDeleted(b, ['1'])

    assert.deepEqual(S.overlay(b, row(1)), { values: { ...row(1).values, price: 12 }, dirty: { price: true }, errors: { sku: 'bad' }, conflicts: {}, rowError: null, deleted: true })
    assert.deepEqual(S.overlay(b, row(2)).dirty, {})
})

/* ------------------------------------------------------------------ paste and fill */

test('a blank line past the last row makes no new row; inside the rows it clears the cells', () => {
    const rows = [row(1), row(2)]
    const plan = S.pastePlan({ matrix: [['5', 'Paint'], ['', ''], ['', ' '], ['7', 'Tools'], ['', '']], startRow: 1, startCol: 1, rows, columns, creatable: true, defaults: { stock: 0 }, t: T })

    // Row 2 takes the first line; the blank lines past the end are dropped, the filled one is created.
    assert.equal(plan.edits.length, 2)
    assert.equal(plan.created.length, 1)
    assert.equal(plan.created[0].values.price, 7)
    assert.equal(plan.blank, 3)
    assert.equal(plan.skipped, 0)

    // The same blank line over an existing row clears its cells.
    const over = S.pastePlan({ matrix: [['', '']], startRow: 0, startCol: 1, rows, columns, creatable: true, t: T })
    assert.deepEqual(over.edits.map((e) => [e.col, e.to]), [['price', null], ['stock', null]])
    assert.equal(over.blank, 0)

    // Text only on a computed column or past the last one is nothing a new row takes: still a blank line.
    const edge = S.pastePlan({ matrix: [['', '4', 'note'], ['', '', '']], startRow: 2, startCol: 6, rows, columns, creatable: true, t: T })
    assert.equal(edge.created.length, 0)
    assert.equal(edge.blank, 2)
    assert.equal(edge.skipped, 4)
})

test('a paste lands at the anchor, coerces per column, skips what cannot be edited and adds rows past the end', () => {
    const rows = [row(1), row(2, {}, { locked: ['price'] }), row(3, {}, { readOnly: true })]
    const plan = S.pastePlan({
        matrix: [['1 234,5', 'Paint', 'no'], ['x', '1', 'yes'], ['7', 'Tools', '1'], ['8', '2', '2'], ['9', 'Pens', '']],
        startRow: 0, startCol: 1, rows, columns, creatable: true, defaults: { stock: 0, is_active: true }, t: T,
    })

    // What could not be read keeps the pasted text (shown red) so the user sees what landed.
    assert.deepEqual(plan.edits, [
        { id: '1', col: 'price', from: 10, to: 1234.5, version: 'v1' },
        { id: '1', col: 'stock', from: 1, to: 'Paint', version: 'v1' },
        { id: '1', col: 'category_id', from: '1', to: 'no', version: 'v1' },
        { id: '2', col: 'stock', from: 1, to: 1, version: 'v2' },
        { id: '2', col: 'category_id', from: '1', to: 'yes', version: 'v2' },
    ])
    assert.deepEqual(plan.invalid.filter((i) => i.id !== null), [
        { id: '1', col: 'stock', error: 'NaN!' },
        { id: '1', col: 'category_id', error: 'Opt!' },
        { id: '2', col: 'category_id', error: 'Opt!' },
    ])
    assert.equal(plan.skipped, 4)
    assert.deepEqual(plan.created, [
        { values: { stock: 2, is_active: true, price: 8, category_id: '2' } },
        { values: { stock: 'Pens', is_active: true, price: 9, category_id: null } },
    ])
    // A new row has no id yet: the invalid cell names the row by its index into `created`.
    assert.deepEqual(plan.invalid.filter((i) => i.id === null), [{ id: null, created: 1, col: 'stock', error: 'NaN!' }])
})

test('a paste is one undo step: its edits, its new rows and their red cells go and come back together', () => {
    const rows = [row(1), row(2)]
    // Columns 1 and 2 are price and stock; the last three lines fall past the end.
    const plan = S.pastePlan({ matrix: [['5', 'Paint'], ['6', '4'], ['7', 'x'], ['abc', '2']], startRow: 1, startCol: 1, rows, columns, creatable: true, defaults: { is_active: true }, t: T })
    const b = S.createBuffer()
    b.errors['2'] = { price: 'old' }

    const out = S.applyPaste(b, plan, { page: 3 })

    assert.deepEqual(out.edits.map(({ id, col, to }) => ({ id, col, to })), [{ id: '2', col: 'price', to: 5 }, { id: '2', col: 'stock', to: 'Paint' }])
    assert.deepEqual(out.created.map((c) => c.values), [{ is_active: true, price: 6, stock: 4 }, { is_active: true, price: 7, stock: 'x' }, { is_active: true, price: 'abc', stock: 2 }])
    assert.equal(out.capped, 0)
    const [n1, n2, n3] = out.created.map((c) => c.id)
    assert.deepEqual(out.invalid, [{ id: '2', col: 'stock', error: 'NaN!' }, { id: n2, col: 'stock', error: 'NaN!' }, { id: n3, col: 'price', error: 'NaN!' }])
    assert.deepEqual(b.errors, { 2: { stock: 'NaN!' }, [n2]: { stock: 'NaN!' }, [n3]: { price: 'NaN!' } })
    assert.equal(b.pages['2'], 3)
    assert.equal(b.undo.length, 1)
    assert.equal(b.undo[0].type, 'paste')
    assert.deepEqual(S.summary(b), { cells: 2, rows: 1, pages: 1, created: 3, deleted: 0, total: 5 })

    const undone = S.undo(b)
    assert.deepEqual(undone.removed, [n3, n2, n1])
    assert.deepEqual(undone.edits.map(({ id, col, to }) => ({ id, col, to })), [{ id: '2', col: 'stock', to: 1 }, { id: '2', col: 'price', to: 10 }])
    assert.deepEqual(S.summary(b).total, 0)
    assert.deepEqual(b.errors, { 2: {} })

    const redone = S.redo(b)
    assert.deepEqual(redone.created.map((c) => c.id), [n1, n2, n3])
    assert.equal(redone.edits.length, 2)
    assert.deepEqual(b.createdOrder, [n1, n2, n3])
    assert.deepEqual(b.errors, { 2: { stock: 'NaN!' }, [n2]: { stock: 'NaN!' }, [n3]: { price: 'NaN!' } })
    assert.equal(S.summary(b).total, 5)

    // A paste that changes nothing records no step.
    const c = S.createBuffer()
    assert.equal(S.applyPaste(c, S.pastePlan({ matrix: [['10']], startRow: 0, startCol: 1, rows, columns, t: T })).edits.length, 0)
    assert.equal(c.undo.length, 0)
})

test('a paste stops creating rows at the server\'s cap on rows per save and counts the lines left out', () => {
    const rows = [row(1), row(2), row(3)]
    const b = S.createBuffer()
    S.applyEdits(b, [{ id: '1', col: 'price', from: 10, to: 11 }])
    S.markDeleted(b, ['9'])
    // 4 rows past the end; the cap of 6 holds the edited row, the deletion, the row this paste edits and three new ones.
    const plan = S.pastePlan({ matrix: [['a'], ['b'], ['c'], ['d'], ['e']], startRow: 2, startCol: 0, rows, columns, creatable: true, t: T })
    const out = S.applyPaste(b, plan, { maxRows: 6 })

    assert.equal(out.edits.length, 1)
    assert.equal(out.created.length, 3)
    assert.equal(out.capped, 1)
    assert.deepEqual(b.createdOrder.map((id) => b.created[id].sku), ['b', 'c', 'd'])
    assert.equal(S.summary(b).rows + S.summary(b).created + S.summary(b).deleted, 6)

    // Undo takes the whole capped paste away; without a cap every row is created.
    S.undo(b)
    assert.deepEqual(b.createdOrder, [])
    assert.equal(S.applyPaste(S.createBuffer(), plan, {}).created.length, 4)
    // A cap of one is spent on the edited row: no new row at all.
    assert.equal(S.applyPaste(S.createBuffer(), plan, { maxRows: 1 }).capped, 4)
})

test('editing a refused cell of a new row clears its error too', () => {
    const b = S.createBuffer()
    const temp = S.addCreated(b, { sku: 'SKU-001' })
    b.errors[temp] = { sku: 'taken', price: 'min' }

    S.applyEdits(b, [{ id: temp, col: 'sku', from: 'SKU-001', to: 'SKU-NEW' }])
    assert.deepEqual(b.errors[temp], { price: 'min' })
    assert.equal(S.errorCount(b), 1)

    // Typing the same value again is no edit and keeps the error.
    S.applyEdits(b, [{ id: temp, col: 'price', from: 'x', to: 'x' }])
    assert.deepEqual(b.errors[temp], { price: 'min' })
})

test('a paste past the end without creatable, into a read-only sheet, or past the last column is skipped', () => {
    const rows = [row(1)]
    const plan = S.pastePlan({ matrix: [['a', 'b'], ['c', 'd']], startRow: 0, startCol: 7, rows, columns, creatable: false, t: T })
    assert.deepEqual(plan.edits, [])
    assert.equal(plan.skipped, 4)
    assert.deepEqual(plan.created, [])

    const ro = S.pastePlan({ matrix: [['x']], startRow: 0, startCol: 0, rows, columns, creatable: true, readOnly: true, t: T })
    assert.deepEqual(ro.edits, [])
    assert.equal(ro.skipped, 1)

    const past = S.pastePlan({ matrix: [['x']], startRow: 3, startCol: 0, rows, columns, creatable: false, t: T })
    assert.equal(past.skipped, 1)
})

test('a single pasted cell fills the whole selection, as in Excel', () => {
    const rows = [row(1), row(2), row(3)]
    const plan = S.pastePlan({ matrix: [['5']], startRow: 0, startCol: 1, rows, columns, selection: { rows: 3, cols: 2 }, t: T })

    assert.deepEqual(plan.edits.map((e) => [e.id, e.col, e.to]), [['1', 'price', 5], ['1', 'stock', 5], ['2', 'price', 5], ['2', 'stock', 5], ['3', 'price', 5], ['3', 'stock', 5]])
})

test('fill-down copies the first row of the selection into the rows below, where the cell may be edited', () => {
    const rows = [row(1, { price: 7, sku: 'top' }), row(2, {}, { locked: ['price'] }), row(3), row(4)]
    const edits = S.fillDownPlan({ rows, columns, top: 0, bottom: 2, left: 0, right: 1 })

    assert.deepEqual(edits, [
        { id: '2', col: 'sku', from: 'S-2', to: 'top', version: 'v2' },
        { id: '3', col: 'sku', from: 'S-3', to: 'top', version: 'v3' },
        { id: '3', col: 'price', from: 10, to: 7, version: 'v3' },
    ])
    assert.deepEqual(S.fillDownPlan({ rows, columns, top: 1, bottom: 1, left: 0, right: 0 }), [])
    assert.deepEqual(S.fillDownPlan({ rows, columns, top: 0, bottom: 1, left: 7, right: 7 }), [])
})

test('a clear (Delete, Backspace, cut) empties the editable cells of the selection and leaves the others alone', () => {
    const rows = [row(1, { price: null }), row(2, {}, { locked: ['price'] }), row(3, {}, { readOnly: true }), row(4, {}, { deleted: true }), row(5)]
    // Columns 1..3: price, stock, category_id; then margin (computed) at 7.
    const edits = S.clearPlan({ rows, columns, top: 0, bottom: 4, left: 1, right: 2 })

    assert.deepEqual(edits, [
        { id: '1', col: 'price', from: null, to: null, version: 'v1' },
        { id: '1', col: 'stock', from: 1, to: null, version: 'v1' },
        { id: '2', col: 'stock', from: 1, to: null, version: 'v2' },
        { id: '5', col: 'price', from: 10, to: null, version: 'v5' },
        { id: '5', col: 'stock', from: 1, to: null, version: 'v5' },
    ])
    assert.deepEqual(S.clearPlan({ rows, columns, top: 0, bottom: 0, left: 7, right: 7 }), [])
    assert.deepEqual(S.clearPlan({ rows, columns, top: 0, bottom: 0, left: 1, right: 1, readOnly: true }), [])
    assert.deepEqual(S.clearPlan({ rows, columns, top: 9, bottom: 9, left: 1, right: 1 }), [])

    // An already empty cell is not a change once applied.
    const b = S.createBuffer()
    assert.equal(S.applyEdits(b, edits).length, 4)
    assert.deepEqual(b.changes, { 1: { stock: null }, 2: { stock: null }, 5: { price: null, stock: null } })
})

test('editable() knows every reason a cell is locked', () => {
    const price = columns[1]
    assert.equal(S.editable(price, row(1)), true)
    assert.equal(S.editable(price, row(1), true), false)
    assert.equal(S.editable(price, row(1, {}, { readOnly: true })), false)
    assert.equal(S.editable(price, row(1, {}, { deleted: true })), false)
    assert.equal(S.editable(price, row(1, {}, { locked: ['price'] })), false)
    assert.equal(S.editable(columns[7], row(1)), false)
    assert.equal(S.editable({ ...price, readOnly: true }, row(1)), false)
    assert.equal(S.editable(price, null), false)
})

/* ------------------------------------------------------------------ strings and keys */

test('choice picks Laravel\'s plural forms', () => {
    const s = '{0} No changes|{1} :count change|[2,*] :count changes'
    assert.equal(S.choice(s, 0), 'No changes')
    assert.equal(S.choice(s, 1), '1 change')
    assert.equal(S.choice(s, 5), '5 changes')
    assert.equal(S.choice('{1} :count row saved.|[2,*] :count rows saved.', 1), '1 row saved.')
    assert.equal(S.choice('one|many', 1), 'one')
    assert.equal(S.choice('one|many', 3), 'many')
    assert.equal(S.choice(':saved saved, :failed with errors.', 2, { saved: 2, failed: 1 }), '2 saved, 1 with errors.')
    assert.equal(S.choice(undefined, 2), '')
})

test('keybindings read "mod+s" style specs and match events', () => {
    const save = S.parseKeybinding('mod+s')
    assert.deepEqual(save, { key: 's', mod: true, ctrl: false, meta: false, shift: false, alt: false })
    assert.equal(S.matchesKey({ key: 'S', ctrlKey: true }, save), true)
    assert.equal(S.matchesKey({ key: 's', metaKey: true }, save), true)
    assert.equal(S.matchesKey({ key: 's' }, save), false)
    assert.equal(S.matchesKey({ key: 's', ctrlKey: true, shiftKey: true }, save), false)
    assert.equal(S.matchesKey({ key: 'Enter', ctrlKey: true }, S.parseKeybinding('mod+enter')), true)
    assert.equal(S.matchesKey({ key: 'z', ctrlKey: true, shiftKey: true }, S.parseKeybinding('mod+shift+z')), true)
    assert.equal(S.matchesKey({ key: 'd', ctrlKey: true }, S.parseKeybinding('ctrl+d')), true)
    assert.equal(S.matchesKey({ key: 'd', metaKey: true }, S.parseKeybinding('ctrl+d')), false)
    assert.equal(S.matchesKey({ key: 'F2' }, S.parseKeybinding('f2')), true)
    assert.deepEqual(Object.keys(S.DEFAULT_KEYS), ['save', 'fill_down', 'undo', 'redo', 'add_row', 'cut'])
    assert.equal(S.matchesKey({ key: 'x', ctrlKey: true }, S.parseKeybinding(S.DEFAULT_KEYS.cut)), true)
})

/* ------------------------------------------------------------------ formulas */

test('formulas compute what the server computes, case by case (tests/js/formulas.json, written by formulas.php)', async () => {
    const { readFile } = await import('node:fs/promises')
    const fixture = JSON.parse(await readFile(new URL('./formulas.json', import.meta.url), 'utf8'))

    assert.ok(fixture.cases.length > 50)
    for (const c of fixture.cases) {
        assert.deepEqual(S.evaluateFormula(c.tree, (name) => fixture.row[name] ?? null), c.value, c.source)
    }
})

test('computeRow fills every formula column from the row, a formula read by another first, rounded to its decimals', () => {
    const cols = [
        { name: 'price', type: 'number' },
        { name: 'stock', type: 'number' },
        { name: 'share', type: 'computed', formula: ['op', '/', ['ref', 'value'], ['num', 3]], decimals: 2 },
        { name: 'value', type: 'computed', formula: ['op', '*', ['ref', 'price'], ['ref', 'stock']], decimals: null },
        { name: 'margin', type: 'computed', formula: null },
    ]
    const values = { price: 12.5, stock: 4, share: 99, value: 99, margin: 7 }

    assert.deepEqual(S.computeRow(cols, values), { price: 12.5, stock: 4, share: 16.67, value: 50, margin: 7 })
    assert.deepEqual(values.value, 99, 'the row passed in is left alone')
    assert.deepEqual(S.computeRow(cols, { price: 'abc', stock: 4 }), { price: 'abc', stock: 4, share: null, value: null })
    // a cell that failed coercion is empty to a formula: `if(price > 0, …)` must not see 'abc' as text greater than 0
    assert.deepEqual(S.computeRow(cols, { price: 'abc', stock: 4 }, { price: 'Not a number.' }), { price: 'abc', stock: 4, share: null, value: null })
    assert.equal(S.computeRow([{ name: 'price', type: 'number' }], values), values, 'no formula, the same object')
})

test('a computed number is copied with its decimals', () => {
    assert.equal(S.display({ type: 'computed', decimals: 2 }, 50), '50.00')
    assert.equal(S.display({ type: 'computed', decimals: null }, 'low'), 'low')
})

test('shortcutLabel reads a binding the way a tooltip shows it, per platform', () => {
    assert.equal(S.shortcutLabel('mod+s'), 'Ctrl+S')
    assert.equal(S.shortcutLabel('mod+s', true), '⌘S')
    assert.equal(S.shortcutLabel('mod+enter'), 'Ctrl+Enter')
    assert.equal(S.shortcutLabel('mod+enter', true), '⌘↩')
    assert.equal(S.shortcutLabel('ctrl+shift+d'), 'Ctrl+Shift+D')
    assert.equal(S.shortcutLabel('ctrl+shift+d', true), '⌃⇧D')
    assert.equal(S.shortcutLabel('mod+shift+a', true), '⇧⌘A')
    assert.equal(S.shortcutLabel('mod+shift+a'), 'Ctrl+Shift+A')
    assert.equal(S.shortcutLabel('alt+f2'), 'Alt+F2')
    assert.equal(S.shortcutLabel('f2', true), 'F2')
})

test('filter state: the empty shapes, what counts as active, a picker\'s day and a select\'s pick', () => {
    const select = { name: 'category_id', type: 'select', multiple: false }
    const multiple = { name: 'tags', type: 'select', multiple: true }
    const boolean = { name: 'is_active', type: 'boolean', multiple: false }
    const toggle = { name: 'mine', type: 'toggle', multiple: false }
    const range = { name: 'available_on', type: 'dateRange', multiple: false }

    assert.equal(S.emptyFilterState(select), '')
    assert.deepEqual(S.emptyFilterState(multiple), [])
    assert.equal(S.emptyFilterState(boolean), '')
    assert.equal(S.emptyFilterState(toggle), false)
    assert.deepEqual(S.emptyFilterState(range), { from: null, until: null })

    assert.equal(S.filterIsActive(select, ''), false)
    assert.equal(S.filterIsActive(select, '3'), true)
    assert.equal(S.filterIsActive(boolean, '0'), true) // "No" narrows
    assert.equal(S.filterIsActive(multiple, []), false)
    assert.equal(S.filterIsActive(multiple, ['1']), true)
    assert.equal(S.filterIsActive(toggle, false), false)
    assert.equal(S.filterIsActive(toggle, true), true)
    assert.equal(S.filterIsActive(range, { from: null, until: null }), false)
    assert.equal(S.filterIsActive(range, { from: null, until: '2026-10-05' }), true)

    assert.equal(S.filterDay('2026-10-05 00:00:00'), '2026-10-05')
    assert.equal(S.filterDay('2026-10-05'), '2026-10-05')
    assert.equal(S.filterDay(null), null)
    assert.equal(S.filterDay(''), null)
    assert.equal(S.filterDay('10/05/2026'), null)

    assert.equal(S.filterSelection(select, 3), '3')
    assert.equal(S.filterSelection(select, null), '')
    assert.equal(S.filterSelection(select, ['2']), '2')
    assert.deepEqual(S.filterSelection(multiple, [1, '2']), ['1', '2'])
    assert.deepEqual(S.filterSelection(multiple, null), [])
    assert.deepEqual(S.filterSelection(multiple, '4'), ['4'])

    assert.equal(S.activeFilterCount([select, multiple, toggle, range], { category_id: '1', tags: [], mine: true, available_on: { from: '2026-01-01', until: null } }), 3)
})
