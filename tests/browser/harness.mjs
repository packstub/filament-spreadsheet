/**
 * A stand-alone page for the sheet: the real Blade view turned into static HTML,
 * the built bundle, Alpine from a CDN, a fake $wire with an in-memory "server"
 * (250 products, paging, sorting, search, a save that validates and can fake a
 * conflict). Used by run.mjs (headless Chromium) and openable by hand:
 *
 *   node tests/browser/harness.mjs            writes tests/browser/.harness.html and serves it on :4177
 *
 * Not part of CI: it needs a browser. The Node suite in tests/js covers the pure parts.
 */

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const i18n = (() => {
    // The English strings, read from the PHP file without PHP: 'key' => 'value',
    const php = readFileSync(join(root, 'resources/lang/en/spreadsheet.php'), 'utf8')
    const out = {}
    for (const m of php.matchAll(/'([a-z_]+)' => '((?:[^'\\]|\\.)*)'/g)) out[m[1]] = m[2].replace(/\\'/g, "'")

    return out
})()

export const config = {
    key: 'harness',
    columns: [
        { name: 'sku', label: 'SKU', type: 'text', width: null, frozen: true, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, maxLength: 32 },
        { name: 'name', label: 'Name', type: 'text', width: 220, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, maxLength: 120 },
        { name: 'category_id', label: 'Category', type: 'select', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, options: [{ value: '1', label: 'Tools' }, { value: '2', label: 'Paint' }, { value: '3', label: 'Garden' }] },
        { name: 'price', label: 'Price', type: 'number', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, integer: false, decimals: 2, min: 0, max: null, step: null },
        { name: 'cost', label: 'Cost', type: 'number', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, integer: false, decimals: 2, min: 0, max: null, step: null },
        { name: 'stock', label: 'Stock', type: 'number', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: 0, integer: true, decimals: 0, min: 0, max: null, step: null },
        { name: 'is_active', label: 'Active', type: 'boolean', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: true },
        { name: 'available_on', label: 'Available', type: 'date', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, format: 'd/m/Y' },
        { name: 'published_at', label: 'Published', type: 'datetime', width: null, frozen: false, editable: true, readOnly: false, sortable: true, placeholder: null, default: null, format: 'Y-m-d H:i' },
        { name: 'margin', label: 'Margin', type: 'computed', width: null, frozen: false, editable: false, readOnly: true, sortable: false, placeholder: null, default: null },
    ],
    filters: [
        { name: 'category_id', label: 'Category', type: 'select', options: [{ value: '1', label: 'Tools' }, { value: '2', label: 'Paint' }, { value: '3', label: 'Garden' }] },
        { name: 'is_active', label: 'Active', type: 'select', options: [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }] },
    ],
    perPage: 100, pageSizes: [25, 50, 100, 200, 500, 1000], sort: { column: 'sku', direction: 'asc' },
    searchable: true, creatable: true, deletable: true, readOnly: false, saveMode: 'all_or_nothing', versioned: true,
    confirmLeave: true, frozenFirstColumn: true, rowHeight: 32, keybindings: {}, locale: 'en', height: '32rem', state: null, i18n,
}

