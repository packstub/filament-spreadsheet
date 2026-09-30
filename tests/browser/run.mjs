/**
 * Drives the harness in headless Chromium through Playwright (borrowed from
 * demos/packstub-demo/node_modules, or a PLAYWRIGHT_CORE path) and checks the
 * interactions the Node suite cannot: typing into a cell, Enter moving down,
 * paste, fill-down, undo, dirty cells across pages, save (ok, errors,
 * conflicts), add and delete rows, read-only mode. Screenshots land in
 * SCREENSHOT_DIR (default: tests/browser/screenshots, ignored by git).
 *
 *   node tests/browser/run.mjs
 */

import { createRequire } from 'node:module'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve, root } from './harness.mjs'

const require = createRequire(import.meta.url)
// A playwright-core whose Chromium build is in ~/Library/Caches/ms-playwright: PLAYWRIGHT_CORE, or the first sibling project that has one.
const candidates = [process.env.PLAYWRIGHT_CORE, resolve(root, '../../wordpress/xpin/node_modules/playwright-core'), resolve(root, '../../demos/packstub-demo/node_modules/playwright-core')].filter(Boolean)
const corePath = candidates.find((c) => existsSync(c))
if (! corePath) { console.error('No playwright-core found; set PLAYWRIGHT_CORE.'); process.exit(2) }
const { chromium } = require(corePath)
const shots = process.env.SCREENSHOT_DIR ?? join(root, 'tests/browser/screenshots')
mkdirSync(shots, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && ! ok ? ` — ${detail}` : ''}`) }

const { server, port } = await serve()
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('dialog', (d) => d.accept())

const state = () => page.evaluate(() => { const s = window.sheet(); return { dirty: s.dirty, page: s.page, lastPage: s.lastPage, total: s.total, rows: s.rows.length, canUndo: s.canUndo, canRedo: s.canRedo, errorCount: s.errorCount, selected: s.selected, active: s.grid.activeCell(), editing: s.grid.isEditing() } })
const cell = (rowIndex, field) => page.locator(`.tabulator-tableholder .tabulator-row`).nth(rowIndex).locator(`.tabulator-cell[tabulator-field="${field}"]`)
const cellClasses = async (rowIndex, field) => (await cell(rowIndex, field).getAttribute('class')) ?? ''
const server_ = (fn) => page.evaluate(fn)

try {
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForSelector('.tabulator-tableholder .tabulator-row')
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100)

    let s = await state()
    check('first page renders 100 of 250 rows on 3 pages', s.rows === 100 && s.total === 250 && s.lastPage === 3)
    check('toolbar shows the row count', (await page.locator('.ps-sheet-count').innerText()) === '250 rows')
    check('row numbers count from the page offset', (await page.locator('.tabulator-tableholder .tabulator-row').first().locator('.ps-sheet-rownum').innerText()) === '1')
    check('the frozen SKU column is pinned', (await cell(0, 'sku').getAttribute('class')).includes('tabulator-frozen'))

    // typing on a selected cell edits it; Enter commits and moves down
    await cell(0, 'price').click()
    await page.keyboard.type('42')
    s = await state()
    check('typing on a selected cell opens the editor with the typed text', s.editing && (await page.locator('.tabulator-editing input').inputValue()) === '42')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('Enter commits the edit into the buffer', s.dirty.total === 1 && s.dirty.cells === 1, JSON.stringify(s.dirty))
    check('the cell is painted dirty and shows two decimals', (await cellClasses(0, 'price')).includes('ps-sheet-cell-dirty') && (await cell(0, 'price').innerText()) === '42.00')
    check('Enter moved the active cell down', s.active?.id === (await page.evaluate(() => window.sheet().rows[1].id)) && s.active?.col === 'price', JSON.stringify(s.active))

    // Escape cancels
    await page.keyboard.press('F2')
    await page.keyboard.type('999')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(30)
    s = await state()
    check('F2 edits and Escape cancels without a change', ! s.editing && s.dirty.total === 1)

    // Tab moves right after an edit
    await cell(1, 'name').click()
    await page.keyboard.type('Renamed')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(50)
    s = await state()
    check('Tab commits and moves right', s.dirty.total === 2 && s.active?.col === 'category_id', JSON.stringify(s.active))

    // a select cell reads labels
    await cell(2, 'category_id').dblclick()
    await page.waitForSelector('.tabulator-edit-list')
    await page.locator('.tabulator-edit-list .tabulator-edit-list-item', { hasText: 'Garden' }).click()
    await page.waitForTimeout(50)
    check('a select cell picks an option by label and shows it', (await cell(2, 'category_id').innerText()) === 'Garden' && (await page.evaluate(() => window.sheet().buffer.changes[window.sheet().rows[2].id]?.category_id)) === '3')

    // a boolean cell toggles on double-click and on Space
    const boolBefore = await page.evaluate(() => window.sheet().rows[3].values.is_active)
    await cell(3, 'is_active').dblclick()
    await page.waitForTimeout(80)
    const boolNow = await page.evaluate(() => window.sheet().grid.value(window.sheet().rows[3].id, 'is_active'))
    await page.keyboard.press(' ')
    await page.waitForTimeout(50)
    const boolAgain = await page.evaluate(() => window.sheet().grid.value(window.sheet().rows[3].id, 'is_active'))
    s = await state()
    check('a boolean cell flips on double-click and on Space, no editor left open', boolNow === ! boolBefore && boolAgain === boolBefore && ! s.editing && s.dirty.total === 3, `before ${boolBefore} now ${boolNow} again ${boolAgain} editing ${s.editing}`)

    // paste a 3x3 block at row 5, column name
    await cell(4, 'name').click()
    await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData('text/plain', 'Alpha\tPaint\t1 234,5\nBeta\tTools\tabc\nGamma\tnope\t7\n')
        document.querySelector('.ps-sheet .tabulator-tableholder').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(80)
    s = await state()
    const pasted = await page.evaluate(() => { const sh = window.sheet(); return [4, 5, 6].map((i) => { const id = sh.rows[i].id; return sh.buffer.changes[id] }) })
    check('a pasted block lands in the buffer with per-column coercion', pasted[0]?.name === 'Alpha' && pasted[0]?.category_id === '2' && pasted[0]?.price === 1234.5 && pasted[1]?.price === 'abc' && pasted[2]?.price === 7, JSON.stringify(pasted))
    check('unreadable pasted cells are painted red at once', (await cellClasses(5, 'price')).includes('ps-sheet-cell-error') && (await cellClasses(6, 'category_id')).includes('ps-sheet-cell-error') && s.errorCount === 2, `errors ${s.errorCount}`)
    check('the dirty count includes the pasted cells (a pasted value equal to the current one is not a change)', s.dirty.cells === 11, JSON.stringify(s.dirty))
    await page.screenshot({ path: join(shots, 'pasted.png') })

    // fill-down: rows 8..10, columns stock
    await cell(7, 'stock').click()
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    const before = await state()
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(50)
    s = await state()
    const filled = await page.evaluate(() => { const sh = window.sheet(); return [7, 8, 9].map((i) => sh.grid.value(sh.rows[i].id, 'stock')) })
    check('Ctrl+D fills the first row of the selection down', filled[0] === filled[1] && filled[1] === filled[2] && s.dirty.cells >= before.dirty.cells, JSON.stringify(filled))

    // undo / redo
    const cellsBeforeUndo = s.dirty.cells
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)
    s = await state()
    check('Ctrl+Z undoes the fill-down', s.dirty.cells < cellsBeforeUndo && s.canRedo, JSON.stringify(s.dirty))
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(50)
    s = await state()
    check('Ctrl+Y redoes it', s.dirty.cells === cellsBeforeUndo)
    check('the toolbar undo/redo buttons follow the stacks', (await page.locator('.ps-sheet-seg-btn[title^="Undo"]').isEnabled()) && ! (await page.locator('.ps-sheet-seg-btn[title^="Redo"]').isEnabled()))

    // paging keeps the buffer
    const dirtyBefore = s.dirty.total
    await page.locator('.ps-sheet-pager button[aria-label="Next page"]').click()
    await page.waitForFunction(() => window.sheet().page === 2)
    await page.waitForTimeout(150)
    s = await state()
    check('the next page loads and the unsaved cells stay', s.page === 2 && s.dirty.total === dirtyBefore && (await page.locator('.ps-sheet-count').innerText()) === '250 rows')
    check('row numbers continue on page 2', (await page.locator('.tabulator-tableholder .tabulator-row').first().locator('.ps-sheet-rownum').innerText()) === '101')
    await cell(0, 'stock').click()
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('an edit on page 2 counts on its own page', s.dirty.pages === 2 && (await page.locator('.ps-sheet-pill-dirty').innerText()).includes('2 pages'), await page.locator('.ps-sheet-pill-dirty').innerText())
    await page.locator('.ps-sheet-pager button[aria-label="Previous page"]').click()
    await page.waitForFunction(() => window.sheet().page === 1)
    await page.waitForTimeout(150)
    check('back on page 1 the cells are still painted dirty', (await cellClasses(0, 'price')).includes('ps-sheet-cell-dirty') && (await cell(0, 'price').innerText()) === '42.00')

    // search and sort are server-side and keep the buffer
    await page.locator('.ps-sheet-search input').fill('SKU-00')
    await page.waitForFunction(() => window.sheet().total === 9)
    s = await state()
    check('search asks the server and keeps the buffer', s.total === 9 && s.dirty.total === dirtyBefore + 1)
    await page.locator('.ps-sheet-search input').fill('')
    await page.waitForFunction(() => window.sheet().total === 250)
    await page.locator('.tabulator-header .tabulator-col[tabulator-field="price"]').click()
    await page.waitForFunction(() => window.sheet().sort.column === 'price')
    await page.waitForTimeout(80)
    const prices = await page.evaluate(() => window.sheet().rows.slice(0, 3).map((r) => r.values.price))
    check('a header click sorts on the server', prices[0] <= prices[1] && prices[1] <= prices[2] && prices[0] < 10 && (await page.locator('.tabulator-header .tabulator-col[tabulator-field="price"]').innerText()).includes('▲'), JSON.stringify(prices))
    await page.locator('.tabulator-header .tabulator-col[tabulator-field="sku"]').click()
    await page.waitForFunction(() => window.sheet().sort.column === 'sku')
    await page.waitForTimeout(80)

    // save: all-or-nothing refuses because of the bad pasted cells
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 1)
    await page.waitForTimeout(80)
    s = await state()
    const call = await page.evaluate(() => window.__server.calls.save[0])
    check('Ctrl+S sends one payload with changed cells, their versions, and nothing else', Object.keys(call.changed).length === 9 && Object.keys(call.versions).length === 9 && Object.keys(call.created).length === 0 && call.deleted.length === 0, JSON.stringify({ changed: Object.keys(call.changed).length, versions: Object.keys(call.versions).length, created: Object.keys(call.created).length, deleted: call.deleted.length }))
    check('a rolled-back save keeps every change and paints the server errors', s.dirty.total === dirtyBefore + 1 && (await cellClasses(5, 'price')).includes('ps-sheet-cell-error') && (await cell(5, 'price').getAttribute('title')) === 'Not a number.')
    check('the notification says nothing was saved', (await page.locator('.ps-sheet-hint').innerText()).includes('Nothing was saved'))
    await page.screenshot({ path: join(shots, 'errors.png') })

    // fix the bad cells and save per-row from now on
    await server_(() => { window.__server.state.mode = 'per_row' })
    await cell(5, 'price').click()
    await page.keyboard.type('5')
    await page.keyboard.press('Enter')
    await cell(6, 'category_id').click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(50)
    s = await state()
    check('Delete clears a cell and clears its error', ! (await cellClasses(6, 'category_id')).includes('ps-sheet-cell-error') && s.errorCount === 0, `errors ${s.errorCount}`)
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 2)
    await page.waitForTimeout(80)
    s = await state()
    const product1 = await page.evaluate(() => window.__server.products.find((p) => p.id === '1'))
    check('a clean save writes everything and empties the buffer', s.dirty.total === 0 && product1.price === 42 && product1.name === 'Product 1' && s.errorCount === 0 && ! s.canUndo, JSON.stringify(s.dirty))
    check('saved cells show the authoritative values without the dirty mark', ! (await cellClasses(0, 'price')).includes('ps-sheet-cell-dirty') && (await cell(0, 'price').innerText()) === '42.00')
    check('the notification counts the rows saved', (await page.locator('.ps-sheet-hint').innerText()).includes('rows saved'))

    // conflict
    await server_(() => { window.__server.state.conflictOn = '2' })
    await cell(1, 'name').click()
    await page.keyboard.type('Mine')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 3)
    await page.waitForTimeout(80)
    s = await state()
    check('a conflict keeps the cell, paints it purple and names their value', (await cellClasses(1, 'name')).includes('ps-sheet-cell-conflict') && (await cell(1, 'name').getAttribute('title')).includes('Their value: Renamed') && s.dirty.total === 1)
    await page.screenshot({ path: join(shots, 'conflict.png') })
    await server_(() => { window.__server.state.conflictOn = null })
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 4)
    await page.waitForTimeout(80)
    s = await state()
    check('saving again with the current version wins', s.dirty.total === 0 && (await page.evaluate(() => window.__server.products.find((p) => p.id === '2').name)) === 'Mine')

    // add a row, fill it, save
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(50)
    s = await state()
    check('Add row appends a new row marked as such', s.dirty.created === 1 && (await page.locator('.tabulator-row.ps-sheet-row-created').count()) === 1)
    const newRow = page.locator('.tabulator-row.ps-sheet-row-created')
    await newRow.locator('.tabulator-cell[tabulator-field="sku"]').click()
    await page.keyboard.type('SKU-NEW')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(30)
    await page.keyboard.type('Brand new')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 5)
    await page.waitForTimeout(80)
    s = await state()
    check('the new row is created with its defaults and replaced by the real row', s.dirty.total === 0 && s.total === 251 && (await page.evaluate(() => window.__server.products.at(-1))).sku === 'SKU-NEW' && (await page.locator('.tabulator-row.ps-sheet-row-created').count()) === 0, JSON.stringify({ dirty: s.dirty, total: s.total, call: await page.evaluate(() => window.__server.calls.save.at(-1)), last: await page.evaluate(() => window.__server.products.at(-1)) }))

    // paste past the last row creates rows
    await page.evaluate(() => { const sh = window.sheet(); sh.grid.table.scrollToRow(sh.rows.at(-1).id, 'bottom') })
    await page.waitForTimeout(80)
    const lastIndex = await page.evaluate(() => window.sheet().rows.length - 1)
    await page.locator('.tabulator-tableholder .tabulator-row').last().locator('.tabulator-cell[tabulator-field="sku"]').click()
    await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData('text/plain', 'SKU-P1\tPasted one\nSKU-P2\tPasted two\nSKU-P3\tPasted three')
        document.querySelector('.ps-sheet .tabulator-tableholder').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(80)
    s = await state()
    check('a paste past the last row creates rows', s.dirty.created === 2 && s.dirty.cells === 2, JSON.stringify(s.dirty) + ` last ${lastIndex}`)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)
    s = await state()
    check('undo takes the pasted rows away again', s.dirty.total === 0)

    // delete via the row header and the toolbar
    await page.locator('.tabulator-tableholder .tabulator-row').nth(2).locator('.ps-sheet-rownum').click()
    await page.waitForTimeout(50)
    s = await state()
    check('clicking a row number selects the row for deletion', s.selected === 1, `selected ${s.selected}`)
    await page.locator('.ps-sheet-btn', { hasText: 'Delete rows' }).click()
    await page.waitForTimeout(50)
    s = await state()
    check('Delete rows marks the row (struck through) until Save', s.dirty.deleted === 1 && (await page.locator('.tabulator-row.ps-sheet-row-deleted').count()) === 1)
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 6)
    await page.waitForTimeout(80)
    s = await state()
    check('the row is deleted on save', s.total === 250 && (await page.evaluate(() => window.__server.products.length)) === 250 && s.dirty.total === 0)

    // context menu
    await page.locator('.tabulator-tableholder .tabulator-row').nth(3).locator('.tabulator-cell[tabulator-field="name"]').click({ button: 'right' })
    await page.waitForTimeout(50)
    check('right-click opens the row menu', await page.locator('.ps-sheet-menu').isVisible())
    await page.locator('.ps-sheet-menu-item', { hasText: 'Delete row' }).click()
    await page.waitForTimeout(50)
    s = await state()
    check('the menu marks the row for deletion', s.dirty.deleted === 1)
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(50)
    s = await state()
    check('Discard drops everything unsaved', s.dirty.total === 0 && (await page.locator('.tabulator-row.ps-sheet-row-deleted').count()) === 0)

    // a locked cell and a read-only row refuse edits
    await page.locator('.ps-sheet-search input').fill('SKU-025')
    await page.waitForFunction(() => window.sheet().total === 1)
    await page.waitForTimeout(50)
    await cell(0, 'cost').dblclick()
    await page.waitForTimeout(50)
    check('a cell locked for its record does not open an editor', ! (await state()).editing && (await cellClasses(0, 'cost')).includes('ps-sheet-cell-locked'))
    await page.locator('.ps-sheet-search input').fill('SKU-040')
    await page.waitForFunction(() => window.sheet().rows[0]?.id === '40')
    await page.waitForTimeout(50)
    await cell(0, 'name').click()
    await page.keyboard.type('x')
    await page.waitForTimeout(30)
    check('a row the policy locks is greyed and refuses typing', ! (await state()).editing && (await page.locator('.tabulator-row.ps-sheet-row-readonly').count()) === 1, JSON.stringify({ editing: (await state()).editing, rows: await page.locator('.tabulator-row.ps-sheet-row-readonly').count(), meta: await page.evaluate(() => window.sheet().rows[0]) }))
    await page.locator('.ps-sheet-search input').fill('')
    await page.waitForFunction(() => window.sheet().total === 250)

    // dark mode and RTL screenshots
    await page.goto(`http://127.0.0.1:${port}/?dark`)
    await page.waitForSelector('.tabulator-tableholder .tabulator-row')
    await page.evaluate(() => document.body.style.background = '#0b1220')
    await cell(0, 'price').click()
    await page.keyboard.type('9')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(80)
    await page.screenshot({ path: join(shots, 'dark.png') })
    await page.goto(`http://127.0.0.1:${port}/?rtl`)
    await page.waitForSelector('.tabulator-tableholder .tabulator-row')
    await page.waitForTimeout(80)
    await page.screenshot({ path: join(shots, 'rtl.png') })

    // read-only
    await page.goto(`http://127.0.0.1:${port}/?readonly`)
    await page.waitForSelector('.tabulator-tableholder .tabulator-row')
    await cell(0, 'price').click()
    await page.keyboard.type('7')
    await page.keyboard.press('Enter')
    await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData('text/plain', 'x\ty')
        document.querySelector('.ps-sheet .tabulator-tableholder').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(80)
    s = await state()
    check('a read-only sheet takes no typing, no paste, and disables Save and Add row', s.dirty.total === 0 && ! s.editing && (await page.locator('.ps-sheet-btn-primary').isDisabled()) && (await page.locator('.ps-sheet-pill-readonly').isVisible()) && ! (await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).isVisible()), JSON.stringify(s.dirty))
} catch (e) {
    check('the run did not throw', false, String(e.stack ?? e))
} finally {
    await page.screenshot({ path: join(shots, 'final.png') }).catch(() => {})
    await browser.close()
    server.close()
}

if (errors.length) check('no console or page errors', false, errors.join(' | '))
else check('no console or page errors', true)

const failed = results.filter((r) => ! r.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots in ${shots}`)
process.exit(failed.length ? 1 : 0)
