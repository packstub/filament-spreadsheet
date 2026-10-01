/**
 * Drives the harness in headless Chromium through Playwright (borrowed from
 * demos/packstub-demo/node_modules, or a PLAYWRIGHT_CORE path) and checks the
 * interactions the Node suite cannot: typing into a cell, Enter moving down,
 * paste, fill-down, undo, dirty cells across pages, save (ok, errors,
 * conflicts), add and delete rows, Delete/Backspace/Ctrl+X over locked and
 * computed cells, a hostile select label, the shortcut scope, overlapping page
 * requests, a failed save or page request (rejected, or never settled with
 * Livewire's commit failure reported), Ctrl+S with an open editor, read-only
 * mode. Screenshots land in SCREENSHOT_DIR (default: tests/browser/screenshots,
 * ignored by git).
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

    // a new row the server refuses keeps its red cell until the cell is edited, then it clears (as on an existing row)
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(50)
    const refusedRow = page.locator('.tabulator-row.ps-sheet-row-created')
    await refusedRow.locator('.tabulator-cell[tabulator-field="sku"]').click()
    await page.keyboard.type('SKU-001')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(30)
    await page.keyboard.type('Taken')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 6)
    await page.waitForTimeout(80)
    s = await state()
    const refusedTemp = await page.evaluate(() => window.sheet().buffer.createdOrder[0])
    check('a new row the server refuses is painted red with the message', s.errorCount === 1 && s.dirty.created === 1 && ((await refusedRow.locator('.tabulator-cell[tabulator-field="sku"]').getAttribute('class')) ?? '').includes('ps-sheet-cell-error') && (await refusedRow.locator('.tabulator-cell[tabulator-field="sku"]').getAttribute('title')) === 'The SKU has already been taken.', JSON.stringify({ errors: s.errorCount, dirty: s.dirty }))
    await refusedRow.locator('.tabulator-cell[tabulator-field="sku"]').click()
    await page.keyboard.type('SKU-FIXED')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('editing the refused cell of a new row clears its error', s.errorCount === 0 && ! ((await refusedRow.locator('.tabulator-cell[tabulator-field="sku"]').getAttribute('class')) ?? '').includes('ps-sheet-cell-error') && (await page.evaluate((temp) => JSON.stringify(window.sheet().buffer.errors[temp]), refusedTemp)) === '{}', JSON.stringify({ errors: s.errorCount, buffer: await page.evaluate((temp) => window.sheet().buffer.errors[temp], refusedTemp) }))
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(50)

    // paste past the last row creates rows, in one undo step, with unreadable cells of the new rows painted red
    await page.evaluate(() => { const sh = window.sheet(); sh.grid.table.scrollToRow(sh.rows.at(-1).id, 'bottom') })
    await page.waitForTimeout(80)
    const lastIndex = await page.evaluate(() => window.sheet().rows.length - 1)
    await page.locator('.tabulator-tableholder .tabulator-row').last().locator('.tabulator-cell[tabulator-field="sku"]').click()
    await page.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData('text/plain', 'SKU-P1\tPasted one\tTools\nSKU-P2\tPasted two\tnope\nSKU-P3\tPasted three\tGarden')
        document.querySelector('.ps-sheet .tabulator-tableholder').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(80)
    s = await state()
    check('a paste past the last row creates rows', s.dirty.created === 2 && s.dirty.cells === 3, JSON.stringify(s.dirty) + ` last ${lastIndex}`)
    const pastedNew = page.locator('.tabulator-row.ps-sheet-row-created')
    check('an unreadable cell in a pasted new row is painted red at once', s.errorCount === 1 && ((await pastedNew.first().locator('.tabulator-cell[tabulator-field="category_id"]').getAttribute('class')) ?? '').includes('ps-sheet-cell-error') && (await pastedNew.first().locator('.tabulator-cell[tabulator-field="category_id"]').getAttribute('title')) === 'Not one of the options.' && ! ((await pastedNew.nth(1).locator('.tabulator-cell[tabulator-field="category_id"]').getAttribute('class')) ?? '').includes('ps-sheet-cell-error'), JSON.stringify({ errors: s.errorCount, buffer: await page.evaluate(() => window.sheet().buffer.errors) }))
    check('the paste is one undo step', (await page.evaluate(() => window.sheet().buffer.undo.length)) === 1)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)
    s = await state()
    check('one undo takes the pasted rows and cells away again', s.dirty.total === 0 && s.errorCount === 0 && ! s.canUndo && s.canRedo && (await pastedNew.count()) === 0, JSON.stringify(s.dirty))
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(50)
    s = await state()
    check('redo brings the whole paste back, red cell included', s.dirty.created === 2 && s.dirty.cells === 3 && s.errorCount === 1 && (await pastedNew.count()) === 2, JSON.stringify(s.dirty))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)

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
    await page.waitForFunction(() => window.__server.calls.save.length === 7)
    await page.waitForTimeout(80)
    s = await state()
    check('the row is deleted on save', s.total === 250 && (await page.evaluate(() => window.__server.products.length)) === 250 && s.dirty.total === 0)

    // context menu (one path: the view's contextmenu handler; Tabulator's rowContext used to open it a second time)
    await page.evaluate(() => { const s = window.sheet(); const orig = s.openMenu; window.__menuCalls = 0; s.openMenu = function (e) { window.__menuCalls++; return orig.call(this, e) } })
    await page.locator('.tabulator-tableholder .tabulator-row').nth(3).locator('.tabulator-cell[tabulator-field="name"]').click({ button: 'right' })
    await page.waitForTimeout(50)
    check('right-click opens the row menu, once', (await page.locator('.ps-sheet-menu').isVisible()) && (await page.evaluate(() => window.__menuCalls)) === 1, `calls ${await page.evaluate(() => window.__menuCalls)}`)
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

    // Delete on a read-only row leaves it alone (Tabulator's own range clearing would blank it)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(50)
    const readOnlyRow = await page.evaluate(() => ({ changes: window.sheet().buffer.changes['40'], text: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="name"]').innerText }))
    check('Delete on a read-only row neither buffers nor blanks the cell', readOnlyRow.changes === undefined && readOnlyRow.text === 'Product 40', JSON.stringify(readOnlyRow))

    // Delete over a range holding a locked cell (cost on SKU-025) and the computed margin clears only what may be edited
    await page.locator('.ps-sheet-search input').fill('SKU-025')
    await page.waitForFunction(() => window.sheet().rows[0]?.id === '25')
    await page.waitForTimeout(50)
    const textsBefore = await page.evaluate(() => ['cost', 'margin'].map((f) => document.querySelector(`.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="${f}"]`).innerText))
    await cell(0, 'cost').click()
    await page.keyboard.down('Shift')
    await cell(0, 'margin').click()
    await page.keyboard.up('Shift')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(50)
    const cleared = await page.evaluate(() => ({ changes: window.sheet().buffer.changes['25'], texts: ['cost', 'margin'].map((f) => document.querySelector(`.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="${f}"]`).innerText) }))
    check('Delete over a range clears the editable cells only: the locked and the computed cell keep their value', Object.keys(cleared.changes ?? {}).sort().join() === 'available_on,is_active,published_at,stock' && Object.values(cleared.changes).every((v) => v === null) && cleared.texts.join() === textsBefore.join(), JSON.stringify({ cleared, textsBefore }))
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => ! window.sheet().saving)
    await page.waitForTimeout(80)
    s = await state()
    check('the save after that Delete goes through: nothing the server refuses was sent', s.dirty.total === 0 && s.errorCount === 0 && (await page.evaluate(() => Object.keys(window.__server.calls.save.at(-1).changed['25']).sort().join())) === 'available_on,is_active,published_at,stock', JSON.stringify({ dirty: s.dirty, errors: s.errorCount }))

    // Backspace clears too; a hostile select option label is text, never HTML
    await page.locator('.ps-sheet-search input').fill('SKU-001')
    await page.waitForFunction(() => window.sheet().rows[0]?.id === '1')
    await page.waitForTimeout(50)
    await cell(0, 'stock').click()
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(50)
    check('Backspace clears the selected cell', (await page.evaluate(() => window.sheet().buffer.changes['1']?.stock)) === null && (await cell(0, 'stock').innerText()) === '')
    await page.evaluate(() => { const col = window.sheet().grid.table.getColumn('category_id'); col.getDefinition().editorParams.values.push({ label: '<img src=x onerror="window.__xss=1"><b id="xss-label">Bold</b>', value: '9' }) })
    await cell(0, 'category_id').dblclick()
    await page.waitForSelector('.tabulator-edit-list')
    await page.waitForTimeout(100)
    const listItems = await page.evaluate(() => ({ xss: window.__xss, bold: !! document.querySelector('#xss-label'), img: !! document.querySelector('.tabulator-edit-list img'), last: document.querySelector('.tabulator-edit-list .tabulator-edit-list-item:last-child')?.textContent }))
    check('a select option label with HTML in it is shown as text and runs nothing', listItems.xss === undefined && ! listItems.bold && ! listItems.img && listItems.last === '<img src=x onerror="window.__xss=1"><b id="xss-label">Bold</b>', JSON.stringify(listItems))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(50)

    // the text editor carries the column's maxLength
    await cell(0, 'name').click()
    await page.keyboard.press('F2')
    await page.waitForSelector('.tabulator-editing input')
    check('the text editor limits typing to the column\'s maxLength', (await page.locator('.tabulator-editing input').getAttribute('maxlength')) === '120')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(30)

    // Ctrl+X copies the selection the way Ctrl+C does, then clears the editable cells
    await page.evaluate(() => { window.__copied = null; document.addEventListener('copy', (e) => { window.__copied = e.clipboardData.getData('text/plain') }) })
    await cell(0, 'name').click()
    await page.keyboard.press('Control+x')
    await page.waitForTimeout(80)
    const cut = await page.evaluate(() => ({ copied: window.__copied, name: window.sheet().buffer.changes['1']?.name, text: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="name"]').innerText }))
    check('Ctrl+X puts the cell on the clipboard and clears it', cut.copied === 'Product 1' && cut.name === null && cut.text === '', JSON.stringify(cut))
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)
    s = await state()
    check('undo brings the cut and the cleared cell back', s.dirty.total === 0, JSON.stringify(s.dirty))

    // outside the grid only Ctrl+S is the sheet's: the search box keeps its own Ctrl+Z, Ctrl+D and Ctrl+Enter
    await cell(0, 'name').click()
    await page.keyboard.type('Zed')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const savesBefore = await page.evaluate(() => window.__server.calls.save.length)
    await page.locator('.ps-sheet-search input').focus()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+d')
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('Ctrl+Z, Ctrl+D and Ctrl+Enter in the search box leave the sheet alone', s.dirty.total === 1 && s.dirty.created === 0 && s.dirty.cells === 1, JSON.stringify(s.dirty))
    await page.keyboard.press('Control+s')
    await page.waitForFunction((n) => window.__server.calls.save.length === n + 1, savesBefore)
    await page.waitForTimeout(80)
    s = await state()
    check('Ctrl+S in the search box still saves', s.dirty.total === 0 && (await page.evaluate(() => window.__server.products.find((p) => p.id === '1').name)) === 'Zed')
    check('Ctrl+S in the search box leaves the caret there', (await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.type)) === 'INPUT.search')

    // a toolbar button hands the keyboard back to the grid: Ctrl+Y right after a click on Undo redoes, Ctrl+Z after Add row removes the row
    await cell(0, 'name').click()
    await page.keyboard.type('Edited')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    await page.locator('.ps-sheet-seg-btn[aria-label="Undo"]').click()
    await page.waitForTimeout(50)
    s = await state()
    const focusAfterUndo = await page.evaluate(() => document.activeElement?.tagName + (document.activeElement?.closest('.ps-sheet-grid') ? '.grid' : ''))
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(50)
    const afterRedo = await state()
    check('a click on Undo undoes and Ctrl+Y right after redoes', s.dirty.total === 0 && s.canRedo && focusAfterUndo === 'DIV.grid' && afterRedo.dirty.total === 1 && afterRedo.dirty.cells === 1, JSON.stringify({ afterClick: s.dirty, focusAfterUndo, afterRedo: afterRedo.dirty }))
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(50)
    s = await state()
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)
    const afterUndo = await state()
    check('a click on Add row adds and Ctrl+Z right after removes the row', s.dirty.created === 1 && afterUndo.dirty.created === 0 && afterUndo.dirty.total === 1, JSON.stringify({ afterClick: s.dirty, afterUndo: afterUndo.dirty }))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)
    s = await state()
    check('the sheet is clean again', s.dirty.total === 0, JSON.stringify(s.dirty))

    // a save while a page request is in flight: the stale page is dropped, the page asked for again after the save
    await cell(0, 'name').click()
    await page.keyboard.type('Zed2')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const raceSave = await page.evaluate(async () => {
        const orig = window.__wire.spreadsheetRows
        window.__wire.spreadsheetRows = async (req) => { const r = await orig(req); await new Promise((res) => setTimeout(res, 400)); return r }
        const sh = window.sheet()
        const rowsCalls = window.__server.calls.rows.length
        sh.refresh()
        await new Promise((res) => setTimeout(res, 20))
        await sh.save()
        const afterSave = { name: sh.rows[0].values.name, version: sh.rows[0].version, dirty: sh.dirty.total, loading: sh.loading }
        await new Promise((res) => setTimeout(res, 1000))
        window.__wire.spreadsheetRows = orig
        return { afterSave, afterRefresh: { name: sh.rows[0].values.name, version: sh.rows[0].version, loading: sh.loading, text: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="name"]').innerText, rowsCalls: window.__server.calls.rows.length - rowsCalls, server: window.__server.products.find((p) => p.id === '1').version } }
    })
    check('a save while a page request is in flight keeps the saved values and version', raceSave.afterSave.name === 'Zed2' && raceSave.afterSave.dirty === 0 && raceSave.afterRefresh.name === 'Zed2' && raceSave.afterRefresh.text === 'Zed2' && raceSave.afterRefresh.version === raceSave.afterRefresh.server && ! raceSave.afterRefresh.loading && raceSave.afterRefresh.rowsCalls === 2, JSON.stringify(raceSave))
    await cell(0, 'price').click()
    await page.keyboard.type('9')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const versionCarried = await page.evaluate(() => ({ buffer: window.sheet().buffer.versions['1'], server: window.__server.products.find((p) => p.id === '1').version }))
    check('the next edit on that row carries the current version, not a stale one', versionCarried.buffer === versionCarried.server, JSON.stringify(versionCarried))
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(50)

    // overlapping page requests: the answer of the latest request wins, whatever order they land in
    await page.evaluate(() => {
        const orig = window.__wire.spreadsheetRows
        let n = 0
        window.__wire.__origRows = orig
        window.__wire.spreadsheetRows = async (req) => { const k = ++n; const r = await orig(req); await new Promise((res) => setTimeout(res, k === 1 ? 300 : 10)); return r }
        const sh = window.sheet()
        sh.search = 'SKU-00'
        sh.refresh()
        sh.search = 'SKU-001'
        sh.refresh()
    })
    await page.waitForTimeout(600)
    const raced = await page.evaluate(() => ({ search: window.sheet().search, total: window.sheet().total, loading: window.sheet().loading }))
    check('the latest request wins when an earlier answer lands later', raced.total === 1 && raced.search === 'SKU-001' && ! raced.loading, JSON.stringify(raced))
    await page.evaluate(() => { window.__wire.spreadsheetRows = window.__wire.__origRows })

    await page.locator('.ps-sheet-search input').fill('')
    await page.waitForFunction(() => window.sheet().total === 250)

    // while a save is in flight the sheet takes no edits: what is typed, pasted, filled, added, deleted or undone meanwhile is dropped, the answer lands cleanly, and editing works again afterwards
    await cell(0, 'name').click()
    await page.keyboard.type('Held')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const delaySave = () => page.evaluate(() => {
        window.__wire.__origSave ??= window.__wire.spreadsheetSave
        const orig = window.__wire.__origSave
        window.__wire.spreadsheetSave = async (p) => { await new Promise((r) => setTimeout(r, 600)); return orig(p) }
        window.__savePromise = window.sheet().save()
    })
    const awaitSave = (fn) => page.evaluate(async (src) => {
        await window.__savePromise
        window.__wire.spreadsheetSave = window.__wire.__origSave
        await new Promise((r) => setTimeout(r, 80))

        return (0, eval)(src)()
    }, `() => (${fn.toString()})()`)
    await delaySave()
    await page.waitForTimeout(50)
    await page.keyboard.type('77')
    await page.keyboard.press('F2')
    await page.keyboard.press('Delete')
    await page.keyboard.press('Control+Enter')
    await page.keyboard.press('Control+d')
    await page.keyboard.press('Control+z')
    const during = await page.evaluate(() => {
        const sh = window.sheet()
        const focusInGrid = !! document.activeElement?.closest('.ps-sheet-grid')
        sh.onEdit('1', 'price', sh.rows[0].values.price, 77)
        sh.onPaste('Pasted\tTools')
        sh.addRow()
        sh.markDeleted(['3'])
        sh.undo()

        return { focusInGrid, saving: sh.saving, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-saving'), editing: sh.grid.isEditing(), dirty: { ...sh.dirty }, changes1: Object.keys(sh.buffer.changes['1'] ?? {}), changes2: sh.buffer.changes['2'] ?? null, created: sh.buffer.createdOrder.length, undoDisabled: document.querySelector('.ps-sheet-seg-btn[aria-label="Undo"]').disabled, priceText: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="price"]').innerText }
    })
    check('while a save is in flight typing, F2, Delete, Ctrl+Enter, Ctrl+D, Ctrl+Z, a paste, Add row, a deletion and an edit change nothing, and the sheet says so', during.focusInGrid && during.saving && during.cue && ! during.editing && during.dirty.total === 1 && during.dirty.cells === 1 && during.changes1.join() === 'name' && during.changes2 === null && during.created === 0 && during.undoDisabled && during.priceText === '42.00', JSON.stringify(during))
    const afterHeld = await awaitSave(() => {
        const sh = window.sheet()
        const server = window.__server.products.find((p) => p.id === '1')

        return { saving: sh.saving, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-saving'), dirty: sh.dirty.total, changes1: sh.buffer.changes['1'] ?? null, undo: sh.buffer.undo.length, canUndo: sh.canUndo, serverName: server.name, serverPrice: server.price, nameText: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="name"]').innerText, priceText: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="price"]').innerText, version: sh.rows[0].version === server.version }
    })
    check('the answer lands cleanly: the held cell is saved, nothing from meanwhile is in the buffer or on the grid', ! afterHeld.saving && ! afterHeld.cue && afterHeld.dirty === 0 && afterHeld.changes1 === null && afterHeld.undo === 0 && ! afterHeld.canUndo && afterHeld.serverName === 'Held' && afterHeld.serverPrice === 42 && afterHeld.nameText === 'Held' && afterHeld.priceText === '42.00' && afterHeld.version, JSON.stringify(afterHeld))
    await cell(0, 'price').click()
    await page.keyboard.type('5')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('editing works again once the save is answered', s.dirty.total === 1 && s.dirty.cells === 1 && (await page.evaluate(() => window.sheet().buffer.changes['1']?.price)) === 5, JSON.stringify(s.dirty))
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(50)

    // a new row being saved takes no edit during the save, no row can be added meanwhile, and it is created as sent
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(50)
    const heldTemp = await page.evaluate(() => { const sh = window.sheet(); const temp = sh.buffer.createdOrder[0]; sh.onEdit(temp, 'sku', null, 'SKU-HELD'); sh.onEdit(temp, 'name', null, 'Held row'); return temp })
    await delaySave()
    await page.waitForTimeout(50)
    const heldDuring = await page.evaluate((temp) => {
        const sh = window.sheet()
        sh.onEdit(temp, 'price', null, 12.5)
        sh.addRow()

        return { created: sh.buffer.createdOrder.length, price: sh.buffer.created[temp]?.price ?? null, saving: sh.saving }
    }, heldTemp)
    const heldAfter = await awaitSave(() => {
        const sh = window.sheet()
        const created = window.__server.products.find((p) => p.sku === 'SKU-HELD')

        return { dirty: sh.dirty.total, created: sh.buffer.createdOrder.length, server: created ? { name: created.name, price: created.price } : null, createdRows: document.querySelectorAll('.ps-sheet-row-created').length, gridRows: sh.grid.table.getRows().length, total: sh.total }
    })
    check('a new row being saved takes no edit and no sibling during the save, and is created as sent', heldDuring.saving && heldDuring.created === 1 && heldDuring.price === null && heldAfter.dirty === 0 && heldAfter.created === 0 && heldAfter.server?.name === 'Held row' && heldAfter.server?.price === 0 && heldAfter.createdRows === 0 && heldAfter.gridRows === 101 && heldAfter.total === 251, JSON.stringify({ heldDuring, heldAfter }))
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(50)
    s = await state()
    check('Add row works again once the save is answered', s.dirty.created === 1, JSON.stringify(s.dirty))
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(50)

    // a paste past the last row stops creating rows at the server's cap on rows per save (300 in the harness), and says so
    await page.locator('.ps-sheet-per-page select').selectOption('25')
    await page.waitForFunction(() => window.sheet().rows.length === 25)
    await page.waitForTimeout(60)
    await page.evaluate(() => { const sh = window.sheet(); sh.grid.table.scrollToRow(sh.rows.at(-1).id, 'bottom') })
    await page.waitForTimeout(80)
    await page.locator('.tabulator-tableholder .tabulator-row').last().locator('.tabulator-cell[tabulator-field="name"]').click()
    await page.evaluate(() => {
        const lines = []
        for (let i = 0; i < 320; i++) lines.push(`Name ${i}\tTools\t${i}.5`)
        const dt = new DataTransfer()
        dt.setData('text/plain', lines.join('\n') + '\n')
        document.querySelector('.ps-sheet .tabulator-tableholder').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await page.waitForTimeout(150)
    s = await state()
    check('a paste past the cap creates rows up to it and reports the rest', s.dirty.created === 299 && s.dirty.rows === 1 && (await page.evaluate(() => window.sheet().grid.table.getRows().length)) === 324 && (await page.locator('.ps-sheet-hint').innerText()).includes('20 rows were not added: a save takes at most 300 rows.'), JSON.stringify({ dirty: s.dirty, hint: await page.locator('.ps-sheet-hint').innerText() }))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(150)
    s = await state()
    check('one undo takes the capped paste away', s.dirty.total === 0 && (await page.evaluate(() => window.sheet().grid.table.getRows().length)) === 25, JSON.stringify(s.dirty))

    // Ctrl+S with an open editor as the only change: the editor is committed first, then saved (fresh page)
    await page.goto(`http://127.0.0.1:${port}/`)
    await page.waitForSelector('.tabulator-tableholder .tabulator-row')
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100)
    const saveButton = page.locator('.ps-sheet-btn-primary')
    const hintText = () => page.evaluate(() => window.sheet().hint ?? '')
    check('Save is disabled on a clean sheet', await saveButton.isDisabled())
    await cell(0, 'name').click()
    await page.keyboard.type('Only edit')
    await page.waitForTimeout(50)
    s = await state()
    check('an open editor is not a buffered change yet, and Save is enabled for it', s.editing && s.dirty.total === 0 && (await saveButton.isEnabled()), JSON.stringify(s.dirty))
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => ! window.sheet().saving && window.__server.calls.save.length > 0, null, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(80)
    s = await state()
    const soleSave = await page.evaluate(() => ({ calls: window.__server.calls.save.length, changed: window.__server.calls.save[0]?.changed ?? null, server: window.__server.products.find((p) => p.id === '1').name, text: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="name"]').innerText, hint: window.sheet().hint }))
    check('Ctrl+S with an open editor as the only change commits it and saves it in one call', soleSave.calls === 1 && JSON.stringify(soleSave.changed) === '{"1":{"name":"Only edit"}}' && soleSave.server === 'Only edit' && soleSave.text === 'Only edit' && s.dirty.total === 0 && ! s.editing && soleSave.hint !== 'Nothing to save.', JSON.stringify({ soleSave, dirty: s.dirty, editing: s.editing }))
    check('Save is disabled again once it is saved', await saveButton.isDisabled())

    // the same by mouse: the click on Save takes the focus, which commits the editor
    await cell(1, 'name').click()
    await page.keyboard.type('By mouse')
    await page.waitForTimeout(50)
    await saveButton.click({ timeout: 2000 }).catch(() => {})
    await page.waitForFunction(() => ! window.sheet().saving && window.__server.calls.save.length > 1, null, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(80)
    s = await state()
    const mouseSave = await page.evaluate(() => ({ calls: window.__server.calls.save.length, changed: window.__server.calls.save[1]?.changed ?? null, server: window.__server.products.find((p) => p.id === '2').name }))
    check('a click on Save with an open editor as the only change saves it too', mouseSave.calls === 2 && JSON.stringify(mouseSave.changed) === '{"2":{"name":"By mouse"}}' && mouseSave.server === 'By mouse' && s.dirty.total === 0 && ! s.editing, JSON.stringify({ mouseSave, dirty: s.dirty, editing: s.editing }))
    await cell(2, 'name').click()
    await page.keyboard.press('F2')
    await page.waitForTimeout(50)
    const enabledWhileOpen = await saveButton.isEnabled()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(50)
    check('an editor closed with Escape leaves Save disabled and nothing to save', enabledWhileOpen && (await saveButton.isDisabled()) && (await state()).dirty.total === 0)

    // a save whose request fails with a rejected promise (Livewire 4): the lock is released, nothing is lost, a retry saves
    await cell(0, 'name').click()
    await page.keyboard.type('Rejected')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    await page.evaluate(() => {
        window.__wire.__origSave = window.__wire.spreadsheetSave
        window.__wire.spreadsheetSave = async () => { await new Promise((r) => setTimeout(r, 200)); throw new Error('Failed to fetch') }
    })
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(60)
    const rejectDuring = await page.evaluate(() => window.sheet().saving)
    await page.waitForTimeout(400)
    s = await state()
    const rejected = await page.evaluate(() => { const sh = window.sheet(); return { saving: sh.saving, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-saving'), change: sh.buffer.changes['1']?.name, undo: sh.buffer.undo.length, calls: window.__server.calls.save.length, waiting: sh.waitingCalls() } })
    check('a save whose promise rejects releases the lock, keeps the buffer and the undo stack, and says so', rejectDuring && ! rejected.saving && ! rejected.cue && rejected.change === 'Rejected' && rejected.undo === 1 && rejected.calls === 2 && rejected.waiting === 0 && s.dirty.total === 1 && (await hintText()).includes('Could not reach the server') && (await saveButton.isEnabled()), JSON.stringify({ rejectDuring, rejected, hint: await hintText() }))

    // a save whose promise never settles while Livewire reports the commit failed (Livewire 3)
    await page.evaluate(() => {
        window.__wire.spreadsheetSave = () => new Promise((resolve) => { window.__lateSave = () => resolve({ ok: false, saved: {}, created: {}, deleted: [], errors: {}, rowErrors: { 1: 'A late answer.' }, conflicts: {}, versions: {}, message: 'A late answer.', rolledBack: false }) })
    })
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(300)
    const stuck = await page.evaluate(() => {
        const sh = window.sheet()
        const before = sh.saving
        window.Livewire.failCommit(['spreadsheetSave'], 'another-component')
        window.Livewire.failCommit(['spreadsheetRows'])

        return { before, afterOthers: sh.saving }
    })
    await page.evaluate(() => window.Livewire.failCommit(['spreadsheetSave']))
    await page.waitForTimeout(80)
    s = await state()
    const signalled = await page.evaluate(() => { const sh = window.sheet(); return { saving: sh.saving, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-saving'), change: sh.buffer.changes['1']?.name, undo: sh.buffer.undo.length, waiting: sh.waitingCalls() } })
    check('a save that never settles stays locked until its own commit fails: another component\'s, or a commit without the save, changes nothing', stuck.before && stuck.afterOthers, JSON.stringify(stuck))
    check('the failure Livewire reports releases the lock, keeps the buffer and the undo stack, and says so', ! signalled.saving && ! signalled.cue && signalled.change === 'Rejected' && signalled.undo === 1 && signalled.waiting === 0 && s.dirty.total === 1 && (await hintText()).includes('Could not reach the server') && (await saveButton.isEnabled()), JSON.stringify({ signalled, hint: await hintText() }))
    await cell(0, 'price').click()
    await page.keyboard.type('6')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('editing works again after a failed save', s.dirty.rows === 1 && s.dirty.cells === 2, JSON.stringify(s.dirty))
    await page.evaluate(() => window.__lateSave())
    await page.waitForTimeout(80)
    s = await state()
    const late = await page.evaluate(() => { const sh = window.sheet(); return { changes: sh.buffer.changes['1'], rowError: sh.buffer.rowErrors['1'] ?? null, undo: sh.buffer.undo.length, hint: sh.hint, saving: sh.saving } })
    check('an answer that lands after the reported failure is ignored', late.changes?.name === 'Rejected' && late.changes?.price === 6 && late.rowError === null && late.undo === 2 && late.hint !== 'A late answer.' && ! late.saving && s.errorCount === 0 && s.dirty.cells === 2, JSON.stringify(late))
    await page.evaluate(() => { window.__wire.spreadsheetSave = window.__wire.__origSave })
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => ! window.sheet().saving && window.__server.calls.save.length > 2, null, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(80)
    s = await state()
    const retried = await page.evaluate(() => { const p = window.__server.products.find((x) => x.id === '1'); return { calls: window.__server.calls.save.length, changed: window.__server.calls.save.at(-1).changed, name: p.name, price: p.price } })
    check('the retry saves what the failed save held and what was edited since', retried.calls === 3 && JSON.stringify(retried.changed) === '{"1":{"name":"Rejected","price":6}}' && retried.name === 'Rejected' && retried.price === 6 && s.dirty.total === 0, JSON.stringify({ retried, dirty: s.dirty }))

    // a page request that fails: rejected (Livewire 4), or never settled with the failure reported (Livewire 3)
    await cell(1, 'stock').click()
    await page.keyboard.type('4')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const rowsRejected = await page.evaluate(async () => {
        const sh = window.sheet()
        window.__wire.__origRows = window.__wire.spreadsheetRows
        window.__wire.spreadsheetRows = async () => { throw new Error('Failed to fetch') }
        sh.hint = null
        await sh.refresh()

        return { loading: sh.loading, rows: sh.rows.length, hint: sh.hint, dirty: sh.dirty.total, waiting: sh.waitingCalls() }
    })
    check('a page request whose promise rejects clears the loading state and keeps the rows and the buffer', ! rowsRejected.loading && rowsRejected.rows === 100 && rowsRejected.dirty === 1 && rowsRejected.waiting === 0 && String(rowsRejected.hint).includes('Could not reach the server'), JSON.stringify(rowsRejected))
    const rowsStuck = await page.evaluate(async () => {
        const sh = window.sheet()
        window.__wire.spreadsheetRows = () => new Promise((resolve) => { window.__lateRows = () => resolve({ ok: true, rows: [], total: 0, page: 1, perPage: 100, lastPage: 1 }) })
        sh.hint = null
        sh.refresh()
        await new Promise((r) => setTimeout(r, 200))
        const before = { loading: sh.loading, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-loading') }
        window.Livewire.failCommit(['spreadsheetSave'])
        const afterOther = sh.loading
        window.Livewire.failCommit(['spreadsheetRows'])
        await new Promise((r) => setTimeout(r, 50))
        const after = { loading: sh.loading, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-loading'), rows: sh.rows.length, hint: sh.hint, dirty: sh.dirty.total, waiting: sh.waitingCalls() }
        window.__lateRows()
        await new Promise((r) => setTimeout(r, 50))
        const late = { rows: sh.rows.length, total: sh.total, gridRows: sh.grid.table.getRows().length }
        window.__wire.spreadsheetRows = window.__wire.__origRows
        await sh.refresh()

        return { before, afterOther, after, late, retry: { rows: sh.rows.length, loading: sh.loading, dirty: sh.dirty.total } }
    })
    check('a page request that never settles is released by the failure Livewire reports for its commit', rowsStuck.before.loading && rowsStuck.before.cue && rowsStuck.afterOther && ! rowsStuck.after.loading && ! rowsStuck.after.cue && rowsStuck.after.rows === 100 && rowsStuck.after.dirty === 1 && rowsStuck.after.waiting === 0 && String(rowsStuck.after.hint).includes('Could not reach the server'), JSON.stringify(rowsStuck))
    check('its late answer is ignored and the next request loads the page', rowsStuck.late.rows === 100 && rowsStuck.late.total === 250 && rowsStuck.late.gridRows === 100 && rowsStuck.retry.rows === 100 && ! rowsStuck.retry.loading && rowsStuck.retry.dirty === 1, JSON.stringify(rowsStuck))

    // the hook is the component's own and goes with it
    const hooks = await page.evaluate(() => { const sh = window.sheet(); const before = window.Livewire.listeners.commit.length; sh._unhook(); return { before, after: window.Livewire.listeners.commit.length } })
    check('the commit hook is registered once and removed by the function destroy() calls', hooks.before === 1 && hooks.after === 0, JSON.stringify(hooks))

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