/** The in-memory server: what spreadsheetRows / spreadsheetSave would answer. Runs inside the page. */
export const serverSource = `
window.__server = (() => {
    const products = []
    for (let i = 1; i <= 250; i++) {
        products.push({ id: String(i), version: 'v' + i + '.0', sku: 'SKU-' + String(i).padStart(3, '0'), name: 'Product ' + i, category_id: String((i % 3) + 1), price: Math.round(i * 137 % 1000) / 10, cost: Math.round(i * 71 % 500) / 10, stock: i % 17, is_active: i % 4 !== 0, available_on: '2026-10-' + String((i % 28) + 1).padStart(2, '0'), published_at: i % 5 === 0 ? '2026-09-01 08:30:00' : null, locked: i % 25 === 0, readOnly: i % 40 === 0 })
    }
    const cols = ['sku', 'name', 'category_id', 'price', 'cost', 'stock', 'is_active', 'available_on', 'published_at']
    const present = (p) => ({ id: p.id, version: p.version, values: { sku: p.sku, name: p.name, category_id: p.category_id, price: p.price, cost: p.cost, stock: p.stock, is_active: p.is_active, available_on: p.available_on, published_at: p.published_at, margin: Math.round((p.price - p.cost) * 100) / 100 }, locked: p.locked ? ['cost'] : [], readOnly: !! p.readOnly, deletable: ! p.readOnly })
    const calls = { rows: [], save: [] }
    let seq = 250
    const state = { conflictOn: null, mode: 'all_or_nothing' }

    const validate = (data, existing) => {
        const errors = {}
        if ('sku' in data && ! data.sku) errors.sku = 'The SKU field is required.'
        if ('name' in data && ! data.name) errors.name = 'The Name field is required.'
        if ('price' in data && data.price !== null && (typeof data.price !== 'number' || data.price < 0)) errors.price = typeof data.price !== 'number' ? 'Not a number.' : 'The Price field must be at least 0.'
        if ('stock' in data && data.stock !== null && ! Number.isInteger(data.stock)) errors.stock = 'Not a whole number.'
        if ('category_id' in data && data.category_id !== null && ! ['1', '2', '3'].includes(String(data.category_id))) errors.category_id = 'Not one of the options.'
        if ('sku' in data && data.sku && products.some((p) => p.sku === data.sku && p !== existing)) errors.sku = 'The SKU has already been taken.'

        return errors
    }

    return {
        calls, products, state,
        rows(req) {
            calls.rows.push(req)
            let list = [...products]
            const q = (req.search || '').toLowerCase()
            if (q) list = list.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
            const f = req.filters || {}
            if (f.category_id) list = list.filter((p) => p.category_id === String(f.category_id))
            if (f.is_active === '1' || f.is_active === '0') list = list.filter((p) => p.is_active === (f.is_active === '1'))
            const col = cols.includes(req.sort?.column) ? req.sort.column : 'sku'
            const dir = req.sort?.direction === 'desc' ? -1 : 1
            list.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * dir || (Number(a.id) - Number(b.id)))
            const perPage = Math.max(1, Math.min(1000, Number(req.perPage) || 100))
            const page = Math.max(1, Number(req.page) || 1)
            const rows = list.slice((page - 1) * perPage, page * perPage).map(present)

            return { ok: true, rows, total: list.length, page, perPage, lastPage: Math.max(1, Math.ceil(list.length / perPage)), sort: { column: col, direction: dir === 1 ? 'asc' : 'desc' } }
        },
        save(payload) {
            calls.save.push(JSON.parse(JSON.stringify(payload)))
            const result = { ok: true, saved: {}, created: {}, deleted: [], errors: {}, rowErrors: {}, conflicts: {}, versions: {}, message: null, rolledBack: false }
            const writes = []

            for (const [id, values] of Object.entries(payload.changed || {})) {
                const p = products.find((x) => x.id === id)
                if (! p) { result.rowErrors[id] = 'This row is no longer in the sheet.'; continue }
                if (p.readOnly) { result.rowErrors[id] = 'You cannot change this row.'; continue }
                if (state.conflictOn === id || (payload.versions?.[id] && payload.versions[id] !== p.version)) {
                    result.conflicts[id] = {}
                    for (const c of Object.keys(values)) result.conflicts[id][c] = p[c]
                    result.versions[id] = p.version
                    continue
                }
                const errors = validate(values, p)
                for (const c of Object.keys(values)) if (! cols.includes(c) || (c === 'cost' && p.locked)) errors[c] = 'This cell cannot be edited.'
                if (Object.keys(errors).length) { result.errors[id] = errors; continue }
                writes.push(() => { Object.assign(p, values); p.version = p.version + '+'; result.saved[id] = present(p) })
            }

            for (const [temp, values] of Object.entries(payload.created || {})) {
                const data = { stock: 0, is_active: true, ...values }
                const errors = validate({ sku: data.sku ?? null, name: data.name ?? null, ...data }, null)
                if (Object.keys(errors).length) { result.errors[temp] = errors; continue }
                writes.push(() => { const p = { id: String(++seq), version: 'v' + seq + '.0', category_id: null, price: 0, cost: 0, available_on: null, published_at: null, locked: false, readOnly: false, ...data }; products.push(p); result.created[temp] = present(p) })
            }

            for (const id of payload.deleted || []) {
                const i = products.findIndex((x) => x.id === String(id))
                if (i < 0) { result.rowErrors[id] = 'This row is no longer in the sheet.'; continue }
                if (products[i].readOnly) { result.rowErrors[id] = 'You cannot delete this row.'; continue }
                writes.push(() => { products.splice(products.findIndex((x) => x.id === String(id)), 1); result.deleted.push(String(id)) })
            }

            const failed = Object.keys(result.errors).length + Object.keys(result.rowErrors).length + Object.keys(result.conflicts).length
            if (failed && state.mode === 'all_or_nothing') {
                result.rolledBack = true
                result.message = 'Nothing was saved: fix the marked cells and save again.'
                result.ok = false

                return result
            }
            writes.forEach((w) => w())
            result.ok = failed === 0

            return result
        },
    }
})()

window.__wire = {
    spreadsheetRows: async (req) => JSON.parse(JSON.stringify(window.__server.rows(req))),
    spreadsheetSave: async (payload) => JSON.parse(JSON.stringify(window.__server.save(payload))),
    spreadsheetDelete: async (ids) => JSON.parse(JSON.stringify(window.__server.save({ deleted: ids }))),
}
`

