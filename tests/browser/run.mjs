/**
 * Drives the harness in headless Chromium through Playwright (borrowed from
 * demos/packstub-demo/node_modules, or a PLAYWRIGHT_CORE path) and checks the
 * interactions the Node suite cannot: typing into a cell, Enter moving down,
 * paste, fill-down, undo, dirty cells across pages, save (ok, errors,
 * conflicts), add and delete rows, Delete/Backspace/Ctrl+X over locked and
 * computed cells, a hostile select label, the shortcut scope, overlapping page
 * requests, a failed save or page request (rejected, or never settled with
 * Livewire's commit failure reported), Ctrl+S with an open editor, the grid's
 * own height and its row window (rows scrolled out of view), a page answer
 * landing on an open editor, a click outside the grid with an editor open, a
 * failed page / sort / page-size request, a cell edited after its row was
 * updated out of the window, a sheet built while hidden and a window resize,
 * Ctrl+ArrowDown / Ctrl+ArrowUp, the editing state after an outside click,
 * where a new page opens and what keeps the scroll, the active cell and the
 * range over a re-read of the same rows, the leave guard,
 * read-only mode.
 * Screenshots land in SCREENSHOT_DIR (default: tests/browser/screenshots,
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
let dialogs = 0
page.on('dialog', (d) => { dialogs++; d.accept() })
const logged = []
page.on('console', (m) => logged.push(m.text()))

const state = () => page.evaluate(() => { const s = window.sheet(); return { dirty: s.dirty, page: s.page, lastPage: s.lastPage, total: s.total, rows: s.rows.length, canUndo: s.canUndo, canRedo: s.canRedo, errorCount: s.errorCount, selected: s.selected, active: s.grid.activeCell(), editing: s.grid.isEditing() } })
const cell = (rowIndex, field) => page.locator(`.tabulator-tableholder .tabulator-row`).nth(rowIndex).locator(`.tabulator-cell[tabulator-field="${field}"]`)
const cellClasses = async (rowIndex, field) => (await cell(rowIndex, field).getAttribute('class')) ?? ''
const server_ = (fn) => page.evaluate(fn)
const fresh = async (query = '') => {
    await page.goto(`http://127.0.0.1:${port}/${query}`)
    await page.waitForSelector('.tabulator-tableholder .tabulator-row')
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100)
    await page.waitForTimeout(100)
}
// The grid renders only the rows around its visible window: `cell(index, …)` counts the row elements in the DOM
// (the first one is row 1 only while the grid is scrolled to the top). A row further down is scrolled to and
// addressed by its id.
const scrollToRow = async (id, position = 'center') => { await page.evaluate(([i, p]) => window.sheet().grid.scrollTo(i, p), [String(id), position]); await page.waitForTimeout(80) }
const cellOf = async (id, field) => (await page.evaluateHandle(([i, f]) => window.sheet().grid.table.getRow(i).getCell(f).getElement(), [String(id), field])).asElement()
const rendered = (id) => page.evaluate((i) => !! window.sheet().grid.table.getRow(i).getElement()?.isConnected, String(id))
const pasteText = (text) => page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('.ps-sheet .tabulator-tableholder').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}, text)

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
    // the option list lives on the body, outside the grid's element: picking from it with the mouse still leaves the keyboard on the grid
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(30)
    s = await state()
    check('after an option is picked with the mouse the keyboard is still the grid\'s', (await page.evaluate(() => !! document.activeElement?.classList.contains('tabulator-tableholder'))) && s.active?.id === (await page.evaluate(() => window.sheet().rows[3].id)) && s.active?.col === 'category_id', JSON.stringify(s.active))

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
    await scrollToRow(await page.evaluate(() => window.sheet().rows.at(-1).id), 'bottom')
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
    await scrollToRow(await page.evaluate(() => window.sheet().rows.at(-1).id), 'bottom')
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

    /* ---------------------------------------------------------------- the grid's own height, the row window */

    await fresh()
    const measure = () => page.evaluate(() => {
        const g = document.querySelector('.ps-sheet-grid')
        const h = g.querySelector('.tabulator-tableholder')
        const style = getComputedStyle(g)
        const probe = document.createElement('div')
        probe.style.height = getComputedStyle(document.querySelector('.ps-sheet')).getPropertyValue('--ps-sheet-height')
        document.querySelector('.ps-sheet').append(probe)
        const configured = probe.getBoundingClientRect().height
        probe.remove()

        return { grid: g.getBoundingClientRect().height, configured, borders: style.boxSizing === 'border-box' ? 0 : parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), variable: document.querySelector('.ps-sheet').style.getPropertyValue('--ps-sheet-height'), inline: g.style.height, window: innerHeight, loaded: window.sheet().rows.length, header: g.querySelector('.tabulator-header').getBoundingClientRect().height, rowEls: h.querySelectorAll('.tabulator-row').length, client: h.clientHeight, scroll: h.scrollHeight, doc: document.documentElement.scrollHeight, headerTop: Math.round(g.querySelector('.tabulator-header').getBoundingClientRect().top) }
    })
    let m = await measure()
    const visibleHeader = m.header
    console.log(`     grid ${m.grid}px (configured ${m.configured}px + ${m.borders}px border), ${m.rowEls} row elements of ${m.loaded} rows, holder ${m.client}/${m.scroll}px, document ${m.doc}px`)
    check('the configured height reaches the grid: --ps-sheet-height is set from the config and Tabulator takes it', m.variable === '32rem' && m.inline === 'var(--ps-sheet-height)' && m.configured === 512 && Math.abs(m.grid - m.configured - m.borders) < 1, JSON.stringify(m))
    check('the grid is no taller than the window and the page does not scroll for it', m.grid <= m.window && m.doc <= m.window, JSON.stringify(m))
    check('only the rows around the visible window are in the DOM, and the grid scrolls inside itself', m.loaded === 100 && m.rowEls < m.loaded && m.rowEls > 0 && m.scroll > m.client, JSON.stringify(m))

    // the last row: reachable by scrolling the grid, editable there, the header in place
    check('the last row has no element until it is scrolled to', ! (await rendered(100)))
    await scrollToRow(100, 'bottom')
    await (await cellOf(100, 'name')).click()
    await page.keyboard.type('Last row')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const lastRow = await page.evaluate(() => { const row = window.sheet().grid.table.getRow('100'); const el = row.getCell('name').getElement(); return { change: window.sheet().buffer.changes['100']?.name, text: el.innerText, dirty: el.classList.contains('ps-sheet-cell-dirty'), number: row.getElement().querySelector('.ps-sheet-rownum').innerText, headerTop: Math.round(document.querySelector('.ps-sheet-grid .tabulator-header').getBoundingClientRect().top), scrollY: window.scrollY } })
    check('the last row is reached by scrolling the grid and edited there, the header staying in place', lastRow.change === 'Last row' && lastRow.text === 'Last row' && lastRow.dirty && lastRow.number === '100' && lastRow.headerTop === m.headerTop && lastRow.scrollY === 0, JSON.stringify(lastRow))

    // a changed row scrolled out of the window and back keeps its mark
    await scrollToRow(1, 'top')
    const gone = ! (await rendered(100))
    await scrollToRow(100, 'bottom')
    const back = await page.evaluate(() => { const el = window.sheet().grid.table.getRow('100').getCell('name').getElement(); return { text: el.innerText, dirty: el.classList.contains('ps-sheet-cell-dirty') } })
    check('a changed cell scrolled out of the window and back is still painted dirty', gone && back.text === 'Last row' && back.dirty, JSON.stringify({ gone, back }))

    // a server error on a row that is out of the window is painted when the row scrolls in
    await (await cellOf(100, 'sku')).click()
    await page.keyboard.type('SKU-001')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    await scrollToRow(1, 'top')
    await cell(0, 'name').click()
    const savesAtTop = await page.evaluate(() => window.__server.calls.save.length)
    await page.keyboard.press('Control+s')
    await page.waitForFunction((n) => ! window.sheet().saving && window.__server.calls.save.length === n + 1, savesAtTop)
    await page.waitForTimeout(80)
    s = await state()
    const errorOutOfView = ! (await rendered(100))
    await scrollToRow(100, 'bottom')
    const errorCell = await page.evaluate(() => { const el = window.sheet().grid.table.getRow('100').getCell('sku').getElement(); return { error: el.classList.contains('ps-sheet-cell-error'), title: el.getAttribute('title'), dirty: el.classList.contains('ps-sheet-cell-dirty') } })
    check('an error the save answers for a row out of the window is on its cell when the row scrolls in', errorOutOfView && s.errorCount === 1 && errorCell.error && errorCell.dirty && errorCell.title === 'The SKU has already been taken.', JSON.stringify({ errorOutOfView, errors: s.errorCount, errorCell }))
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(80)
    const afterDiscard = await page.evaluate(() => { const el = window.sheet().grid.table.getRow('100').getCell('sku').getElement(); return { dirty: window.sheet().dirty.total, text: el.innerText, cls: el.className } })
    check('Discard clears the marks of a row at the far end too', afterDiscard.dirty === 0 && afterDiscard.text === 'SKU-100' && ! /ps-sheet-cell-(dirty|error)/.test(afterDiscard.cls), JSON.stringify(afterDiscard))

    // a range from the first row to the last (Shift+click after scrolling), filled down, undone
    await scrollToRow(1, 'top')
    await cell(0, 'stock').click()
    await scrollToRow(100, 'bottom')
    await (await cellOf(100, 'stock')).click({ modifiers: ['Shift'] })
    await page.waitForTimeout(50)
    const range = await page.evaluate(() => { const sel = window.sheet().grid.selection(); return { rows: sel.rows.length, top: sel.top, bottom: sel.bottom, cols: sel.cols } })
    check('a range spans rows that are not in the DOM', range.rows === 100 && range.top === 0 && range.bottom === 99 && range.cols.join() === 'stock', JSON.stringify(range))
    await page.keyboard.press('Control+d')
    await page.waitForTimeout(100)
    s = await state()
    const filledFar = await page.evaluate(() => { const sh = window.sheet(); const first = sh.rows[0].values.stock; return { first, expected: sh.rows.filter((r) => ! r.readOnly && r.values.stock !== first).length, v57: sh.grid.value('57', 'stock'), v100: sh.grid.value('100', 'stock'), readOnly40: sh.buffer.changes['40'] ?? null, was57: sh.rows[56].values.stock } })
    await scrollToRow(57)
    const filledCell = await page.evaluate(() => { const el = window.sheet().grid.table.getRow('57').getCell('stock').getElement(); return { text: el.innerText, dirty: el.classList.contains('ps-sheet-cell-dirty') } })
    check('Ctrl+D fills every row of the range, the ones out of the window included, and skips a read-only row', s.dirty.rows === filledFar.expected && filledFar.expected > 80 && filledFar.v57 === filledFar.first && filledFar.v100 === filledFar.first && filledFar.readOnly40 === null && filledCell.text === String(filledFar.first) && filledCell.dirty, JSON.stringify({ dirty: s.dirty, filledFar, filledCell }))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(100)
    s = await state()
    const unfilled = await page.evaluate(() => { const el = window.sheet().grid.table.getRow('57').getCell('stock').getElement(); return { text: el.innerText, dirty: el.classList.contains('ps-sheet-cell-dirty'), v100: window.sheet().grid.value('100', 'stock'), was100: window.sheet().rows[99].values.stock } })
    check('one undo takes the fill back on every row', s.dirty.total === 0 && unfilled.text === String(filledFar.was57) && ! unfilled.dirty && unfilled.v100 === unfilled.was100, JSON.stringify({ dirty: s.dirty, unfilled }))

    // a paste over a hundred rows from the first one
    await scrollToRow(1, 'top')
    await cell(0, 'name').click()
    await pasteText(Array.from({ length: 100 }, (_, i) => `Bulk ${i + 1}`).join('\n') + '\n')
    await page.waitForTimeout(150)
    s = await state()
    const bulk = await page.evaluate(() => { const sh = window.sheet(); return { c1: sh.buffer.changes['1']?.name, c100: sh.buffer.changes['100']?.name, readOnly80: sh.buffer.changes['80'] ?? null, undo: sh.buffer.undo.length } })
    await scrollToRow(90)
    const bulkCell = await page.evaluate(() => { const el = window.sheet().grid.table.getRow('90').getCell('name').getElement(); return { text: el.innerText, dirty: el.classList.contains('ps-sheet-cell-dirty') } })
    check('a paste over a hundred rows lands on the rows out of the window too', s.dirty.rows === 98 && s.dirty.created === 0 && bulk.c1 === 'Bulk 1' && bulk.c100 === 'Bulk 100' && bulk.readOnly80 === null && bulk.undo === 1 && bulkCell.text === 'Bulk 90' && bulkCell.dirty, JSON.stringify({ dirty: s.dirty, bulk, bulkCell }))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(100)

    // typing while the active cell is scrolled out of the window brings it back and edits it
    await scrollToRow(1, 'top')
    await cell(0, 'name').click()
    await page.evaluate(() => { const h = document.querySelector('.ps-sheet .tabulator-tableholder'); h.scrollTop = h.scrollHeight })
    await page.waitForTimeout(150)
    const activeGone = ! (await rendered(1))
    await page.keyboard.type('Far')
    await page.waitForTimeout(50)
    s = await state()
    const farEditor = { editing: s.editing, value: await page.locator('.tabulator-editing input').inputValue().catch(() => null), rendered: await rendered(1) }
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    check('typing with the active cell scrolled out of the window scrolls it back and edits it', activeGone && farEditor.editing && farEditor.value === 'Far' && farEditor.rendered && (await page.evaluate(() => window.sheet().buffer.changes['1']?.name)) === 'Far', JSON.stringify({ activeGone, farEditor }))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(50)

    // Add row from the top of a long page: the new row is brought into view
    await scrollToRow(1, 'top')
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(120)
    const added = await page.evaluate(() => { const row = document.querySelector('.tabulator-row.ps-sheet-row-created'); const h = document.querySelector('.ps-sheet .tabulator-tableholder').getBoundingClientRect(); const r = row?.getBoundingClientRect(); return { there: !! row, inView: !! r && r.top >= h.top - 1 && r.bottom <= h.bottom + 1, focus: !! document.activeElement?.closest('.ps-sheet-grid'), row: r ? [Math.round(r.top), Math.round(r.bottom)] : null, holder: [Math.round(h.top), Math.round(h.bottom)] } })
    check('Add row at the top of a long page scrolls the new row into view and leaves the keyboard on the grid', added.there && added.inView && added.focus, JSON.stringify(added))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(80)
    check('the sheet is clean after the row-window cases', (await state()).dirty.total === 0)

    // getSpreadsheetHeight() null (the default): the stylesheet's height, the window minus the top bar and the toolbar
    await fresh('?autoheight')
    m = await measure()
    console.log(`     default height: grid ${m.grid}px (variable resolves to ${m.configured}px), ${m.rowEls} row elements of ${m.loaded} rows, holder ${m.client}/${m.scroll}px, document ${m.doc}px`)
    check('without a configured height the grid takes the stylesheet\'s (the window minus the top bar and the toolbar) and still windows its rows', m.variable === '' && m.configured === m.window - 15 * 16 && Math.abs(m.grid - m.configured - m.borders) < 1 && m.rowEls < m.loaded && m.scroll > m.client && m.doc <= m.window, JSON.stringify(m))

    /* ---------------------------------------------------------------- a page answer landing while an editor is open */

    const slowRows = (ms) => page.evaluate((delay) => { const orig = window.__wire.spreadsheetRows; window.__wire.spreadsheetRows = (req) => new Promise((ok) => setTimeout(() => ok(orig(req)), delay)) }, ms)
    const landed = () => page.evaluate(() => {
        const sh = window.sheet()
        const rows = [...document.querySelectorAll('.tabulator-tableholder .tabulator-row')]
        const shown = sh.rows.some((r) => r.id === '4') ? sh.grid.table.getRow('4').getCell('name').getElement() : null

        return { page: sh.page, total: sh.total, firstId: sh.rows[0]?.id, skus: rows.slice(0, 2).map((r) => r.querySelector('[tabulator-field="sku"]')?.innerText), cells: rows[0]?.querySelectorAll('.tabulator-cell').length, gridRows: sh.grid.table.getRows().length, editing: sh.grid.isEditing(), editingFlag: sh.editing, loading: sh.loading, change: sh.buffer.changes['4']?.name ?? null, changePage: sh.buffer.pages['4'] ?? null, dirty: sh.dirty.total, search: sh.search, sort: sh.sort.column, row4: shown ? { text: shown.innerText, dirty: shown.classList.contains('ps-sheet-cell-dirty') } : null }
    })
    const openEditor = async () => { await cell(3, 'name').click(); await page.keyboard.type('Abc') }
    let errorsSeen = 0
    const clean = () => errors.length === errorsSeen

    await fresh()
    await slowRows(250)
    errorsSeen = errors.length
    await openEditor()
    await page.evaluate(() => window.sheet().setPage(2))
    await page.waitForTimeout(600)
    let l = await landed()
    check('a page answer landing on an open editor (setPage): no error, the new page shown, the typed text kept as an unsaved cell of the page it was on', clean() && l.page === 2 && l.skus[0] === 'SKU-101' && l.gridRows === 100 && l.cells === 11 && ! l.editing && ! l.loading && l.change === 'Abc' && l.changePage === 1 && l.dirty === 1, JSON.stringify({ l, errors: errors.slice(errorsSeen) }))

    await fresh()
    await slowRows(250)
    errorsSeen = errors.length
    await page.locator('.ps-sheet-search input').click()
    await page.keyboard.type('SKU-1')
    await openEditor()
    await page.waitForTimeout(1100)
    l = await landed()
    check('the same for a debounced search answered while a cell is being typed in', clean() && l.search === 'SKU-1' && l.total === 100 && l.skus[0] === 'SKU-100' && l.cells === 11 && ! l.editing && ! l.loading && l.change === 'Abc' && l.dirty === 1, JSON.stringify({ l, errors: errors.slice(errorsSeen) }))

    await fresh()
    await slowRows(600)
    errorsSeen = errors.length
    await page.locator('.tabulator-header .tabulator-col[tabulator-field="name"]').click()
    await openEditor()
    const sortEditing = (await state()).editing
    await page.waitForTimeout(1000)
    l = await landed()
    check('the same for a sort answered while a cell is being typed in', clean() && sortEditing && l.sort === 'name' && l.skus.join() === 'SKU-001,SKU-010' && l.cells === 11 && ! l.editing && ! l.loading && l.change === 'Abc' && l.dirty === 1, JSON.stringify({ sortEditing, l, errors: errors.slice(errorsSeen) }))

    await fresh()
    await slowRows(250)
    errorsSeen = errors.length
    await openEditor()
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('packstub-spreadsheet-refresh')))
    await page.waitForTimeout(600)
    l = await landed()
    check('the same for a packstub-spreadsheet-refresh event: the page is re-read, the typed cell stays dirty on it', clean() && l.page === 1 && l.skus[0] === 'SKU-001' && l.gridRows === 100 && l.cells === 11 && ! l.editing && ! l.editingFlag && ! l.loading && l.change === 'Abc' && l.row4?.text === 'Abc' && l.row4?.dirty, JSON.stringify({ l, errors: errors.slice(errorsSeen) }))

    /* ---------------------------------------------------------------- a click outside the grid while an editor is open */

    await fresh()
    const focusNow = () => page.evaluate(() => { const a = document.activeElement; const sh = window.sheet(); return { tag: a?.tagName, type: a?.type ?? null, inSearch: !! a?.closest?.('.ps-sheet-search'), inGrid: !! a?.closest?.('.ps-sheet-grid'), holder: !! a?.classList?.contains('tabulator-tableholder'), search: sh.search, editing: sh.grid.isEditing(), dirty: sh.dirty.total, change1: sh.buffer.changes['1']?.name ?? null } })
    await cell(0, 'name').click()
    await page.keyboard.type('Typed')
    await page.locator('.ps-sheet-search input').click()
    await page.keyboard.type('abc')
    await page.waitForTimeout(60)
    let f = await focusNow()
    check('a click into the search box with an editor open lands there: the text is typed into the search, the cell edit is kept', f.inSearch && f.tag === 'INPUT' && f.search === 'abc' && (await page.locator('.ps-sheet-search input').inputValue()) === 'abc' && ! f.editing && f.change1 === 'Typed' && f.dirty === 1, JSON.stringify(f))
    await page.waitForFunction(() => window.sheet().total === 0 && ! window.sheet().loading)
    await page.locator('.ps-sheet-search input').fill('')
    await page.waitForFunction(() => window.sheet().total === 250 && ! window.sheet().loading)
    await page.waitForTimeout(80)
    await cell(1, 'name').click()
    await page.keyboard.press('F2')
    await page.waitForTimeout(40)
    await page.locator('.ps-sheet-per-page select').focus()
    await page.locator('h1').click()
    await page.waitForTimeout(60)
    f = await focusNow()
    check('a click on the page outside the sheet with an unchanged editor open does not hand the focus to the grid', ! f.inGrid && ! f.editing && f.dirty === 1, JSON.stringify(f))
    await cell(1, 'name').click()
    await page.keyboard.type('Two')
    await cell(4, 'price').click()
    await page.waitForTimeout(60)
    f = await focusNow()
    await page.keyboard.type('7')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    const inside = await page.evaluate(() => ({ two: window.sheet().buffer.changes['2']?.name, price: window.sheet().buffer.changes['5']?.price, holder: !! document.activeElement?.classList?.contains('tabulator-tableholder') }))
    check('a click on another cell with an editor open still commits it and keeps the keyboard in the grid', f.holder && ! f.editing && inside.two === 'Two' && inside.price === 7 && inside.holder, JSON.stringify({ f, inside }))
    await cell(2, 'name').click()
    await page.keyboard.type('Three')
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(120)
    f = await focusNow()
    check('a toolbar button clicked with an editor open commits it, acts, and hands the focus back to the grid', f.holder && ! f.editing && (await page.evaluate(() => window.sheet().buffer.changes['3']?.name)) === 'Three' && (await state()).dirty.created === 1, JSON.stringify(f))

    /* ---------------------------------------------------------------- a failed page, sort or page-size request */

    await fresh()
    const pager = () => page.evaluate(() => { const sh = window.sheet(); return { page: sh.page, perPage: sh.perPage, sort: sh.sort.column + ' ' + sh.sort.direction, text: document.querySelector('.ps-sheet-pager-text').innerText, select: document.querySelector('.ps-sheet-per-page select').value, arrows: [...document.querySelectorAll('.tabulator-header .ps-sheet-title')].map((e) => e.textContent).filter((x) => /[▲▼]/.test(x)).join(), sku: document.querySelector('.tabulator-tableholder .tabulator-row [tabulator-field="sku"]')?.innerText, number: document.querySelector('.tabulator-tableholder .tabulator-row .ps-sheet-rownum')?.innerText, rows: sh.rows.length, loading: sh.loading, hint: sh.hint, search: sh.search, waiting: sh.waitingCalls() } })
    const asBefore = (p) => p.page === 1 && p.perPage === 100 && p.sort === 'sku asc' && p.text === 'Page 1 of 3' && p.select === '100' && p.arrows === 'SKU ▲' && p.sku === 'SKU-001' && p.number === '1' && p.rows === 100 && ! p.loading && p.waiting === 0
    const offline = (p) => String(p.hint).includes('Could not reach the server')
    const nextButton = page.locator('.ps-sheet-pager button[aria-label="Next page"]')
    const nameHeader = page.locator('.tabulator-header .tabulator-col[tabulator-field="name"]')
    const sizeSelect = page.locator('.ps-sheet-per-page select')
    check('the pager, the sort arrow and the page size before any failure', asBefore(await pager()), JSON.stringify(await pager()))

    // rejected (Livewire 4)
    await page.evaluate(() => { window.__wire.__origRows = window.__wire.spreadsheetRows; window.__wire.spreadsheetRows = () => new Promise((_, reject) => setTimeout(() => reject(new Error('Failed to fetch')), 80)) })
    await nextButton.click()
    await page.waitForTimeout(40)
    const nextDuring = await pager()
    await page.waitForTimeout(250)
    let p = await pager()
    check('a rejected Next puts the pager back on the page shown', nextDuring.loading && nextDuring.number === '1' && asBefore(p) && offline(p), JSON.stringify({ nextDuring, p }))
    await page.evaluate(() => { window.sheet().hint = null })
    await nameHeader.click()
    await page.waitForTimeout(40)
    const sortDuring = await pager()
    await page.waitForTimeout(250)
    p = await pager()
    check('a rejected sort puts the arrow back on the column the rows are sorted by', sortDuring.arrows === 'Name ▲' && asBefore(p) && offline(p), JSON.stringify({ sortDuring, p }))
    await page.evaluate(() => { window.sheet().hint = null })
    await sizeSelect.selectOption('25')
    await page.waitForTimeout(40)
    const sizeDuring = await pager()
    await page.waitForTimeout(250)
    p = await pager()
    check('a rejected page-size change puts the select back on the size shown', sizeDuring.select === '25' && asBefore(p) && offline(p), JSON.stringify({ sizeDuring, p }))
    await page.locator('.ps-sheet-search input').fill('SKU-00')
    await page.waitForTimeout(700)
    p = await pager()
    check('a rejected search keeps the text as typed over the rows shown', p.search === 'SKU-00' && (await page.locator('.ps-sheet-search input').inputValue()) === 'SKU-00' && asBefore(p), JSON.stringify(p))
    await page.evaluate(() => { window.sheet().search = '' })

    // answered ok: false
    await page.evaluate(() => { window.__wire.spreadsheetRows = async () => ({ ok: false, message: 'Not now.' }) })
    await nextButton.click()
    await page.waitForTimeout(120)
    p = await pager()
    check('a page request answered with ok: false does the same and shows its message', asBefore(p) && p.hint === 'Not now.', JSON.stringify(p))
    await page.evaluate(() => window.sheet().sortBy('price'))
    await page.waitForTimeout(120)
    p = await pager()
    check('and so does a refused sort', asBefore(p) && p.hint === 'Not now.', JSON.stringify(p))

    // never settled, the failure reported by Livewire's commit hook (Livewire 3); an edit made meanwhile belongs to the page shown
    await page.evaluate(() => { window.__wire.spreadsheetRows = () => new Promise(() => {}); window.sheet().hint = null })
    await nextButton.click()
    await page.waitForTimeout(60)
    await cell(0, 'name').click()
    await page.keyboard.type('Meanwhile')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const meanwhile = await page.evaluate(() => { const sh = window.sheet(); return { loading: sh.loading, asked: sh.page, recorded: sh.buffer.pages['1'], pages: sh.dirty.pages } })
    await page.evaluate(() => window.Livewire.failCommit(['spreadsheetRows']))
    await page.waitForTimeout(80)
    p = await pager()
    check('a Next that never settles is put back by the failure Livewire reports; a cell edited meanwhile is recorded under the page shown', meanwhile.loading && meanwhile.asked === 2 && meanwhile.recorded === 1 && meanwhile.pages === 1 && asBefore(p) && offline(p), JSON.stringify({ meanwhile, p }))
    await page.evaluate(() => { window.sheet().hint = null })
    await nameHeader.click()
    await page.waitForTimeout(60)
    const stuckSort = await pager()
    await page.evaluate(() => window.Livewire.failCommit(['spreadsheetRows']))
    await page.waitForTimeout(80)
    p = await pager()
    check('the same for a sort that never settles', stuckSort.loading && stuckSort.arrows === 'Name ▲' && asBefore(p) && offline(p), JSON.stringify({ stuckSort, p }))
    await page.evaluate(() => { window.sheet().hint = null })
    await sizeSelect.selectOption('50')
    await page.waitForTimeout(60)
    const stuckSize = await pager()
    await page.evaluate(() => window.Livewire.failCommit(['spreadsheetRows']))
    await page.waitForTimeout(80)
    p = await pager()
    check('and for a page-size change that never settles', stuckSize.loading && stuckSize.select === '50' && asBefore(p) && offline(p), JSON.stringify({ stuckSize, p }))

    // the server is back: Next is the page after the one shown, not the one after the failed one
    await page.evaluate(() => { window.__wire.spreadsheetRows = window.__wire.__origRows })
    await nextButton.click()
    await page.waitForFunction(() => window.sheet().page === 2 && ! window.sheet().loading)
    await page.waitForTimeout(80)
    p = await pager()
    check('with the server back Next loads page 2', p.page === 2 && p.text === 'Page 2 of 3' && p.sku === 'SKU-101' && p.number === '101' && p.sort === 'sku asc' && p.perPage === 100, JSON.stringify(p))
    await nameHeader.click()
    await page.waitForFunction(() => window.sheet().sort.column === 'name' && ! window.sheet().loading)
    await sizeSelect.selectOption('25')
    await page.waitForFunction(() => window.sheet().rows.length === 25 && ! window.sheet().loading)
    await page.waitForTimeout(80)
    p = await pager()
    check('and a sort and a page size that are answered stick', p.sort === 'name asc' && p.arrows === 'Name ▲' && p.perPage === 25 && p.select === '25' && p.page === 1 && p.text === 'Page 1 of 10', JSON.stringify(p))

    /* ---------------------------------------------------------------- editing a cell whose row was updated while out of the window */

    await fresh()
    errorsSeen = errors.length
    const holderToEnd = async () => { await page.evaluate(() => { const h = document.querySelector('.ps-sheet .tabulator-tableholder'); h.scrollTop = h.scrollHeight }); await page.waitForTimeout(150) }
    const editorNow = async () => ({ editing: (await state()).editing, value: await page.locator('.tabulator-editing input').inputValue({ timeout: 500 }).catch(() => null), rendered: await rendered(3) })
    // the editor commits as its row is wheeled out of the window; the next keystrokes open it again
    await cell(2, 'name').click()
    await page.keyboard.type('One')
    await page.waitForTimeout(40)
    await page.mouse.wheel(0, 2500)
    await page.waitForTimeout(250)
    const wheeled = await page.evaluate(() => ({ rendered: !! window.sheet().grid.table.getRow('3').getElement()?.isConnected, editing: window.sheet().grid.isEditing(), change: window.sheet().buffer.changes['3']?.name ?? null }))
    await page.keyboard.type('More')
    await page.waitForTimeout(60)
    let ed = await editorNow()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    check('typing after the editor was wheeled out of the window (its row updated meanwhile) opens it again with the full text', clean() && ! wheeled.rendered && ! wheeled.editing && wheeled.change === 'One' && ed.editing && ed.value === 'More' && ed.rendered && (await page.evaluate(() => window.sheet().buffer.changes['3']?.name)) === 'More', JSON.stringify({ wheeled, ed, errors: errors.slice(errorsSeen) }))
    // an undo while the active cell's row is out of the window, then typing
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(40)
    await holderToEnd()
    const undoGone = ! (await rendered(3))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(60)
    await page.keyboard.type('Q')
    await page.waitForTimeout(60)
    ed = await editorNow()
    const undoActive = (await state()).active
    await page.keyboard.press('Escape')
    await page.waitForTimeout(40)
    check('typing after an undo that changed the active cell\'s row while it was scrolled away opens the editor with the typed text', clean() && undoGone && undoActive?.id === '3' && undoActive?.col === 'name' && ed.editing && ed.value === 'Q' && ed.rendered && (await page.evaluate(() => window.sheet().buffer.changes['3']?.name)) === 'One', JSON.stringify({ undoGone, undoActive, ed, errors: errors.slice(errorsSeen) }))
    await holderToEnd()
    const f2Gone = ! (await rendered(3))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(60)
    await page.keyboard.press('F2')
    await page.waitForTimeout(60)
    ed = await editorNow()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(40)
    check('F2 after such an undo opens the editor on the value the undo put back', clean() && f2Gone && ed.editing && ed.value === 'Product 3' && ed.rendered && (await state()).dirty.total === 0, JSON.stringify({ f2Gone, ed, errors: errors.slice(errorsSeen) }))

    /* ---------------------------------------------------------------- a sheet built while hidden, a window that changes size */

    const renders = () => page.evaluate(() => window.__renders ?? 0)
    const countRenders = () => page.evaluate(() => { window.__renders = 0; window.sheet().grid.table.on('renderComplete', () => { window.__renders++ }) })
    await page.goto(`http://127.0.0.1:${port}/?hidden`)
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100)
    await page.waitForTimeout(200)
    errorsSeen = errors.length
    await countRenders()
    const whileHidden = await page.evaluate(() => ({ rowEls: document.querySelectorAll('.ps-sheet .tabulator-tableholder .tabulator-row').length, grid: document.querySelector('.ps-sheet-grid').getBoundingClientRect().height }))
    await page.evaluate(() => { document.querySelector('#harness-wrap').style.display = '' })
    await page.waitForTimeout(400)
    m = await measure()
    const rendersShown = await renders()
    await page.waitForTimeout(600)
    const rendersLater = await renders()
    console.log(`     built hidden, then shown: grid ${m.grid}px, header ${m.header}px (visible case ${visibleHeader}px), ${m.rowEls} row elements of ${m.loaded} rows (${whileHidden.rowEls} while hidden), ${rendersShown} renders on show, ${rendersLater - rendersShown} in the 600 ms after`)
    check('a sheet built inside a hidden wrapper draws itself when it is shown: the header at its normal height, the rows of the window rendered', clean() && whileHidden.grid === 0 && m.header === visibleHeader && m.rowEls > 0 && m.rowEls < m.loaded && Math.abs(m.grid - m.configured - m.borders) < 1 && m.scroll > m.client, JSON.stringify({ whileHidden, m, visibleHeader, errors: errors.slice(errorsSeen) }))
    check('showing it redraws a few times and then stops: the fixed height does not make the grid redraw in a loop', rendersShown > 0 && rendersShown < 10 && rendersLater === rendersShown && (await measure()).rowEls === m.rowEls, JSON.stringify({ rendersShown, rendersLater }))
    await cell(0, 'name').click()
    await page.keyboard.type('Shown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    check('and it is edited as any other', clean() && (await page.evaluate(() => window.sheet().buffer.changes['1']?.name)) === 'Shown' && (await cellClasses(0, 'name')).includes('ps-sheet-cell-dirty'))

    // a visible sheet at rest does not redraw; a window grown much taller is filled, and an open editor survives a resize
    await page.setViewportSize({ width: 760, height: 420 })
    await fresh('?autoheight')
    errorsSeen = errors.length
    await countRenders()
    await page.waitForTimeout(600)
    const idleRenders = await renders()
    const small = await measure()
    await cell(1, 'name').click()
    const fillOf = () => page.evaluate(() => { const h = document.querySelector('.ps-sheet .tabulator-tableholder'); const rows = [...h.querySelectorAll('.tabulator-row')]; const box = h.getBoundingClientRect(); const last = rows.at(-1)?.getBoundingClientRect(); const lastCol = document.querySelector('.ps-sheet .tabulator-header .tabulator-col[tabulator-field="margin"]').getBoundingClientRect(); return { rowEls: rows.length, blank: last ? Math.max(0, Math.round(box.top + h.clientHeight - last.bottom)) : -1, holder: h.clientHeight, gap: Math.round(box.left + h.clientWidth - lastCol.right), active: window.sheet().grid.activeCell() } })
    await page.setViewportSize({ width: 1600, height: 2600 })
    await page.waitForTimeout(500)
    const grown = await measure()
    const grownFill = await fillOf()
    const rendersGrown = await renders()
    await page.waitForTimeout(600)
    const rendersGrownLater = await renders()
    console.log(`     window 760x420 -> 1600x2600: grid ${small.grid}px -> ${grown.grid}px, ${small.rowEls} -> ${grown.rowEls} row elements, ${grownFill.blank}px blank under the last row, ${rendersGrown - idleRenders} renders, ${rendersGrownLater - rendersGrown} in the 600 ms after`)
    check('a sheet at rest does not redraw itself', idleRenders === 0, `renders ${idleRenders}`)
    check('a window grown much taller leaves no blank area under the rows, the last column stretched to the edge, the selection kept', clean() && grown.grid > small.grid + 1500 && Math.abs(grown.grid - grown.configured - grown.borders) < 1 && grown.rowEls > small.rowEls && grownFill.blank === 0 && Math.abs(grownFill.gap) <= 1 && grownFill.active?.id === '2' && grownFill.active?.col === 'name' && rendersGrownLater === rendersGrown, JSON.stringify({ small, grown, grownFill, rendersGrown, rendersGrownLater, errors: errors.slice(errorsSeen) }))
    await page.keyboard.type('Keep')
    await page.waitForTimeout(40)
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.waitForTimeout(500)
    const resizedEditor = { editing: (await state()).editing, value: await page.locator('.tabulator-editing input').inputValue({ timeout: 500 }).catch(() => null) }
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    const shrunk = await measure()
    check('an open editor survives a window resize with its text, and commits afterwards', clean() && resizedEditor.editing && resizedEditor.value === 'Keep' && (await page.evaluate(() => window.sheet().buffer.changes['2']?.name)) === 'Keep' && Math.abs(shrunk.grid - shrunk.configured - shrunk.borders) < 1 && shrunk.doc <= shrunk.window, JSON.stringify({ resizedEditor, shrunk, errors: errors.slice(errorsSeen) }))

    /* ---------------------------------------------------------------- Ctrl+ArrowDown / Ctrl+ArrowUp bring the cell they jump to into view */

    await fresh()
    errorsSeen = errors.length
    const inView = (id, field = 'name') => page.evaluate(([i, f]) => {
        const h = document.querySelector('.ps-sheet .tabulator-tableholder')
        const row = window.sheet().grid.table.getRow(i)
        const el = row && row.getElement()?.isConnected ? row.getCell(f).getElement() : null
        if (! el) return { inside: false, cell: null }
        const box = h.getBoundingClientRect()
        const top = box.top + h.clientTop
        const r = el.getBoundingClientRect()

        return { inside: r.top >= top - 0.5 && r.bottom <= top + h.clientHeight + 0.5, cell: [Math.round(r.top), Math.round(r.bottom)], holder: [Math.round(top), Math.round(top + h.clientHeight)] }
    }, [String(id), field])
    await cell(0, 'name').click()
    await page.keyboard.press('Control+ArrowDown')
    await page.waitForTimeout(400)
    s = await state()
    let seen = await inView(100)
    check('Ctrl+ArrowDown jumps to the last row and the active cell is inside the visible window', clean() && s.active?.id === '100' && s.active?.col === 'name' && seen.inside, JSON.stringify({ active: s.active, seen }))
    await page.keyboard.type('End')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    check('and it is edited there', (await page.evaluate(() => window.sheet().buffer.changes['100']?.name)) === 'End')
    await page.keyboard.press('Control+ArrowUp')
    await page.waitForTimeout(400)
    s = await state()
    seen = await inView(1)
    check('Ctrl+ArrowUp jumps back to the first row, inside the visible window', clean() && s.active?.id === '1' && seen.inside, JSON.stringify({ active: s.active, seen }))
    await cell(4, 'name').click()
    await page.keyboard.press('Control+Shift+ArrowDown')
    await page.waitForTimeout(400)
    let sel = await page.evaluate(() => { const x = window.sheet().grid.selection(); return { rows: x.rows.length, first: x.rows[0], last: x.rows.at(-1) } })
    seen = await inView(100)
    check('Ctrl+Shift+ArrowDown extends the range to the last row and shows its end', clean() && sel.rows === 96 && sel.first === '5' && sel.last === '100' && seen.inside, JSON.stringify({ sel, seen }))
    await page.keyboard.press('Control+Shift+ArrowUp')
    await page.waitForTimeout(400)
    sel = await page.evaluate(() => { const x = window.sheet().grid.selection(); return { rows: x.rows.length, first: x.rows[0], last: x.rows.at(-1) } })
    seen = await inView(1)
    check('Ctrl+Shift+ArrowUp extends it to the first row and shows that end', clean() && sel.rows === 5 && sel.first === '1' && sel.last === '5' && seen.inside, JSON.stringify({ sel, seen }))
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(60)
    // Alt held as well: Tabulator's keybinding does not look at it and jumps, so the cell is brought into view all the same
    await fresh()
    errorsSeen = errors.length
    await cell(0, 'name').click()
    await page.keyboard.press('Control+Alt+ArrowDown')
    await page.waitForTimeout(400)
    s = await state()
    seen = await inView(100)
    check('Ctrl+Alt+ArrowDown jumps to the last row too, inside the visible window', clean() && s.active?.id === '100' && s.active?.col === 'name' && seen.inside, JSON.stringify({ active: s.active, seen }))
    await page.keyboard.press('Control+Alt+ArrowUp')
    await page.waitForTimeout(400)
    s = await state()
    seen = await inView(1)
    check('and Ctrl+Alt+ArrowUp back to the first one', clean() && s.active?.id === '1' && seen.inside, JSON.stringify({ active: s.active, seen }))
    // in an open editor the arrows are the text field's: Alt+ArrowLeft moves the caret (a word back on macOS), a jump key leaves the editor, the active cell and the scroll alone
    await cell(2, 'name').click()
    await page.keyboard.type('hello big world')
    const caret = () => page.evaluate(() => { const i = document.querySelector('.tabulator-editing input'); const h = document.querySelector('.ps-sheet .tabulator-tableholder'); const sh = window.sheet(); return { open: sh.grid.isEditing(), value: i?.value ?? null, at: i?.selectionStart ?? null, active: sh.grid.activeCell(), scrollTop: h.scrollTop } })
    const caretBefore = await caret()
    await page.keyboard.press('Alt+ArrowLeft')
    await page.keyboard.type('X')
    await page.waitForTimeout(60)
    const caretAlt = await caret()
    await page.keyboard.press('Control+Alt+ArrowDown')
    await page.waitForTimeout(300)
    const caretJump = await caret()
    // elsewhere than on macOS Alt+ArrowLeft is not a caret key: the X lands at the end, the editor stays open all the same
    const typedAt = process.platform === 'darwin' ? 'hello big Xworld' : caretAlt.value
    check('in an open editor Alt+ArrowLeft moves the caret, and Ctrl+Alt+ArrowDown leaves the editor, its text, the active cell and the scroll as they were', clean() && caretBefore.open && caretBefore.at === 15 && caretAlt.open && caretAlt.value === typedAt && caretJump.open && caretJump.value === caretAlt.value && caretJump.active?.id === '3' && caretJump.active?.col === 'name' && caretJump.scrollTop === caretBefore.scrollTop, JSON.stringify({ caretBefore, caretAlt, caretJump }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(60)

    /* ---------------------------------------------------------------- the editing state after a click outside the grid */

    await fresh()
    const outsideState = () => page.evaluate(() => { const a = document.activeElement; const sh = window.sheet(); return { flag: sh.editing, editing: sh.grid.isEditing(), dirty: sh.dirty.total, inSearch: !! a?.closest?.('.ps-sheet-search'), saveDisabled: document.querySelector('.ps-sheet-btn-primary').disabled, popup: !! document.querySelector('.tabulator-popup-container') } })
    await cell(0, 'available_on').dblclick()
    await page.waitForTimeout(60)
    const dateOpen = await outsideState()
    await page.locator('.ps-sheet-search input').click()
    await page.waitForTimeout(80)
    let o = await outsideState()
    check('an unchanged date editor closed by a click into the search box is reported closed: Save is disabled again, the focus in the search box', dateOpen.flag && dateOpen.editing && ! dateOpen.saveDisabled && ! o.flag && ! o.editing && o.dirty === 0 && o.saveDisabled && o.inSearch, JSON.stringify({ dateOpen, o }))
    await cell(0, 'published_at').dblclick()
    await page.waitForTimeout(60)
    const dateTimeOpen = await outsideState()
    await page.locator('h1').click()
    await page.waitForTimeout(80)
    o = await outsideState()
    check('the same for a date-time editor and a click on the page', dateTimeOpen.flag && ! o.flag && ! o.editing && o.dirty === 0 && o.saveDisabled, JSON.stringify({ dateTimeOpen, o }))
    await cell(0, 'name').click()
    await page.keyboard.press('F2')
    await page.waitForTimeout(60)
    const textOpen = await outsideState()
    await page.locator('.ps-sheet-search input').click()
    await page.waitForTimeout(80)
    o = await outsideState()
    check('the same for an unchanged text editor', textOpen.flag && ! o.flag && ! o.editing && o.dirty === 0 && o.saveDisabled && o.inSearch, JSON.stringify({ textOpen, o }))
    await cell(0, 'category_id').dblclick()
    await page.waitForSelector('.tabulator-edit-list')
    await page.waitForTimeout(60)
    const selectOpen = await outsideState()
    await page.locator('.ps-sheet-search input').click()
    await page.waitForTimeout(80)
    o = await outsideState()
    check('and for a select editor with its list open: the list closed, the focus in the search box', selectOpen.flag && selectOpen.popup && ! o.flag && ! o.editing && ! o.popup && o.dirty === 0 && o.saveDisabled && o.inSearch, JSON.stringify({ selectOpen, o }))
    await cell(0, 'name').click()
    await page.keyboard.type('Changed')
    await page.locator('.ps-sheet-search input').click()
    await page.waitForTimeout(80)
    o = await outsideState()
    check('a changed editor closed the same way leaves its cell unsaved and Save enabled', ! o.flag && ! o.editing && o.dirty === 1 && ! o.saveDisabled && o.inSearch, JSON.stringify(o))

    /* ---------------------------------------------------------------- where a page opens: other rows at the top, the same rows where they were */

    await fresh()
    // The scroll position is the row at the top of the window and how much of it is cut off: scrollTop itself moves with
    // the heights Tabulator estimates for the rows it has not rendered.
    const samePlace = (a, b) => a.scrollTop > 1000 && b.scrollTop > 1000 && a.number === b.number && a.sku === b.sku && Math.abs(a.offset - b.offset) <= 1
    const firstVisible = () => page.evaluate(() => { const h = document.querySelector('.ps-sheet .tabulator-tableholder'); const top = h.getBoundingClientRect().top + h.clientTop; const row = [...h.querySelectorAll('.tabulator-row')].find((r) => r.getBoundingClientRect().bottom > top + 1); return { number: row?.querySelector('.ps-sheet-rownum')?.innerText ?? null, sku: row?.querySelector('[tabulator-field="sku"]')?.innerText ?? null, offset: row ? Math.round(row.getBoundingClientRect().top - top) : null, scrollTop: Math.round(h.scrollTop) } })
    const settled = async () => { await page.waitForFunction(() => ! window.sheet().loading); await page.waitForTimeout(200) }
    // Tabulator lays its range overlay out 200 ms after a scroll or a click that scrolled, and the holder can move a little then: a position is read once that is over.
    const atRest = () => page.waitForTimeout(450)
    await holderToEnd()
    let before5 = await firstVisible()
    await page.locator('.ps-sheet-pager button[aria-label="Next page"]').click()
    await page.waitForFunction(() => window.sheet().page === 2)
    await settled()
    let v = await firstVisible()
    check('Next from the end of a page opens the next one at its first row', before5.scrollTop > 1000 && v.number === '101' && v.sku === 'SKU-101' && v.scrollTop === 0, JSON.stringify({ before5, v }))
    await holderToEnd()
    await page.locator('.tabulator-header .tabulator-col[tabulator-field="name"]').click()
    await page.waitForFunction(() => window.sheet().sort.column === 'name')
    await settled()
    v = await firstVisible()
    check('a sort from a scrolled grid opens at the top', v.number === '1' && v.scrollTop === 0 && (await page.evaluate(() => window.sheet().page)) === 1, JSON.stringify(v))
    await holderToEnd()
    await page.locator('.ps-sheet-search input').fill('SKU-1')
    await page.waitForFunction(() => window.sheet().total === 100)
    await settled()
    v = await firstVisible()
    check('a search result opens at the top although page, page size and sort are the same', v.number === '1' && v.scrollTop === 0, JSON.stringify(v))
    await holderToEnd()
    await page.locator('.ps-sheet-filter select').first().selectOption('1')
    await page.waitForFunction(() => window.sheet().total < 100)
    await settled()
    v = await firstVisible()
    check('and so does a filter result', v.number === '1' && v.scrollTop === 0, JSON.stringify({ v, total: await page.evaluate(() => window.sheet().total) }))
    await page.locator('.ps-sheet-filter select').first().selectOption('')
    await page.locator('.ps-sheet-search input').fill('')
    await page.waitForFunction(() => window.sheet().total === 250)
    await settled()
    await holderToEnd()
    await page.locator('.ps-sheet-per-page select').selectOption('200')
    await page.waitForFunction(() => window.sheet().rows.length === 200)
    await settled()
    v = await firstVisible()
    check('and another page size', v.number === '1' && v.scrollTop === 0, JSON.stringify(v))

    // the same rows read again stay where they are scrolled to (read in the middle of the page: at its very end the
    // holder's own clamp moves the rows by a few pixels as the estimated heights settle)
    await page.evaluate(() => { document.querySelector('.ps-sheet .tabulator-tableholder').scrollTop = 2500 })
    await atRest()
    before5 = await firstVisible()
    const rowsCallsBefore = await page.evaluate(() => window.__server.calls.rows.length)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('packstub-spreadsheet-refresh')))
    await page.waitForFunction((n) => window.__server.calls.rows.length === n + 1, rowsCallsBefore)
    await settled()
    v = await firstVisible()
    check('a packstub-spreadsheet-refresh keeps the scroll position', samePlace(before5, v), JSON.stringify({ before5, v }))
    const midId = await page.evaluate((n) => window.sheet().rows.slice(n + 2, n + 8).find((r) => ! r.readOnly).id, Number(v.number))
    await (await cellOf(midId, 'stock')).click()
    await page.keyboard.type('77')
    await page.keyboard.press('Enter')
    await atRest()
    before5 = await firstVisible()
    const savesBefore5 = await page.evaluate(() => window.__server.calls.save.length)
    await page.keyboard.press('Control+s')
    await page.waitForFunction((n) => ! window.sheet().saving && window.__server.calls.save.length === n + 1, savesBefore5)
    await settled()
    v = await firstVisible()
    check('a save while scrolled down keeps the scroll position', (await state()).dirty.total === 0 && samePlace(before5, v), JSON.stringify({ before5, v }))
    // the page asked for again after a save that found a request in flight: the same page, the scroll kept
    await (await cellOf(midId, 'stock')).click()
    await page.keyboard.type('78')
    await page.keyboard.press('Enter')
    await atRest()
    before5 = await firstVisible()
    await slowRows(300)
    const reread = await page.evaluate(async () => { const sh = window.sheet(); const n = window.__server.calls.rows.length; sh.refresh(); await new Promise((r) => setTimeout(r, 20)); await sh.save(); await new Promise((r) => setTimeout(r, 900)); return { calls: window.__server.calls.rows.length - n, loading: sh.loading, dirty: sh.dirty.total } })
    v = await firstVisible()
    check('the re-read after a save that found a page request in flight keeps it too', reread.calls === 2 && ! reread.loading && reread.dirty === 0 && samePlace(before5, v), JSON.stringify({ reread, before5, v }))
    await (await cellOf(midId, 'stock')).click()
    await page.keyboard.type('5')
    await page.keyboard.press('Enter')
    await atRest()
    before5 = await firstVisible()
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(200)
    v = await firstVisible()
    check('Discard keeps the scroll position', (await state()).dirty.total === 0 && samePlace(before5, v), JSON.stringify({ before5, v }))

    /* ---------------------------------------------------------------- the same rows read again keep the active cell and the range */

    // replaceData makes Tabulator put the range on the first cell of the page: with the scroll kept, the next
    // keystroke would be written into a row that is not on screen.
    const selectionOf = () => page.evaluate(() => { const x = window.sheet().grid.selection(); return x && { rows: x.rows.join(), cols: x.cols.join(), ranges: window.sheet().grid.table.getRanges().length } })
    const changesOf = () => page.evaluate(() => JSON.stringify(window.sheet().buffer.changes))
    const refreshEvent = async () => {
        const n = await page.evaluate(() => window.__server.calls.rows.length)
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('packstub-spreadsheet-refresh')))
        await page.waitForFunction((k) => window.__server.calls.rows.length === k + 1, n)
    }
    // The text is typed, the place read once the grid is at rest, then Enter commits (Enter moves the active cell down, and Tabulator may scroll a row for that).
    const typeInto = async (text) => { await page.keyboard.type(text); await atRest(); const place = await firstVisible(); await page.keyboard.press('Enter'); await page.waitForTimeout(60); return place }
    const at70 = async () => {
        await fresh()
        errorsSeen = errors.length
        await scrollToRow(70)
        await atRest()
    }

    // (a) Discard
    await at70()
    await (await cellOf(69, 'name')).click()
    await page.keyboard.type('Dirty')
    await page.keyboard.press('Enter')
    await atRest()
    before5 = await firstVisible()
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(20)
    let a = (await state()).active
    v = await typeInto('Soon')
    check('Discard keeps the active cell: a key typed 20 ms later goes into that row, the first visible row unchanged', clean() && a?.id === '70' && a?.col === 'name' && (await changesOf()) === '{"70":{"name":"Soon"}}' && samePlace(before5, v), JSON.stringify({ a, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))
    await atRest()
    before5 = await firstVisible()
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(700)
    a = (await state()).active
    v = await typeInto('Later')
    check('and one typed 700 ms later', clean() && a?.id === '71' && a?.col === 'name' && (await changesOf()) === '{"71":{"name":"Later"}}' && samePlace(before5, v), JSON.stringify({ a, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))

    // (b) the refresh event
    for (const wait of [20, 700]) {
        await at70()
        await (await cellOf(70, 'name')).click()
        await atRest()
        before5 = await firstVisible()
        await refreshEvent()
        await page.waitForTimeout(wait)
        a = (await state()).active
        v = await typeInto('Hello')
        check(`a packstub-spreadsheet-refresh keeps the active cell: a key typed ${wait} ms later goes into that row, the first visible row unchanged`, clean() && a?.id === '70' && a?.col === 'name' && (await changesOf()) === '{"70":{"name":"Hello"}}' && samePlace(before5, v), JSON.stringify({ a, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))
    }

    // a range of several cells
    await at70()
    await (await cellOf(70, 'name')).click()
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await atRest()
    before5 = await firstVisible()
    const rangeBefore = await selectionOf()
    await refreshEvent()
    await settled()
    let rangeAfter = await selectionOf()
    v = await firstVisible()
    check('a range of several cells is kept over a refresh', clean() && rangeBefore.rows === '70,71' && rangeBefore.cols === 'name,category_id' && rangeAfter?.rows === '70,71' && rangeAfter?.cols === 'name,category_id' && samePlace(before5, v), JSON.stringify({ rangeBefore, rangeAfter, before5, v }))
    await (await cellOf(69, 'stock')).click()
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await (await cellOf(70, 'name')).click()
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(300)
    rangeAfter = await selectionOf()
    check('and over Discard', clean() && (await state()).dirty.total === 0 && rangeAfter?.rows === '70,71' && rangeAfter?.cols === 'name,category_id', JSON.stringify({ rangeAfter }))

    // Ctrl+click: the sheet keeps one range (selectableRange: 1), so the click moves it; the pointer-down is dispatched,
    // on macOS a real Ctrl+click is the context click
    await at70()
    await (await cellOf(70, 'name')).click()
    await page.evaluate(() => { const el = window.sheet().grid.table.getRow('66').getCell('price').getElement(); el.dispatchEvent(new MouseEvent('mousedown', { ctrlKey: true, button: 0, bubbles: true, cancelable: true })); el.dispatchEvent(new MouseEvent('mouseup', { ctrlKey: true, button: 0, bubbles: true, cancelable: true })) })
    await atRest()
    before5 = await firstVisible()
    const multiBefore = await selectionOf()
    await refreshEvent()
    await settled()
    const multiAfter = await selectionOf()
    v = await typeInto('12')
    check('a Ctrl+click moves the one range the sheet keeps, and a refresh after it does not throw: the range stays there and typing goes into it', clean() && multiBefore.ranges === 1 && multiBefore.rows === '66' && multiAfter?.ranges === 1 && multiAfter?.rows === '66' && multiAfter?.cols === 'price' && (await changesOf()) === '{"66":{"price":12}}' && samePlace(before5, v), JSON.stringify({ multiBefore, multiAfter, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))

    // the active row deleted on the server: the range goes to the row now at its place
    await at70()
    await (await cellOf(70, 'name')).click()
    await atRest()
    before5 = await firstVisible()
    const place = await page.evaluate(() => { window.__server.save({ deleted: ['70'] }); return window.sheet().grid.ids().indexOf('70') })
    await refreshEvent()
    await settled()
    const moved70 = await page.evaluate((i) => { const g = window.sheet().grid; return { active: g.activeCell(), there: g.ids()[i], has70: g.ids().includes('70') } }, place)
    v = await typeInto('Next')
    check('the active row deleted on the server and a refresh: the active cell is on the row now at that place', clean() && place === 69 && ! moved70.has70 && moved70.there === '71' && moved70.active?.id === '71' && moved70.active?.col === 'name' && (await changesOf()) === '{"71":{"name":"Next"}}' && samePlace(before5, v), JSON.stringify({ place, moved70, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))

    // nothing left on the server: no row to put the range on
    await at70()
    await (await cellOf(70, 'name')).click()
    await page.evaluate(() => { window.__server.products.length = 0 })
    await refreshEvent()
    await settled()
    await page.keyboard.type('x')
    await page.waitForTimeout(100)
    const emptied = await page.evaluate(() => { const sh = window.sheet(); return { rows: sh.grid.ids().length, total: sh.total, active: sh.grid.activeCell(), editing: sh.grid.isEditing(), dirty: sh.dirty.total } })
    check('an empty answer with a cell selected does not throw', clean() && emptied.rows === 0 && emptied.total === 0 && emptied.active === null && ! emptied.editing && emptied.dirty === 0, JSON.stringify({ emptied, errors: errors.slice(errorsSeen) }))

    // (c) the re-read after a save that found a page request in flight
    for (const wait of [20, 700]) {
        await at70()
        await (await cellOf(69, 'stock')).click()
        await page.keyboard.type('41')
        await page.keyboard.press('Enter')
        await atRest()
        before5 = await firstVisible()
        await slowRows(300)
        const landing = await page.evaluate(async () => {
            const sh = window.sheet()
            const n = window.__server.calls.rows.length
            sh.refresh()
            await new Promise((r) => setTimeout(r, 20))
            await sh.save()
            // until the re-read's rows are in the grid (the scroll is still being corrected then)
            while (sh.loading || window.__server.calls.rows.length < n + 2) await new Promise((r) => setTimeout(r, 5))

            return { calls: window.__server.calls.rows.length - n, dirty: sh.dirty.total }
        })
        await page.waitForTimeout(wait)
        a = (await state()).active
        v = await typeInto('9')
        check(`the re-read after a save with a page request in flight keeps the active cell: a key typed ${wait} ms later goes into that row, the first visible row unchanged`, clean() && landing.calls === 2 && landing.dirty === 0 && a?.id === '70' && a?.col === 'stock' && (await changesOf()) === '{"70":{"stock":9}}' && samePlace(before5, v), JSON.stringify({ landing, a, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))
    }

    /* ---------------------------------------------------------------- leaving with text in an open editor; removing the sheet with one */

    await fresh()
    const leave = async () => {
        const asked = dialogs
        const unload = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); document.dispatchEvent(new Event('livewire:navigate', { cancelable: true })); return e.defaultPrevented })

        return { unload, asked: dialogs - asked, dirty: await page.evaluate(() => window.sheet().dirty.total), editing: await page.evaluate(() => window.sheet().grid.isEditing()) }
    }
    const leaveClean = await leave()
    await cell(0, 'name').click()
    await page.keyboard.type('Not saved')
    await page.waitForTimeout(40)
    const leaveEditing = await leave()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(40)
    const leaveCancelled = await leave()
    check('the leave guard counts text in an open editor: beforeunload is prevented and Livewire\'s navigate asks, though nothing is buffered yet', ! leaveClean.unload && leaveClean.asked === 0 && leaveEditing.unload && leaveEditing.asked === 1 && leaveEditing.dirty === 0 && ! leaveCancelled.unload && leaveCancelled.asked === 0, JSON.stringify({ leaveClean, leaveEditing, leaveCancelled }))

    await cell(1, 'name').click()
    await page.keyboard.type('Going away')
    await page.waitForTimeout(40)
    const logsBefore = logged.length
    const removed = await page.evaluate(async () => {
        const calls = []
        const orig = document.removeEventListener
        document.removeEventListener = function (type, listener, options) { calls.push(type + ':' + String(options)); return orig.call(this, type, listener, options) }
        const hooks = window.Livewire.listeners.commit.length
        document.querySelector('.ps-sheet').remove()
        await new Promise((r) => setTimeout(r, 250))
        document.removeEventListener = orig

        return { mousedown: calls.includes('mousedown:true'), hooks, hooksAfter: window.Livewire.listeners.commit.length }
    })
    const noise = logged.slice(logsBefore).filter((x) => /Update Error|Unable to find row/.test(x))
    check('removing the sheet with an editor open takes its pointer listener and its hook away, and logs nothing', removed.mousedown && removed.hooks === 1 && removed.hooksAfter === 0 && noise.length === 0, JSON.stringify({ removed, noise }))

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