const tokens = `
:root{--gray-50:#f9fafb;--gray-100:#f3f4f6;--gray-200:#e5e7eb;--gray-300:#d1d5db;--gray-400:#9ca3af;--gray-500:#6b7280;--gray-600:#4b5563;--gray-700:#374151;--gray-800:#1f2937;--gray-900:#111827;--gray-950:#030712;
--primary-300:#fcd34d;--primary-400:#fbbf24;--primary-500:#f59e0b;--primary-600:#d97706;--danger-300:#fca5a5;--danger-400:#f87171;--danger-500:#ef4444;--danger-600:#dc2626;--danger-700:#b91c1c;
--warning-300:#fcd34d;--warning-400:#fbbf24;--warning-500:#f59e0b;--warning-700:#b45309;--success-500:#22c55e;--success-600:#16a34a;--info-500:#3b82f6;--topbar-height:4rem}
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:1rem;background:#fff;color:#111}
.dark body{background:#0b1220}
`

/** The Blade view as static HTML: the PHP block, the Blade comment and the x-load attributes stripped. */
export function viewHtml() {
    let html = readFileSync(join(root, 'resources/views/spreadsheet.blade.php'), 'utf8')
    html = html.replace(/@php[\s\S]*?@endphp\s*/m, '')
    html = html.replace(/\{\{--[\s\S]*?--\}\}\s*/gm, '')
    html = html.replace(/\s*x-load-src="[^"]*"/, '').replace(/\s*x-load-css="[^"]*"/, '').replace(/\s*x-load\b/, '')
    html = html.replace('x-data="packstubSpreadsheet(@js($config))"', 'x-data="packstubSpreadsheet(window.__config)"')
    if (/@js\(|\{\{|@foreach/.test(html)) throw new Error('The view has Blade the harness does not translate:\n' + html.match(/.*(@js\(|\{\{|@foreach).*/)[0])

    return html
}

export function pageHtml({ dark = false, rtl = false, readOnly = false } = {}) {
    // The server sends creatable/deletable false on a read-only sheet (Spreadsheet::canCreate()/isDeletable()).
    const cfg = { ...config, readOnly, creatable: config.creatable && ! readOnly, deletable: config.deletable && ! readOnly }
    return `<!doctype html>
<html lang="en"${rtl ? ' dir="rtl"' : ''} class="${dark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<title>filament-spreadsheet harness</title>
<style>${tokens}</style>
<link rel="stylesheet" href="/resources/dist/spreadsheet.css">
</head>
<body>
<h1 style="font-size:1.25rem;margin:0 0 .75rem">Products</h1>
<script>window.__config = ${JSON.stringify(cfg)}; window.__ready = false;</script>
<script>${serverSource}</script>
${viewHtml()}
<script type="module">
import packstubSpreadsheet from '/resources/dist/spreadsheet.js'
import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.8/dist/module.esm.js'
Alpine.magic('wire', () => window.__wire)
Alpine.data('packstubSpreadsheet', packstubSpreadsheet)
window.Alpine = Alpine
window.sheet = () => Alpine.$data(document.querySelector('.ps-sheet'))
Alpine.start()
window.__ready = true
</script>
</body>
</html>`
}

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.map': 'application/json' }

/** Serve the plugin directory (for the dist files) and the harness page at /. */
export function serve(port = 0) {
    const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.pathname === '/' || url.pathname === '/index.html') {
            res.writeHead(200, { 'content-type': 'text/html' })
            res.end(pageHtml({ dark: url.searchParams.has('dark'), rtl: url.searchParams.has('rtl'), readOnly: url.searchParams.has('readonly') }))

            return
        }
        const file = join(root, url.pathname)
        if (! file.startsWith(root) || ! existsSync(file)) { res.writeHead(404); res.end('not found'); return }
        res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
        res.end(readFileSync(file))
    })

    return new Promise((resolveServer) => server.listen(port, '127.0.0.1', () => resolveServer({ server, port: server.address().port })))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    writeFileSync(join(root, 'tests/browser/.harness.html'), pageHtml())
    const { port } = await serve(4177)
    console.log(`harness at http://127.0.0.1:${port}/  (?dark, ?rtl)`)
}
