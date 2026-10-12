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
 * range over a re-read of the same rows, the keys inside an open editor (a date
 * typed digit by digit, a date with a part cleared, PageUp / PageDown / Home /
 * End, ArrowUp / ArrowDown per editor type, a select's list opened by F2 and
 * the keys that must not filter it, Enter on a cell without an editor), digits
 * typed on a selected date cell, Ctrl+Enter (on a text cell, a computed cell,
 * the last row, in an open editor), the active cell after Add row and its undo
 * and save, characters whose codes are key codes, a character or F2 on a
 * boolean cell, Ctrl+Enter with add row on another key, Alt+ArrowLeft /
 * Alt+ArrowRight left to the browser, a keyboard-only pass, the leave guard,
 * read-only mode.
 * Screenshots land in SCREENSHOT_DIR (default: tests/browser/screenshots,
 * ignored by git).
 *
 *   node tests/browser/run.mjs
 */

import { createRequire } from 'node:module'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
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
// PLAYWRIGHT_CHROMIUM, or the build this playwright-core expects, or the newest headless shell in the cache (a
// sibling's playwright-core can be a version behind the browsers last downloaded).
const cache = join(homedir(), 'Library/Caches/ms-playwright')
const newestShell = () => {
    const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : []
    for (const d of dirs) for (const sub of readdirSync(join(cache, d))) { const exe = join(cache, d, sub, 'chrome-headless-shell'); if (existsSync(exe)) return exe }
    return undefined
}
const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync(chromium.executablePath()) ? undefined : newestShell())
const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
let dialogs = 0
let dismissDialogs = false
page.on('dialog', (d) => { dialogs++; if (dismissDialogs) d.dismiss(); else d.accept() })
const logged = []
page.on('console', (m) => logged.push(m.text()))

const state = () => page.evaluate(() => { const s = window.sheet(); return { dirty: s.dirty, page: s.page, lastPage: s.lastPage, total: s.total, rows: s.rows.length, canUndo: s.canUndo, canRedo: s.canRedo, errorCount: s.errorCount, selected: s.selected, active: s.grid.activeCell(), editing: s.grid.isEditing() } })
const cell = (rowIndex, field) => page.locator(`.tabulator-tableholder .tabulator-row`).nth(rowIndex).locator(`.tabulator-cell[tabulator-field="${field}"]`)
const cellClasses = async (rowIndex, field) => (await cell(rowIndex, field).getAttribute('class')) ?? ''
const server_ = (fn) => page.evaluate(fn)
// Discard and Delete rows ask in the sheet's <dialog>: the OK button answers.
const accept = async () => { await page.locator('.ps-sheet-dialog button[value="ok"]:visible').click(); await page.waitForTimeout(150) }
const discardAll = async () => { await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click(); await accept() }
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
    check('the notification says nothing was saved', (await page.locator('.ps-sheet-hint').innerText()).includes('Nothing was saved'), JSON.stringify(await page.evaluate(() => ({ hint: window.sheet().hint, status: window.sheet().status, text: document.querySelector('.ps-sheet-hint').textContent, html: document.querySelector('.ps-sheet-hint').outerHTML }))))
    // the count of marked cells is a button: the active cell goes to the next marked cell, the line under the grid says why (no pointer needed)
    const statusOf = () => page.evaluate(() => { const sh = window.sheet(); return { active: sh.grid.activeCell(), status: sh.status?.text ?? null, kind: sh.status?.kind ?? null, line: document.querySelector('.ps-sheet-hint').textContent, focus: !! document.activeElement?.closest('.ps-sheet-grid') } })
    await page.locator('.ps-sheet-pill-errors').click()
    await page.waitForTimeout(150)
    let st = await statusOf()
    const firstMarked = st.active
    check('the count of marked cells is a button: it moves the active cell to the first marked cell, which carries aria-invalid, and the status says why', st.active?.col === 'price' && st.status === 'Not a number.' && st.kind === 'error' && st.focus && (await cell(5, 'price').getAttribute('aria-invalid')) === 'true', JSON.stringify(st))
    await page.locator('.ps-sheet-pill-errors').click()
    await page.waitForTimeout(150)
    st = await statusOf()
    check('a second press goes to the next marked cell', st.active?.col === 'category_id' && st.active?.id !== firstMarked?.id && st.status === 'Not one of the options.', JSON.stringify(st))
    await page.locator('.ps-sheet-pill-errors').click()
    await page.waitForTimeout(150)
    st = await statusOf()
    await page.evaluate(() => { window.sheet().hint = null })
    await page.waitForTimeout(30)
    const shown = await statusOf()
    check('a third wraps around to the first, and once the notification has passed the line under the grid shows the cell\'s message', st.active?.id === firstMarked?.id && st.active?.col === 'price' && shown.line === 'Not a number.', JSON.stringify({ st, shown }))
    await cell(0, 'name').click()
    await page.waitForTimeout(80)
    const cleanCell = await statusOf()
    check('a clean cell empties the status line', cleanCell.status === null && cleanCell.line === '' && (await cell(0, 'name').getAttribute('aria-invalid')) === null, JSON.stringify(cleanCell))
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
    await page.evaluate(() => { const sh = window.sheet(); const flash = sh.flash; window.__flashes = []; sh.flash = (m) => { window.__flashes.push(m); flash.call(sh, m) } })
    await page.keyboard.press('Control+s')
    await page.waitForFunction(() => window.__server.calls.save.length === 3)
    await page.waitForTimeout(80)
    s = await state()
    check('a conflict keeps the cell, paints it purple and names their value', (await cellClasses(1, 'name')).includes('ps-sheet-cell-conflict') && (await cell(1, 'name').getAttribute('title')).includes('Their value: Renamed') && s.dirty.total === 1)
    const flashes = await page.evaluate(() => window.__flashes)
    check('a save refused by a conflict alone says so once, and that saving again keeps the value', flashes.length === 1 && flashes[0].includes('Save again to keep yours'), JSON.stringify(flashes))
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
    // the question is the sheet's own dialog: Escape keeps everything, OK discards
    const dirtyBeforeDiscard = (await state()).dirty.total
    await page.locator('.ps-sheet-btn', { hasText: 'Discard' }).click()
    await page.waitForTimeout(80)
    const asked = await page.evaluate(() => { const d = document.querySelector('.ps-sheet-dialog'); return { open: d.classList.contains('fi-modal-open'), text: d.querySelector('.ps-sheet-dialog-text').textContent, focus: document.activeElement?.value, native: 0 } })
    // where Filament puts a modal on a wide screen: centred, a quarter of the free height above it (grid rows 1fr auto 3fr); measured once its enter transition is over
    await page.waitForTimeout(400)
    const box = await page.evaluate(() => { const r = document.querySelector('.ps-sheet-dialog .fi-modal-window').getBoundingClientRect(); return { x: r.left + r.width / 2 - window.innerWidth / 2, y: r.top - (window.innerHeight - r.height) / 4, height: r.height } })
    check('the dialog sits where Filament puts a modal: centred, a quarter of the free height above it', Math.abs(box.x) < 4 && Math.abs(box.y) < 12 && box.height > 80, JSON.stringify(box))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(80)
    const kept = { open: await page.evaluate(() => document.querySelector('.ps-sheet-dialog').classList.contains('fi-modal-open')), dirty: (await state()).dirty.total, focus: await page.evaluate(() => !! document.activeElement?.closest('.ps-sheet-grid')) }
    check('Discard asks in the sheet\'s own dialog, the confirm button focused; Escape keeps every change and hands the keyboard back to the grid', asked.open && asked.text === 'Discard all unsaved changes?' && asked.focus === 'ok' && ! kept.open && kept.dirty === dirtyBeforeDiscard && dirtyBeforeDiscard > 0 && kept.focus, JSON.stringify({ asked, kept }))
    await discardAll()
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
    // rows by id (the DOM holds only the window's rows): a cell, a range of two, then the row's number again
    await scrollToRow('1', 'top')
    await (await cellOf('3', 'name')).click()
    await page.waitForTimeout(60)
    const oneCell = (await state()).selected
    await page.keyboard.press('Shift+ArrowDown')
    await page.waitForTimeout(60)
    const twoCells = (await state()).selected
    await (await page.evaluateHandle(() => window.sheet().grid.table.getRow('3').getCells()[0].getElement())).asElement().click()
    await page.waitForTimeout(60)
    check('a single active cell counts no row for deletion, a range of cells counts its rows', oneCell === 0 && twoCells === 2 && (await state()).selected === 1, JSON.stringify({ oneCell, twoCells, selected: (await state()).selected }))
    await page.locator('.ps-sheet-btn', { hasText: 'Delete rows' }).click()
    await accept()
    await page.waitForTimeout(50)
    s = await state()
    check('Delete rows marks the row (struck through) until Save', s.dirty.deleted === 1 && (await page.locator('.tabulator-row.ps-sheet-row-deleted').count()) === 1, JSON.stringify({ dirty: s.dirty, selected: s.selected, deletedRows: await page.locator('.tabulator-row.ps-sheet-row-deleted').count(), probe: await page.evaluate(() => { const sh = window.sheet(); const ids = Object.keys(sh.buffer.deleted); return ids.map((id) => { const row = sh.grid.table.getRow(id); return { id, inTable: !! row, connected: !! row?.getElement()?.isConnected, cls: row?.getElement()?.className, m: row?.getData()?._m?.deleted, inRows: sh.rows.some((r) => r.id === id), created: sh.buffer.createdOrder?.includes(id) } }) }) }))
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
    await discardAll()
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
    const deleteButton = page.locator('.ps-sheet-btn-danger', { hasText: 'Delete' })
    const offered = { selected: (await state()).selected, disabled: await deleteButton.isDisabled() }
    check('a selection on a row the policy keeps from deleting counts no row: Delete rows is disabled', offered.selected === 0 && offered.disabled, JSON.stringify(offered))

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
    // (a fresh page, row 1 by id: what came before may have left the grid scrolled, sorted or on another page)
    await fresh()
    await scrollToRow(1, 'top')
    await (await cellOf(1, 'name')).click()
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
        const row = () => sh.rows.find((r) => r.id === '1')
        const afterSave = { name: row().values.name, version: row().version, dirty: sh.dirty.total, loading: sh.loading }
        await new Promise((res) => setTimeout(res, 1000))
        window.__wire.spreadsheetRows = orig
        return { afterSave, afterRefresh: { name: row().values.name, version: row().version, loading: sh.loading, text: sh.grid.table.getRow('1').getCell('name').getElement().innerText, rowsCalls: window.__server.calls.rows.length - rowsCalls, server: window.__server.products.find((p) => p.id === '1').version } }
    })
    check('a save while a page request is in flight keeps the saved values and version', raceSave.afterSave.name === 'Zed2' && raceSave.afterSave.dirty === 0 && raceSave.afterRefresh.name === 'Zed2' && raceSave.afterRefresh.text === 'Zed2' && raceSave.afterRefresh.version === raceSave.afterRefresh.server && ! raceSave.afterRefresh.loading && raceSave.afterRefresh.rowsCalls === 2, JSON.stringify(raceSave))
    await (await cellOf(1, 'price')).click()
    await page.keyboard.type('9')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    const versionCarried = await page.evaluate(() => ({ buffer: window.sheet().buffer.versions['1'], server: window.__server.products.find((p) => p.id === '1').version }))
    check('the next edit on that row carries the current version, not a stale one', versionCarried.buffer === versionCarried.server, JSON.stringify(versionCarried))
    await discardAll()
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
    const priceBefore = await page.evaluate(() => document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="price"]').innerText)
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
    check('while a save is in flight typing, F2, Delete, Ctrl+Enter, Ctrl+D, Ctrl+Z, a paste, Add row, a deletion and an edit change nothing, and the sheet says so', during.focusInGrid && during.saving && during.cue && ! during.editing && during.dirty.total === 1 && during.dirty.cells === 1 && during.changes1.join() === 'name' && during.changes2 === null && during.created === 0 && during.undoDisabled && during.priceText === priceBefore, JSON.stringify({ ...during, priceBefore }))
    const afterHeld = await awaitSave(() => {
        const sh = window.sheet()
        const server = window.__server.products.find((p) => p.id === '1')

        return { saving: sh.saving, cue: document.querySelector('.ps-sheet').classList.contains('ps-sheet-is-saving'), dirty: sh.dirty.total, changes1: sh.buffer.changes['1'] ?? null, undo: sh.buffer.undo.length, canUndo: sh.canUndo, serverName: server.name, serverPrice: server.price, nameText: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="name"]').innerText, priceText: document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell[tabulator-field="price"]').innerText, version: sh.rows[0].version === server.version }
    })
    check('the answer lands cleanly: the held cell is saved, nothing from meanwhile is in the buffer or on the grid', ! afterHeld.saving && ! afterHeld.cue && afterHeld.dirty === 0 && afterHeld.changes1 === null && afterHeld.undo === 0 && ! afterHeld.canUndo && afterHeld.serverName === 'Held' && String(afterHeld.serverPrice) === String(parseFloat(priceBefore)) && afterHeld.nameText === 'Held' && afterHeld.priceText === priceBefore && afterHeld.version, JSON.stringify({ ...afterHeld, priceBefore }))
    await cell(0, 'price').click()
    await page.keyboard.type('5')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(50)
    s = await state()
    check('editing works again once the save is answered', s.dirty.total === 1 && s.dirty.cells === 1 && (await page.evaluate(() => window.sheet().buffer.changes['1']?.price)) === 5, JSON.stringify(s.dirty))
    await discardAll()
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
    await discardAll()
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
    const saveButton = page.locator('.ps-sheet-toolbar .ps-sheet-btn-primary')
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
    check('on load nothing counts as selected for deletion (the active cell is not a selection)', (await state()).selected === 0, `selected ${(await state()).selected}`)
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
    await discardAll()
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
    const fitsWindow = (x) => x.headerTop + x.grid <= x.window - 30 && x.headerTop + x.grid >= x.window - 100 // the footer under the grid: the status line and the pager
    console.log(`     measured height: grid ${m.grid}px (variable ${m.variable}), top ${m.headerTop}px in a ${m.window}px window, ${m.rowEls} row elements of ${m.loaded} rows, holder ${m.client}/${m.scroll}px, document ${m.doc}px`)
    check('without a configured height the grid is measured: the window below its top edge less a line for the status, and it still windows its rows', /px$/.test(m.variable) && Math.abs(m.grid - m.configured - m.borders) < 1 && fitsWindow(m) && m.rowEls < m.loaded && m.scroll > m.client && m.doc <= m.window, JSON.stringify(m))
    // the stylesheet arriving after the component started (x-load-css in a panel): the variable reads '' at first, then auto
    await page.goto(`http://127.0.0.1:${port}/?autoheight&latecss`)
    await page.waitForTimeout(120)
    const hiddenBefore = await page.evaluate(() => getComputedStyle(document.querySelector('.ps-sheet')).visibility)
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100)
    await page.waitForTimeout(700)
    const lateCss = await measure()
    const shownAfter = await page.evaluate(() => ({ visibility: getComputedStyle(document.querySelector('.ps-sheet')).visibility, inline: document.querySelector('.ps-sheet').style.visibility }))
    check('the sheet is invisible until its stylesheet is in, and shown once it is (no unstyled toolbar for an instant)', hiddenBefore === 'hidden' && shownAfter.visibility === 'visible' && shownAfter.inline === '', JSON.stringify({ hiddenBefore, shownAfter }))
    check('a stylesheet loaded after the component started still gets the measured height', /px$/.test(lateCss.variable) && fitsWindow(lateCss) && lateCss.rowEls < lateCss.loaded && lateCss.doc <= lateCss.window, JSON.stringify(lateCss))
    // The first page rendered as the grid is built (config.state, as the view sends it) with the stylesheet landing after
    // that (a slow first load of the script on a panel: x-load-css starts with it): the columns were measured on unstyled
    // cells, each as wide as the grid, the sheet collapsed to its pinned column. The stylesheet's event measures them again.
    await page.goto(`http://127.0.0.1:${port}/?inline&latecss=manual`)
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100 && document.querySelectorAll('.ps-sheet .tabulator-col').length > 5)
    await page.waitForTimeout(200)
    const colWidths = () => page.evaluate(() => ({ widths: [...document.querySelectorAll('.ps-sheet .tabulator-col')].map((c) => c.offsetWidth), holder: document.querySelector('.ps-sheet .tabulator-tableholder').clientWidth, forced: window.__forced ?? 0 }))
    const unstyled = await colWidths()
    await page.evaluate(() => { const table = window.sheet().grid.table; window.__forced = 0; const orig = Object.getPrototypeOf(table).redraw; table.redraw = function (force) { if (force) window.__forced++; return orig.call(this, force) }; window.__loadCss() })
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ps-sheet')).getPropertyValue('--ps-sheet-bg').trim() !== '')
    await page.waitForTimeout(400)
    const styled = await colWidths()
    check('the first page rendered before the stylesheet (every column as wide as the grid) is measured again once it applies', unstyled.widths.filter((w) => w >= unstyled.holder - 2).length > 3 && styled.forced >= 1 && styled.widths.every((w) => w < styled.holder / 2) && styled.widths.reduce((a, b) => a + b, 0) <= styled.holder + 2, JSON.stringify({ unstyled, styled }))
    // (The redraw spies call the prototype's method with the caller's `this`: bound to `window.sheet().grid.table`, Alpine's
    // reactive proxy, the redraw rebuilt the cells around proxied columns that no longer compare equal to the table's.)
    // The stylesheet landing after the forced reveal (3 s), the user scrolled to row 60 and typing in it: the re-measure
    // (a forced redraw scrolls to the top and rebuilds every row) waits for the editor, then brings row 60 and the range
    // back. Before the stylesheet the page scrolls, not the holder (it has no overflow yet): the row comes back into the
    // grid's window, not to a scroll offset.
    await page.goto(`http://127.0.0.1:${port}/?inline&latecss=manual`)
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100 && document.querySelector('.ps-sheet').style.visibility === '', null, { timeout: 8000 })
    await page.evaluate(async () => { const g = window.sheet().grid; await g.scrollTo('60', 'top'); g.select('60', 'sku') })
    await page.waitForTimeout(200)
    const row60InView = () => page.evaluate(() => { const h = document.querySelector('.ps-sheet .tabulator-tableholder').getBoundingClientRect(); const el = window.sheet().grid.table.getRow('60').getElement(); const r = el?.isConnected ? el.getBoundingClientRect() : null; return !! r && r.top >= h.top - 1 && r.bottom <= h.bottom + 1 })
    const lateActive = await page.evaluate(() => window.sheet().grid.activeCell())
    await page.evaluate(() => { const table = window.sheet().grid.table; window.__forced = 0; const orig = Object.getPrototypeOf(table).redraw; table.redraw = function (force) { if (force) window.__forced++; return orig.call(this, force) }; window.sheet().grid.edit('Z9'); window.__loadCss() })
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ps-sheet')).getPropertyValue('--ps-sheet-bg').trim() !== '')
    await page.waitForTimeout(400)
    const whileEditing = await page.evaluate(() => ({ editing: window.sheet().grid.isEditing(), text: document.querySelector('.tabulator-editing input')?.value ?? null, forced: window.__forced }))
    await page.evaluate(() => window.sheet().grid.focus())
    await page.waitForTimeout(700)
    const lateAfter = await page.evaluate(() => ({ value: window.sheet().grid.value('60', 'sku'), active: window.sheet().grid.activeCell(), forced: window.__forced, widths: [...document.querySelectorAll('.ps-sheet .tabulator-col')].map((c) => c.offsetWidth), holder: document.querySelector('.ps-sheet .tabulator-tableholder').clientWidth }))
    const lateInView = await row60InView()
    check('a stylesheet landing while the user types on row 60 waits for the editor, then re-measures with the row in view and the active cell kept', lateActive?.id === '60' && lateInView && whileEditing.editing && whileEditing.text === 'Z9' && whileEditing.forced === 0 && lateAfter.forced === 1 && lateAfter.value === 'Z9' && lateAfter.active?.id === '60' && lateAfter.active?.col === 'sku' && lateAfter.widths.every((w) => w < lateAfter.holder / 2), JSON.stringify({ lateActive, lateInView, whileEditing, lateAfter }))
    // A stylesheet already there when the grid was built (cached): its event re-measures nothing.
    await page.goto(`http://127.0.0.1:${port}/?inline`)
    await page.waitForFunction(() => window.sheet()?.rows?.length === 100)
    await page.waitForTimeout(200)
    const cachedForced = await page.evaluate(async () => { const table = window.sheet().grid.table; let n = 0; const orig = Object.getPrototypeOf(table).redraw; table.redraw = function (force) { if (force) n++; return orig.call(this, force) }; window.dispatchEvent(new Event('packstub-spreadsheet-css')); await new Promise((r) => setTimeout(r, 200)); return n })
    check('the stylesheet\'s event after a grid built on the stylesheet redraws nothing', cachedForced === 0, JSON.stringify({ cachedForced }))
    await fresh('?autoheight')
    await page.setViewportSize({ width: 1400, height: 1200 })
    await page.evaluate(() => window.sheet().setPerPage(25))
    await page.waitForFunction(() => window.sheet().rows.length === 25)
    await page.waitForTimeout(300)
    const short = await measure()
    console.log(`     25 rows in a 1200px window: grid ${short.grid}px, header ${short.header}px, holder ${short.client}/${short.scroll}px`)
    check('a short page shrinks the grid to its rows: no empty box, nothing to scroll', Math.abs(short.grid - short.borders - (short.header + 25 * 33 + 2)) <= 2 && short.scroll <= short.client + 1 && short.rowEls === 25 && short.doc <= short.window, JSON.stringify(short))
    await page.setViewportSize({ width: 1400, height: 800 })

    // A viewer's page (no row to edit or delete, no row to add) wears the read-only pill, so the sheet says why nothing responds.
    await fresh()
    const pill = () => page.evaluate(() => getComputedStyle(document.querySelector('.ps-sheet-pill-readonly')).display !== 'none')
    const pillBefore = await pill()
    await page.evaluate(() => { const s = window.sheet(); s.creatable = false; s.applyPage({ ...window.__server.rows({ page: 1, perPage: 100 }), rows: window.__server.rows({ page: 1, perPage: 100 }).rows.map((r) => ({ ...r, readOnly: true, deletable: false })) }) })
    await page.waitForTimeout(100)
    const pillLocked = await pill()
    await page.evaluate(() => { const s = window.sheet(); s.applyPage(window.__server.rows({ page: 1, perPage: 100 })) })
    await page.waitForTimeout(100)
    const pillAfter = await pill()
    check('a page with no row the user may edit or delete and no row to add wears the read-only pill', ! pillBefore && pillLocked && ! pillAfter, JSON.stringify({ pillBefore, pillLocked, pillAfter }))
    // The pinned columns' width is written on the grid for the holder's scroll-padding (a focused cell scrolls clear of them).
    const frozenVar = await page.evaluate(() => { const grid = document.querySelector('.ps-sheet-grid'); const width = [...grid.querySelectorAll('.tabulator-header .tabulator-frozen-left')].reduce((sum, el) => sum + el.offsetWidth, 0); return { variable: grid.style.getPropertyValue('--ps-sheet-frozen'), width, padding: getComputedStyle(grid.querySelector('.tabulator-tableholder')).scrollPaddingInlineStart } })
    check('the pinned columns\' width is on the grid and the holder scroll-pads by it', frozenVar.width > 50 && frozenVar.variable === `${frozenVar.width}px` && frozenVar.padding === `${frozenVar.width}px`, JSON.stringify(frozenVar))

    // The fill handle dragged with the mouse: Tabulator's rangeEdited answers its cells one array per row, and the
    // values it wrote are recorded as edits (nothing was, and a save said there was nothing to save).
    await fresh()
    await cell(0, 'price').click()
    await page.waitForTimeout(150)
    const handleBox = await page.locator('.ps-sheet .tabulator-range-fill-handle').boundingBox()
    const targetBox = await cell(2, 'price').boundingBox()
    const priceTop = await page.evaluate(() => window.sheet().grid.value('1', 'price'))
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)
    s = await state()
    const dragged = await page.evaluate(() => [window.sheet().grid.value('2', 'price'), window.sheet().grid.value('3', 'price')])
    check('the fill handle dragged two rows down writes the value into both and records two changes', s.dirty.cells === 2 && dragged[0] === priceTop && dragged[1] === priceTop, JSON.stringify({ dirty: s.dirty, priceTop, dragged }))
    await discardAll()

    // Typed text in a select is committed as typed and matched by label: "tools" + Enter picks Tools (Tabulator cancelled
    // typed text, the exact label included); text that is no option is painted red, as a pasted one is.
    await cell(0, 'category_id').click()
    await page.keyboard.type('tools')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    s = await state()
    const typedLabel = await page.evaluate(() => window.sheet().grid.value('1', 'category_id'))
    check('a label typed in a select and Enter pick that option', ! s.editing && typedLabel === '1' && s.dirty.cells === 1, JSON.stringify({ typedLabel, dirty: s.dirty, editing: s.editing }))
    await cell(1, 'category_id').click()
    await page.keyboard.type('zzz')
    await page.waitForTimeout(150)
    const noResults = await page.evaluate(() => document.querySelector('.tabulator-popup-container')?.textContent.trim())
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const typedNone = await page.evaluate(() => ({ value: window.sheet().grid.value('2', 'category_id'), error: window.sheet().buffer.errors['2']?.category_id ?? null }))
    check('text that is no option is kept and painted red, and the empty list says so in the sheet\'s words', noResults === 'No results' && typedNone.value === 'zzz' && !! typedNone.error && (await cellClasses(1, 'category_id')).includes('ps-sheet-cell-error'), JSON.stringify({ noResults, typedNone }))
    // Typed text, then ↓ onto an option: Tab or a click elsewhere take the highlighted option, as Enter does (Tabulator
    // resolved the blur from the typed text: "t" written, red). A character typed after the arrow makes the text count again.
    const optionValue = (label) => page.evaluate((l) => window.sheet().columns.find((c) => c.name === 'category_id').options.find((o) => o.label === l)?.value ?? null, label)
    const highlighted = () => page.evaluate(() => document.querySelector('.tabulator-popup-container .tabulator-edit-list-item.focused')?.textContent.trim() ?? null)
    await cell(2, 'category_id').click()
    await page.keyboard.type('t')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(80)
    const tabLabel = await highlighted()
    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    const tabPicked = await page.evaluate(() => ({ value: window.sheet().grid.value('3', 'category_id'), error: window.sheet().buffer.errors['3']?.category_id ?? null, active: window.sheet().grid.activeCell(), editing: window.sheet().grid.isEditing() }))
    await cell(3, 'category_id').click()
    await page.keyboard.type('g')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(80)
    const clickLabel = await highlighted()
    await cell(6, 'name').click()
    await page.waitForTimeout(150)
    const clickPicked = await page.evaluate(() => ({ value: window.sheet().grid.value('4', 'category_id'), error: window.sheet().buffer.errors['4']?.category_id ?? null }))
    await cell(4, 'category_id').click()
    await page.keyboard.type('g')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('z')
    await page.waitForTimeout(150)
    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    const typedAfter = await page.evaluate(() => window.sheet().grid.value('5', 'category_id'))
    check('↓ onto an option after typed text, then Tab or a click elsewhere, picks the highlighted option; a letter typed after the arrow keeps the text', !! tabLabel && tabPicked.value === await optionValue(tabLabel) && ! tabPicked.error && ! tabPicked.editing && tabPicked.active?.col !== 'category_id' && !! clickLabel && clickPicked.value === await optionValue(clickLabel) && ! clickPicked.error && typedAfter === 'gz', JSON.stringify({ tabLabel, tabPicked, clickLabel, clickPicked, typedAfter }))
    await discardAll()

    // Ctrl+ArrowDown counts a 0 as a filled cell (Tabulator read a falsy value as empty: the jump stopped at the row before the first 0, and from a 0 it did not move).
    await cell(0, 'stock').click()
    await page.keyboard.press('Control+ArrowDown')
    await page.waitForTimeout(300)
    s = await state()
    check('Ctrl+ArrowDown jumps over cells holding 0 to the last row of the page', s.active?.id === '100' && s.active?.col === 'stock', JSON.stringify(s.active))
    await page.evaluate(() => window.sheet().grid.select('17', 'stock'))
    await page.waitForTimeout(100)
    await page.keyboard.press('Control+ArrowUp')
    await page.waitForTimeout(300)
    s = await state()
    check('Ctrl+ArrowUp from a cell holding 0 moves', s.active?.id === '1', JSON.stringify(s.active))

    // The row menu from the keyboard: Shift+F10 opens it on the active cell's row, Escape closes it and the keyboard is back on the grid.
    await cell(0, 'name').click()
    await page.keyboard.press('Shift+F10')
    await page.waitForTimeout(150)
    const menuOpen = await page.locator('.ps-sheet-menu').isVisible()
    const menuFocus = await page.evaluate(() => document.activeElement?.className ?? '')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const menuClosed = ! (await page.locator('.ps-sheet-menu').isVisible())
    const afterEscape = await page.evaluate(() => document.activeElement?.className ?? '')
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(100)
    s = await state()
    check('Shift+F10 opens the row menu with its first item focused, Escape closes it and the arrows move the active cell again', menuOpen && menuFocus.includes('ps-sheet-menu-item') && menuClosed && afterEscape.includes('tabulator-tableholder') && s.active?.id === '2', JSON.stringify({ menuOpen, menuFocus, menuClosed, afterEscape, active: s.active }))
    // The active cell's row scrolled out of the window (the wheel): Shift+F10 brings it back and opens the menu on it.
    await scrollToRow(95, 'bottom')
    await page.waitForTimeout(150)
    const awayBefore = await rendered(2)
    await page.keyboard.press('Shift+F10')
    await page.waitForTimeout(400)
    const awayMenu = await page.evaluate(() => ({ id: window.sheet().menu?.id ?? null, visible: !! document.querySelector('.ps-sheet-menu') && getComputedStyle(document.querySelector('.ps-sheet-menu')).display !== 'none' }))
    const awayAfter = await rendered(2)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    check('Shift+F10 on a row scrolled out of the window brings it back and opens its menu', ! awayBefore && awayAfter && awayMenu.id === '2' && awayMenu.visible, JSON.stringify({ awayBefore, awayAfter, awayMenu }))

    // A boolean cell has an accessible name.
    const boolNames = await page.evaluate(() => [1, 4].map((i) => window.sheet().grid.table.getRow(String(i)).getCell('is_active').getElement().getAttribute('aria-label')))
    check('a boolean cell is named Yes or No for a screen reader', boolNames[0] === 'Yes' && boolNames[1] === 'No', JSON.stringify(boolNames))

    // A conflict on a row whose other cell changed: this cell's server value is the one the user loaded, so the line says so instead of blaming it.
    await server_(() => { window.__server.state.conflictOn = '3' })
    await cell(2, 'name').click()
    await page.keyboard.type('Mine')
    await page.keyboard.press('Enter')
    const savesBeforeConflict = await page.evaluate(() => window.__server.calls.save.length)
    await page.keyboard.press('Control+s')
    await page.waitForFunction((n) => window.__server.calls.save.length === n + 1, savesBeforeConflict)
    await page.waitForTimeout(100)
    // The save's flash sits on the line first: cleared, the line shows the active cell's status.
    await page.evaluate(() => { const sh = window.sheet(); sh.grid.select('3', 'name'); sh.hint = null; sh.updateStatus() })
    await page.waitForTimeout(100)
    const elsewhere = await page.evaluate(() => document.querySelector('.ps-sheet-hint')?.textContent.trim())
    check('a conflict whose server value is the one the user loaded says another cell of the row changed', elsewhere.includes('another cell of the row was changed') && ! elsewhere.includes('Their value'), JSON.stringify(elsewhere))
    await server_(() => { window.__server.state.conflictOn = null })
    await discardAll()

    // aria-sort follows the sort; the tooltips read the configured shortcut for the platform
    await fresh()
    const sortAttrs = () => page.evaluate(() => ({ sku: document.querySelector('.ps-sheet .tabulator-col[tabulator-field="sku"]').getAttribute('aria-sort'), price: document.querySelector('.ps-sheet .tabulator-col[tabulator-field="price"]').getAttribute('aria-sort') }))
    const sortBefore = await sortAttrs()
    await page.evaluate(() => window.sheet().sortBy('price'))
    await page.waitForTimeout(200)
    const sortAfter = await sortAttrs()
    check('the sorted header carries aria-sort and the others none', sortBefore.sku === 'ascending' && sortBefore.price === 'none' && sortAfter.price === 'ascending' && sortAfter.sku === 'none', JSON.stringify({ sortBefore, sortAfter }))
    const titles = await page.evaluate(() => { const mac = /Mac/.test(navigator.platform); const btn = (text) => [...document.querySelectorAll('.ps-sheet-toolbar button')].find((b) => b.textContent.trim().startsWith(text) || b.getAttribute('aria-label') === text); return { mac, save: btn('Save')?.title, undo: btn('Undo')?.title, add: btn('Add row')?.title, expect: mac ? ['Save (⌘S)', 'Undo (⌘Z)', 'Add row (⌘↩)'] : ['Save (Ctrl+S)', 'Undo (Ctrl+Z)', 'Add row (Ctrl+Enter)'] } })
    check('the tooltips show the shortcuts for the platform', titles.save === titles.expect[0] && titles.undo === titles.expect[1] && titles.add === titles.expect[2], JSON.stringify(titles))
    await fresh('?addrow=mod%2Bshift%2Ba')
    const bound = await page.evaluate(() => { const mac = /Mac/.test(navigator.platform); return { title: [...document.querySelectorAll('.ps-sheet-toolbar button')].find((b) => b.textContent.trim().startsWith('Add row'))?.title, expect: mac ? 'Add row (⇧⌘A)' : 'Add row (Ctrl+Shift+A)' } })
    check('and follow the configured binding', bound.title === bound.expect, JSON.stringify(bound))

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
    await cell(1, 'name').click()
    await page.keyboard.type('Two again')
    await cell(3, 'name').click()
    await page.waitForTimeout(60)
    await scrollToRow(90)
    await page.waitForTimeout(250)
    const away = await page.evaluate(() => ({ holder: !! document.activeElement?.classList?.contains('tabulator-tableholder'), cell: !! document.activeElement?.classList?.contains('tabulator-cell') }))
    await page.keyboard.press('F2')
    await page.waitForTimeout(40)
    const afterAway = (await state()).editing
    await page.keyboard.press('Escape')
    check('after a click on another cell with an editor open, the focus is not left on the cell element: its row scrolled out of the window, the keyboard still reaches the grid', away.holder && ! away.cell && afterAway, JSON.stringify({ away, afterAway }))
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
    await discardAll()
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
    await discardAll()
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
    await discardAll()
    await page.waitForTimeout(20)
    let a = (await state()).active
    v = await typeInto('Soon')
    check('Discard keeps the active cell: a key typed 20 ms later goes into that row, the first visible row unchanged', clean() && a?.id === '70' && a?.col === 'name' && (await changesOf()) === '{"70":{"name":"Soon"}}' && samePlace(before5, v), JSON.stringify({ a, changes: await changesOf(), before5, v, errors: errors.slice(errorsSeen) }))
    await atRest()
    before5 = await firstVisible()
    await discardAll()
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
    await discardAll()
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

    /* ---------------------------------------------------------------- keys inside an open editor: a typed date, PageUp / PageDown / Home / End, ArrowUp / ArrowDown */

    await fresh()
    errorsSeen = errors.length
    const press = async (key, wait = 120) => { await page.keyboard.press(key); await page.waitForTimeout(wait) }
    const inEditor = () => page.evaluate(() => {
        const sh = window.sheet(); const g = sh.grid; const i = document.activeElement; const ed = g.table.modules.edit.currentCell; const a = g.activeCell()
        let caret = null
        try { caret = i.selectionStart === null ? null : `${i.selectionStart}-${i.selectionEnd}` } catch (e) {}

        return { editing: g.isEditing(), cell: ed ? `${ed.row.data.id}/${ed.column.field}` : null, input: g.isEditing() && i.tagName === 'INPUT' ? i.value : null, caret, active: a && `${a.id}/${a.col}`, scrollTop: Math.round(g.table.rowManager.element.scrollTop), dirty: sh.dirty.total, list: [...document.querySelectorAll('.tabulator-edit-list-item')].map((x) => x.textContent + (x.classList.contains('focused') ? '*' : '')).join(',') }
    })
    const valueOf = (id, field) => page.evaluate(([i, f]) => window.sheet().grid.value(i, f), [String(id), field])
    // what a native picker does to the field: the pointer goes down on it, the value is set, change fires
    const pick = async (value) => { await page.evaluate((v) => { const i = document.activeElement; i.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })) }, value); await page.waitForTimeout(100) }

    // a date and a date-time typed with the keyboard: 11/11/2027 reads the same with the day or the month first
    for (const [field, label, typed, picked, pickedAs] of [['available_on', 'date', '2027-11-11', '2026-12-24', '2026-12-24'], ['published_at', 'date-time', '2027-11-11 08:30:00', '2026-12-24T10:15', '2026-12-24 10:15:00']]) {
        await (await cellOf(5, field)).click()
        await press('F2')
        const steps = [await inEditor()]
        for (const digit of '11112027') { await press(digit, 50); steps.push(await inEditor()) }
        const stayed = steps.every((x) => x.editing && x.cell === `5/${field}` && x.active === `5/${field}` && x.dirty === steps[0].dirty)
        await press('Enter')
        let e = await inEditor()
        check(`a ${label} typed digit by digit keeps its editor open after every digit, and Enter commits that ${label} and moves down`, clean() && stayed && (await valueOf(5, field)) === typed && ! e.editing && e.active === `6/${field}` && e.dirty === steps[0].dirty + 1, JSON.stringify({ steps: steps.map((x) => `${x.editing}:${x.input}`), value: await valueOf(5, field), e, errors: errors.slice(errorsSeen) }))

        await (await cellOf(10, field)).click()
        const kept = await valueOf(10, field)
        await press('F2')
        await press('Backspace')
        const cleared = await inEditor()
        await press('Delete')
        const deleted = await inEditor()
        await press('Escape')
        e = await inEditor()
        check(`Backspace and Delete in a ${label} editor clear a segment and keep the editor open, the cell as it was; Escape leaves it unchanged`, clean() && cleared.editing && cleared.cell === `10/${field}` && deleted.editing && deleted.cell === `10/${field}` && cleared.dirty === e.dirty && ! e.editing && (await valueOf(10, field)) === kept && e.active === `10/${field}`, JSON.stringify({ cleared, deleted, e, value: await valueOf(10, field) }))

        await press('F2')
        await press('1', 50)
        await press('5', 50)
        const digits = await inEditor()
        await press('Escape')
        e = await inEditor()
        check(`digits and then Escape in a ${label} editor leave the cell unchanged`, clean() && digits.editing && digits.input !== null && ! e.editing && (await valueOf(10, field)) === kept && e.dirty === digits.dirty, JSON.stringify({ digits, e, value: await valueOf(10, field) }))

        await press('F2')
        const open = await inEditor()
        await pick(picked)
        e = await inEditor()
        const pickedValue = await valueOf(10, field)
        // and after a typed digit the pointer makes it a picked one again
        await (await cellOf(15, field)).click()
        await press('F2')
        await press('1', 50)
        const typedFirst = await inEditor()
        await pick(picked)
        const e2 = await inEditor()
        check(`a picked ${label} (pointer down, the value, change) commits at once, also after a typed digit`, clean() && open.editing && ! e.editing && pickedValue === pickedAs && e.dirty === open.dirty + 1 && typedFirst.editing && ! e2.editing && (await valueOf(15, field)) === pickedAs && e2.dirty === e.dirty + 1, JSON.stringify({ open, e, pickedValue, typedFirst, e2, value: await valueOf(15, field) }))

        await (await cellOf(20, field)).click()
        await press('F2')
        for (const digit of '11112027') await press(digit, 40)
        await press('Tab')
        e = await inEditor()
        check(`Tab commits a typed ${label} and moves right`, clean() && ! e.editing && (await valueOf(20, field)) === typed && e.active !== `20/${field}` && e.active?.startsWith('20/'), JSON.stringify({ e, value: await valueOf(20, field) }))
    }
    await discardAll()
    await page.waitForTimeout(100)

    // PageUp / PageDown / Home / End: the editor keeps them, in the middle of the page where the grid could scroll both ways
    await scrollToRow(50)
    await atRest()
    const samePlaceInEditor = (x, y, cellName) => x.editing && y.editing && y.cell === cellName && x.cell === cellName && y.active === x.active && y.scrollTop === x.scrollTop && y.dirty === x.dirty
    for (const [field, label] of [['name', 'text'], ['price', 'number'], ['available_on', 'date'], ['published_at', 'date-time'], ['category_id', 'select']]) {
        await (await cellOf(50, field)).click()
        // typing on the selected cell opens the text editor with that text; Enter opens the select with its whole list
        if (field === 'name') await page.keyboard.type('Sheet row')
        else await press(field === 'category_id' ? 'Enter' : 'F2', 200)
        const bad = []
        for (const key of ['PageUp', 'PageDown', 'Home', 'End']) {
            const x = await inEditor()
            await press(key, 250)
            const y = await inEditor()
            if (! samePlaceInEditor(x, y, `50/${field}`) || y.scrollTop < 300 || (field !== 'category_id' && y.input !== x.input) || (field === 'category_id' && y.list === '')) bad.push({ key, x, y })
        }
        check(`PageUp, PageDown, Home and End in an open ${label} editor leave the editor open on its cell, the active cell, the scroll and the unsaved count as they were`, clean() && bad.length === 0, JSON.stringify({ bad, errors: errors.slice(errorsSeen) }))
        if (field === 'name') {
            const caretAt = async (n, key) => { await page.evaluate((n) => document.activeElement.setSelectionRange(n, n), n); const x = await inEditor(); await press(key); const y = await inEditor(); return { ...y, same: samePlaceInEditor(x, y, '50/name') } }
            const home = await caretAt(3, 'Home')
            const end = await caretAt(3, 'End')
            const shiftHome = await caretAt(3, 'Shift+Home')
            const shiftEnd = await caretAt(3, 'Shift+End')
            check('Home and End move the caret to the start and the end of a text editor; Shift+Home and Shift+End select', clean() && home.same && home.caret === '0-0' && end.same && end.caret === '9-9' && shiftHome.same && shiftHome.caret === '0-3' && shiftEnd.same && shiftEnd.caret === '3-9' && end.input === 'Sheet row', JSON.stringify({ home, end, shiftHome, shiftEnd }))
        }
        await press('Escape')
    }
    s = await state()
    check('and nothing was written meanwhile', clean() && ! s.editing && s.dirty.total === 0, JSON.stringify(s.dirty))

    // ArrowUp / ArrowDown: a text or number editor commits and moves one row, no editor opened there
    await (await cellOf(50, 'name')).click()
    await page.keyboard.type('Moved')
    await press('ArrowDown', 200)
    let ek = await inEditor()
    const downOk = ! ek.editing && ek.active === '51/name' && (await valueOf(50, 'name')) === 'Moved' && ek.dirty === 1
    await page.keyboard.type('Back')
    await press('ArrowUp', 200)
    let ek2 = await inEditor()
    check('ArrowDown and ArrowUp in a text editor commit the text and move the selection one row, without opening the next editor', clean() && downOk && ! ek2.editing && ek2.active === '50/name' && (await valueOf(51, 'name')) === 'Back' && ek2.dirty === 2 && (await page.evaluate(() => document.activeElement?.classList.contains('tabulator-tableholder'))), JSON.stringify({ ek, ek2, errors: errors.slice(errorsSeen) }))
    await press('F2')
    await press('ArrowDown', 200)
    ek = await inEditor()
    check('an editor left unchanged by ArrowDown closes without a change and the selection moves', clean() && ! ek.editing && ek.active === '51/name' && ek.dirty === 2 && (await valueOf(50, 'name')) === 'Moved', JSON.stringify(ek))
    await (await cellOf(50, 'price')).click()
    await page.keyboard.type('7')
    await press('ArrowDown', 200)
    ek = await inEditor()
    await page.keyboard.type('8')
    await press('ArrowUp', 200)
    ek2 = await inEditor()
    check('and in a number editor too', clean() && ! ek.editing && ek.active === '51/price' && ! ek2.editing && ek2.active === '50/price' && String(await valueOf(50, 'price')) === '7' && String(await valueOf(51, 'price')) === '8' && ek2.dirty === 4, JSON.stringify({ ek, ek2, v50: await valueOf(50, 'price'), v51: await valueOf(51, 'price') }))
    await page.keyboard.type('abc')
    await press('ArrowLeft')
    await page.keyboard.type('X')
    const left = await inEditor()
    await press('ArrowRight')
    await page.keyboard.type('Y')
    const right = await inEditor()
    await press('Alt+ArrowDown')
    const alt = await inEditor()
    await press('Escape')
    check('ArrowLeft and ArrowRight stay caret movement, and Alt+ArrowDown leaves the editor open on its cell', clean() && left.editing && left.input === 'abXc' && right.editing && right.input === 'abXcY' && alt.editing && alt.cell === '50/price' && alt.active === '50/price' && alt.input === 'abXcY' && alt.dirty === 4, JSON.stringify({ left, right, alt }))
    await discardAll()
    await page.waitForTimeout(100)
    await fresh()
    errorsSeen = errors.length
    await cell(0, 'name').click()
    await page.keyboard.type('Top')
    await press('ArrowUp', 200)
    ek = await inEditor()
    check('ArrowUp in the first row\'s editor commits and stays on that row', clean() && ! ek.editing && ek.active === '1/name' && (await valueOf(1, 'name')) === 'Top' && ek.dirty === 1, JSON.stringify(ek))

    // in a date / date-time editor the arrows step the focused segment
    for (const [field, label] of [['available_on', 'date'], ['published_at', 'date-time']]) {
        await (await cellOf(10, field)).click()
        const kept = await valueOf(10, field)
        await press('F2')
        const d0 = await inEditor()
        await press('ArrowUp')
        const d1 = await inEditor()
        await press('ArrowDown')
        await press('ArrowDown')
        const d2 = await inEditor()
        await press('Escape')
        const d3 = await inEditor()
        check(`ArrowUp and ArrowDown in a ${label} editor step the focused segment, the editor open on its cell, and Escape leaves the cell unchanged`, clean() && [d0, d1, d2].every((x) => x.editing && x.cell === `10/${field}` && x.active === `10/${field}` && x.dirty === d0.dirty) && new Set([d0.input, d1.input, d2.input]).size === 3 && ! d3.editing && d3.dirty === d0.dirty && (await valueOf(10, field)) === kept, JSON.stringify({ d0, d1, d2, d3, errors: errors.slice(errorsSeen) }))
        await press('F2')
        await press('ArrowUp')
        const stepped = (await inEditor()).input
        await press('Enter')
        const d4 = await inEditor()
        check(`and Enter commits the stepped ${label}`, clean() && ! d4.editing && d4.active === `11/${field}` && (await valueOf(10, field)) === (field === 'available_on' ? stepped : stepped.replace('T', ' ') + ':00') && (await valueOf(10, field)) !== kept, JSON.stringify({ stepped, d4, value: await valueOf(10, field) }))
    }

    // in a select the arrows move through the options (row 5's category is the last one)
    await (await cellOf(5, 'category_id')).click()
    await press('Enter', 300)
    const l0 = await inEditor()
    await press('ArrowUp')
    const l1 = await inEditor()
    await press('ArrowUp')
    const l2 = await inEditor()
    await press('ArrowDown')
    const l3 = await inEditor()
    await press('Enter')
    const l4 = await inEditor()
    check('ArrowUp and ArrowDown in a select editor move through its options, the list open on its cell, and Enter picks the one reached', clean() && [l0, l1, l2, l3].every((x) => x.editing && x.cell === '5/category_id' && x.active === '5/category_id') && l0.list === 'Tools,Paint,Garden' && l1.list === 'Tools,Paint*,Garden' && l2.list === 'Tools*,Paint,Garden' && l3.list === 'Tools,Paint*,Garden' && ! l4.editing && (await valueOf(5, 'category_id')) === '2' && l4.active === '6/category_id', JSON.stringify({ l0, l1, l2, l3, l4, value: await valueOf(5, 'category_id'), errors: errors.slice(errorsSeen) }))

    // a date with a part missing is not a cleared date: leaving the editor keeps the cell's value; every part cleared empties it
    await fresh()
    errorsSeen = errors.length
    const onServer = (id, field) => page.evaluate(([i, f]) => window.__server.products.find((p) => p.id === i)?.[f], [String(id), field])
    const dateField = () => page.evaluate(() => { const i = document.activeElement; return { value: i.value, bad: !! i.validity?.badInput } })
    for (const [field, label] of [['available_on', 'date'], ['published_at', 'date-time']]) {
        const kept = await valueOf(15, field)
        const leaves = []
        for (const how of ['click', 'Enter', 'Control+s']) {
            await (await cellOf(15, field)).click()
            await press('F2')
            await press('Backspace')
            const half = { ...(await dateField()), editing: (await inEditor()).editing }
            const saves = await page.evaluate(() => window.__server.calls.save.length)
            if (how === 'click') await (await cellOf(17, 'name')).click()
            else await page.keyboard.press(how)
            await page.waitForTimeout(150)
            await page.waitForFunction(() => ! window.sheet().saving)
            const e = await inEditor()
            leaves.push({ how, half, editing: e.editing, dirty: e.dirty, active: e.active, value: await valueOf(15, field), server: await onServer(15, field), saved: (await page.evaluate(() => window.__server.calls.save.length)) - saves })
        }
        check(`a ${label} with one part cleared is not a cleared ${label}: a click on another cell, Enter or Ctrl+S leave the cell, the unsaved count and the server as they were`, clean() && kept !== null && leaves.every((x) => x.half.editing && x.half.value === '' && x.half.bad && ! x.editing && x.dirty === 0 && x.value === kept && x.server === kept && x.saved === 0) && leaves[0].active === '17/name' && leaves[1].active === `16/${field}`, JSON.stringify({ kept, leaves, errors: errors.slice(errorsSeen) }))

        await (await cellOf(15, field)).click()
        await press('F2')
        let parts = { value: null, bad: true }
        for (let n = 0; n < 8 && parts.bad !== false; n++) { await press('Backspace', 40); await press('ArrowRight', 40); parts = await dateField() }
        await press('Enter')
        const e = await inEditor()
        check(`every part of a ${label} cleared and Enter empties the cell`, clean() && parts.value === '' && parts.bad === false && ! e.editing && (await valueOf(15, field)) === null && e.dirty === 1 && e.active === `16/${field}`, JSON.stringify({ parts, e, value: await valueOf(15, field) }))
        await discardAll()
        await page.waitForTimeout(100)
    }

    // a select opened by F2 shows every option: the keyup of F2 (and of a modifier, Home, PageDown …) never filters the list
    const optionCount = await page.evaluate(() => window.sheet().columns.find((c) => c.name === 'category_id').options.length)
    const listed = (x) => (x.list === '' ? [] : x.list.split(','))
    await (await cellOf(4, 'category_id')).click()
    const before4 = await valueOf(4, 'category_id')
    await press('F2', 300)
    const f2 = await inEditor()
    await press('ArrowDown')
    const f2Down = await inEditor()
    await press('Enter')
    const f2Picked = await inEditor()
    check('F2 on a select cell opens the list with every option, its label selected, and ArrowDown + Enter pick the next one', clean() && f2.editing && f2.cell === '4/category_id' && listed(f2).length === optionCount && optionCount === 3 && f2.input === 'Paint' && f2.caret === '0-5' && f2Down.list === 'Tools,Paint,Garden*' && ! f2Picked.editing && before4 === '2' && (await valueOf(4, 'category_id')) === '3' && f2Picked.active === '5/category_id', JSON.stringify({ optionCount, f2, f2Down, f2Picked, value: await valueOf(4, 'category_id'), errors: errors.slice(errorsSeen) }))

    for (const [opener, label] of [['F2', 'F2'], ['Enter', 'Enter'], ['dblclick', 'a double-click']]) {
        await (await cellOf(7, 'category_id')).click()
        if (opener === 'dblclick') { await (await cellOf(7, 'category_id')).dblclick(); await page.waitForTimeout(300) } else await press(opener, 300)
        const opened = await inEditor()
        const shrunk = []
        for (const key of ['Shift', 'Control', 'Alt', 'Home', 'End', 'PageUp', 'PageDown']) {
            await press(key)
            const x = await inEditor()
            if (! x.editing || x.cell !== '7/category_id' || listed(x).length !== optionCount) shrunk.push({ key, x })
        }
        await press('Escape')
        check(`in a select's list opened by ${label}, Shift, Control, Alt, Home, End, PageUp and PageDown leave every option listed`, clean() && opened.editing && listed(opened).length === optionCount && opened.caret === '0-5' && shrunk.length === 0 && ! (await inEditor()).editing && (await valueOf(7, 'category_id')) === '2', JSON.stringify({ opened, shrunk, errors: errors.slice(errorsSeen) }))
    }

    // typing still filters: on the selected cell (the letter is the search text), and after F2 (the letter replaces the selected label)
    await (await cellOf(7, 'category_id')).click()
    await press('p')
    const typedP = await inEditor()
    await press('x')
    const typedPx = await inEditor()
    await press('Backspace')
    const typedBack = await inEditor()
    await press('Escape')
    await press('g')
    const typedG = await inEditor()
    await press('Escape')
    check('typing on a select cell filters its list by the typed text, and Backspace filters again', clean() && typedP.input === 'p' && typedP.list === 'Paint' && typedPx.input === 'px' && typedPx.list === '' && typedBack.input === 'p' && typedBack.list === 'Paint' && typedG.input === 'g' && typedG.list === 'Garden' && ! (await inEditor()).editing && (await valueOf(7, 'category_id')) === '2', JSON.stringify({ typedP, typedPx, typedBack, typedG }))
    await press('F2', 300)
    await press('g')
    const f2g = await inEditor()
    await press('ArrowDown')
    const f2gDown = await inEditor()
    await press('Enter')
    const f2gPicked = await inEditor()
    check('F2 and a letter replace the label and filter the list: "g" shows Garden, ArrowDown + Enter pick it', clean() && f2g.editing && f2g.input === 'g' && f2g.list === 'Garden' && f2gDown.list === 'Garden*' && ! f2gPicked.editing && (await valueOf(7, 'category_id')) === '3' && f2gPicked.active === '8/category_id', JSON.stringify({ f2g, f2gDown, f2gPicked, value: await valueOf(7, 'category_id'), errors: errors.slice(errorsSeen) }))

    // Enter on a cell without an editor does nothing (Tabulator's own Enter would throw there); a boolean still flips, a text cell still opens
    const enterDirty = (await state()).dirty.total
    await (await cellOf(5, 'margin')).click()
    const marginBefore = await valueOf(5, 'margin')
    await press('Enter', 200)
    const onComputed = await inEditor()
    await (await cellOf(5, 'is_active')).click()
    const activeBefore = await valueOf(5, 'is_active')
    await press('Enter', 200)
    const onBoolean = await inEditor()
    const activeAfter = await valueOf(5, 'is_active')
    await (await cellOf(5, 'name')).click()
    await press('Enter', 200)
    const onText = await inEditor()
    await press('Escape')
    check('Enter on a computed cell does nothing and throws nothing; on a boolean it still flips the cell, on a text cell it still opens the editor', clean() && ! onComputed.editing && onComputed.active === '5/margin' && onComputed.dirty === enterDirty && (await valueOf(5, 'margin')) === marginBefore && ! onBoolean.editing && activeAfter === ! activeBefore && onBoolean.dirty === enterDirty + 1 && onBoolean.active === '5/is_active' && onText.editing && onText.cell === '5/name' && onText.input === 'Product 5', JSON.stringify({ onComputed, onBoolean, activeBefore, activeAfter, onText, errors: errors.slice(errorsSeen) }))

    /* ---------------------------------------------------------------- a date typed on the selected cell, Ctrl+Enter, the active cell after Add row, characters that are key codes, a keyboard-only pass */

    // digits typed on a selected date / date-time cell (no F2): the first one opens the editor and lands in the field
    // too. 11/11/2027 reads the same with the day or the month first; a lost first digit would leave the year short.
    // Row 5's date is 2026-10-06: a 1 in its first part changes the field whichever part that is (the date-time's
    // day is 01 already, so only the committed value tells there).
    await fresh()
    errorsSeen = errors.length
    const fieldValue = () => page.evaluate(() => (document.activeElement?.tagName === 'INPUT' ? document.activeElement.value : null))
    for (const [field, label, row] of [['available_on', 'date', 5], ['published_at', 'date-time', 5]]) {
        await (await cellOf(row, field)).click()
        const before = await valueOf(row, field)
        const dirty0 = (await state()).dirty.total
        await press('1', 60)
        const first = { ...(await inEditor()), field: await fieldValue() }
        const steps = [first]
        for (const digit of '1112027') { await press(digit, 50); steps.push(await inEditor()) }
        const stayed = steps.every((x) => x.editing && x.cell === `${row}/${field}` && x.active === `${row}/${field}` && x.dirty === dirty0)
        await press('Enter')
        let e = await inEditor()
        const expected = field === 'available_on' ? '2027-11-11' : `2027-11-11 ${String(before).slice(11, 16)}:00`
        check(`eight digits typed on a selected ${label} cell, without F2: the first one opens the editor and is in the field, the unsaved count waits for Enter, and Enter commits that ${label}${field === 'published_at' ? ' with its time kept' : ''}`, clean() && before !== null && first.editing && first.field !== null && (field !== 'available_on' || (first.field !== before && first.field !== '')) && stayed && (await valueOf(row, field)) === expected && ! e.editing && e.active === `${row + 1}/${field}` && e.dirty === dirty0 + 1, JSON.stringify({ before, first, steps: steps.map((x) => `${x.editing}:${x.input}:${x.dirty}`), value: await valueOf(row, field), expected, e, errors: errors.slice(errorsSeen) }))

        await (await cellOf(10, field)).click()
        const kept = await valueOf(10, field)
        await press('1', 50)
        await press('5', 50)
        const digits = await inEditor()
        await press('Escape')
        e = await inEditor()
        check(`digits typed on a selected ${label} cell and then Escape leave the cell unchanged`, clean() && digits.editing && digits.cell === `10/${field}` && ! e.editing && (await valueOf(10, field)) === kept && e.dirty === dirty0 + 1 && e.active === `10/${field}`, JSON.stringify({ digits, e, kept, value: await valueOf(10, field) }))

        // any other first key opens the editor and types nothing
        await press('a', 80)
        const letter = { ...(await inEditor()), field: await fieldValue() }
        await press('Escape')
        e = await inEditor()
        check(`a letter typed on a selected ${label} cell opens its editor with the cell's value, nothing typed`, clean() && letter.editing && letter.cell === `10/${field}` && letter.field === (kept === null ? '' : field === 'available_on' ? kept : String(kept).slice(0, 16).replace(' ', 'T')) && ! e.editing && (await valueOf(10, field)) === kept && e.dirty === dirty0 + 1, JSON.stringify({ letter, e, kept }))
    }

    // Ctrl+Enter adds a row and is not an Enter to the grid too: no editor opens on the cell it was pressed on
    await fresh()
    errorsSeen = errors.length
    const sheetNow = () => page.evaluate(() => {
        const sh = window.sheet(); const g = sh.grid; const a = g.activeCell(); const temps = sh.buffer.createdOrder; const el = temps.length ? g.table.getRow(temps.at(-1))?.getElement() : null
        const h = g.table.rowManager.element.getBoundingClientRect(); const r = el?.isConnected ? el.getBoundingClientRect() : null

        return { created: sh.dirty.created, cells: sh.dirty.cells, total: sh.dirty.total, editing: g.isEditing(), active: a && `${a.id}/${a.col}`, temps, last: temps.length ? { ...sh.buffer.created[temps.at(-1)] } : null, changes: JSON.stringify(sh.buffer.changes), inView: !! r && r.top >= h.top - 1 && r.bottom <= h.bottom + 1, holder: !! document.activeElement?.classList.contains('tabulator-tableholder'), undo: sh.buffer.undo.length }
    })
    const onNewRow = (n) => page.waitForFunction((n) => { const sh = window.sheet(); return sh.buffer.createdOrder.length === n && sh.grid.activeCell()?.id === sh.buffer.createdOrder.at(-1) }, n, { timeout: 3000 }).catch(() => {})
    for (const [combo, n] of [['Control+Enter', 1], ['Meta+Enter', 2]]) {
        await scrollToRow(5)
        await (await cellOf(5, 'name')).click()
        await page.keyboard.press(combo)
        await onNewRow(n)
        await page.waitForTimeout(300)
        const added = await sheetNow()
        await page.keyboard.type('K' + n)
        await page.waitForTimeout(80)
        const typing = await inEditor()
        await press('Enter')
        const typed = await sheetNow()
        await press('ArrowUp')
        const moved = await sheetNow()
        check(`${combo} on a text cell adds one row and opens no editor; the keyboard still works: the active cell is the new row's first editable cell, in view, a typed text goes there and the arrows move`, clean() && added.created === n && ! added.editing && added.holder && added.active === `${added.temps.at(-1)}/sku` && added.inView && added.changes === '{}' && typing.editing && typing.cell === added.active && typing.input === 'K' + n && ! typed.editing && typed.last?.sku === 'K' + n && typed.changes === '{}' && (await valueOf(5, 'name')) === 'Product 5' && moved.active !== typed.active && ! moved.editing, JSON.stringify({ added, typing, typed, moved, errors: errors.slice(errorsSeen) }))
    }
    for (const [combo, n] of [['Control+Enter', 3], ['Meta+Enter', 4]]) {
        await scrollToRow(5)
        await (await cellOf(5, 'margin')).click()
        await page.keyboard.press(combo)
        await onNewRow(n)
        await page.waitForTimeout(300)
        const added = await sheetNow()
        check(`${combo} on a computed cell adds one row and throws nothing`, clean() && added.created === n && ! added.editing && added.holder && added.active === `${added.temps.at(-1)}/sku` && added.changes === '{}', JSON.stringify({ added, errors: errors.slice(errorsSeen) }))
    }
    // from the last row, with the new row in view next to it: the text typed next is the new row's, not the old cell's
    await fresh()
    errorsSeen = errors.length
    await scrollToRow(100, 'bottom')
    await atRest()
    await (await cellOf(100, 'name')).click()
    await page.keyboard.press('Control+Enter')
    await onNewRow(1)
    await page.waitForTimeout(300)
    const lastAdded = await sheetNow()
    await page.keyboard.type('NEW ROW NAME')
    await press('Enter')
    const lastTyped = await sheetNow()
    check('Ctrl+Enter on the last row, the new row in view under it: no editor opens on the old cell, and the text typed next is the new row\'s, the old cell as it was', clean() && lastAdded.created === 1 && ! lastAdded.editing && lastAdded.inView && lastTyped.changes === '{}' && (await valueOf(100, 'name')) === 'Product 100' && lastTyped.last?.sku === 'NEW ROW NAME' && lastTyped.cells === 0, JSON.stringify({ lastAdded, lastTyped, name: await valueOf(100, 'name'), errors: errors.slice(errorsSeen) }))
    // inside an open editor Ctrl+Enter is the editor's Enter first: the text is committed, then the row is added
    await scrollToRow(5)
    await (await cellOf(5, 'name')).click()
    await page.keyboard.type('In the editor')
    await page.keyboard.press('Control+Enter')
    await onNewRow(2)
    await page.waitForTimeout(300)
    const fromEditor = await sheetNow()
    check('Ctrl+Enter in an open editor commits its text and adds a row, the active cell on the new row', clean() && fromEditor.created === 2 && ! fromEditor.editing && fromEditor.holder && fromEditor.changes === '{"5":{"name":"In the editor"}}' && fromEditor.active === `${fromEditor.temps.at(-1)}/sku`, JSON.stringify({ fromEditor, errors: errors.slice(errorsSeen) }))

    // the Add row button: the active cell goes to the new row, so typing lands there; one Ctrl+Z takes the text back, the next the row
    await fresh()
    errorsSeen = errors.length
    await (await cellOf(5, 'name')).click()
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await onNewRow(1)
    await page.waitForTimeout(300)
    const byButton = await sheetNow()
    await page.keyboard.type('abc')
    await press('Enter')
    const buttonTyped = await sheetNow()
    await press('Control+z')
    const undoText = await sheetNow()
    await press('Control+z')
    const undoRow = await sheetNow()
    await page.keyboard.type('Z')
    await page.waitForTimeout(80)
    const afterRowUndo = await inEditor()
    await press('Escape')
    check('after a click on Add row the active cell is the new row\'s first editable cell, in view, and the text typed next is in the new row, the old row untouched', clean() && byButton.created === 1 && ! byButton.editing && byButton.holder && byButton.inView && byButton.active === `${byButton.temps[0]}/sku` && buttonTyped.last?.sku === 'abc' && buttonTyped.changes === '{}' && buttonTyped.cells === 0 && (await valueOf(5, 'name')) === 'Product 5', JSON.stringify({ byButton, buttonTyped, errors: errors.slice(errorsSeen) }))
    check('one Ctrl+Z takes the typed text back and the next one the row; the active cell is then the last row\'s, where typing opens an editor', clean() && undoText.created === 1 && ! undoText.last?.sku && undoText.undo === 1 && undoRow.created === 0 && undoRow.total === 0 && undoRow.undo === 0 && undoRow.active === '100/sku' && afterRowUndo.editing && afterRowUndo.cell === '100/sku' && afterRowUndo.input === 'Z', JSON.stringify({ undoText, undoRow, afterRowUndo, errors: errors.slice(errorsSeen) }))

    // a new row filled and saved: the active cell stays on that row when it gets its real id
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await onNewRow(1)
    await page.waitForTimeout(300)
    await page.keyboard.type('SKU-R10')
    await press('Tab')
    await page.keyboard.type('Round ten')
    await press('Tab')
    await press('ArrowRight', 60)
    const savesR10 = await page.evaluate(() => window.__server.calls.save.length)
    await page.keyboard.press('Control+s')
    await page.waitForFunction((n) => ! window.sheet().saving && window.__server.calls.save.length === n + 1, savesR10)
    await page.waitForTimeout(200)
    const savedRow = await sheetNow()
    const realId = await page.evaluate(() => window.__server.products.at(-1).id)
    await page.keyboard.type('9')
    await press('Enter')
    check('after the save of a new row the active cell is still on that row, under its real id: the next typing edits it', clean() && savedRow.created === 0 && savedRow.total === 0 && savedRow.active === `${realId}/price` && savedRow.holder && (await page.evaluate(() => window.__server.products.at(-1).sku)) === 'SKU-R10' && (await sheetNow()).changes === JSON.stringify({ [realId]: { price: 9 } }), JSON.stringify({ savedRow, realId, now: await sheetNow(), errors: errors.slice(errorsSeen) }))

    // Tabulator's keybindings read a character as its code: ( is 40, ArrowDown's; & 38, ArrowUp's; # 35, End's; ! 33, PageUp's.
    // On a layout where they are keys of their own (no Shift) they are still text: on a selected cell, in an open editor, on a cell without one.
    await fresh()
    errorsSeen = errors.length
    await scrollToRow(50)
    await atRest()
    const sendKey = (key) => page.evaluate((k) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(e); return e.defaultPrevented }, key)
    const stray = []
    for (const key of ['(', '&', '#', '!', '$', '"', '\'', '%']) {
        await (await cellOf(50, 'name')).click()
        const x0 = await inEditor()
        await sendKey(key)
        await page.waitForTimeout(120)
        const opened = await inEditor()
        const prevented = await sendKey(key)
        await page.waitForTimeout(120)
        const again = await inEditor()
        await press('Escape')
        await (await cellOf(50, 'margin')).click()
        await sendKey(key)
        await page.waitForTimeout(120)
        const computed = await inEditor()
        if (! opened.editing || opened.cell !== '50/name' || opened.input !== key || opened.scrollTop !== x0.scrollTop || prevented || ! again.editing || again.cell !== '50/name' || again.input !== key || again.scrollTop !== x0.scrollTop || again.dirty !== 0 || computed.editing || computed.active !== '50/margin' || computed.scrollTop !== x0.scrollTop || computed.dirty !== 0) stray.push({ key, opened, prevented, again, computed })
    }
    check('the characters ( & # ! $ " \' % sent as keys of their own are text: on a selected cell they open its editor with the character, in an open editor they are left to the field, on a computed cell they do nothing; the grid neither moves, scrolls nor writes', clean() && stray.length === 0, JSON.stringify({ stray, errors: errors.slice(errorsSeen) }))

    // a boolean has no editor: a character or F2 on it opens nothing and throws nothing (Tabulator's cell.edit() would), Space still flips it
    await fresh()
    errorsSeen = errors.length
    const noEditor = []
    for (const field of ['is_active', 'margin']) {
        await (await cellOf(3, field)).click()
        const before = await valueOf(3, field)
        for (const key of ['x', '1', '(', 'F2', 'sent (']) {
            if (key.startsWith('sent ')) await sendKey(key.slice(5))
            else await page.keyboard.press(key)
            await page.waitForTimeout(120)
            const now = await inEditor()
            if (now.editing || now.active !== `3/${field}` || now.dirty !== 0 || (await valueOf(3, field)) !== before || now.scrollTop !== 0) noEditor.push({ field, key, now, value: await valueOf(3, field) })
        }
    }
    await (await cellOf(3, 'is_active')).click()
    const keyedBefore = await valueOf(3, 'is_active')
    await press(' ')
    const keyedFlip = { ...(await inEditor()), value: await valueOf(3, 'is_active') }
    check('a character or F2 on a boolean cell opens nothing, changes nothing and throws nothing, as on a computed cell; Space still flips the boolean', clean() && noEditor.length === 0 && ! keyedFlip.editing && keyedFlip.value === ! keyedBefore && keyedFlip.dirty === 1 && keyedFlip.active === '3/is_active', JSON.stringify({ noEditor, keyedBefore, keyedFlip, errors: errors.slice(errorsSeen) }))

    // with the add-row shortcut on another key, Ctrl+Enter is nobody's: on a boolean it is not a flip and never Tabulator's Enter (which would throw)
    await fresh('?addrow=mod%2Bshift%2Ba')
    errorsSeen = errors.length
    await (await cellOf(3, 'is_active')).click()
    const reboundBefore = await valueOf(3, 'is_active')
    const rebound = []
    for (const combo of ['Control+Enter', 'Meta+Enter']) {
        await press(combo, 200)
        rebound.push({ combo, ...(await inEditor()), value: await valueOf(3, 'is_active'), rows: (await state()).rows })
    }
    await press('Enter', 200)
    const reboundEnter = { ...(await inEditor()), value: await valueOf(3, 'is_active') }
    await press('Control+Shift+a', 300)
    const reboundAdd = await page.evaluate(() => window.sheet().buffer.createdOrder.length)
    check('with add row bound to another key, Ctrl+Enter and Meta+Enter on a boolean do nothing and throw nothing; Enter still flips it and the new key adds the row', clean() && rebound.every((x) => ! x.editing && x.value === reboundBefore && x.dirty === 0 && x.active === '3/is_active' && x.rows === 100) && reboundEnter.value === ! reboundBefore && reboundEnter.dirty === 1 && reboundAdd === 1, JSON.stringify({ rebound, reboundBefore, reboundEnter, reboundAdd, errors: errors.slice(errorsSeen) }))

    // Alt+ArrowLeft / Alt+ArrowRight are the browser's (Back / Forward): the grid neither moves nor prevents them; the plain arrows still move
    await fresh()
    errorsSeen = errors.length
    await page.evaluate(() => { window.__alt = []; window.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') window.__alt.push(e) }, true) })
    await (await cellOf(3, 'category_id')).click()
    const altSeen = []
    for (const combo of ['Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Shift+ArrowRight']) {
        await press(combo)
        const now = await inEditor()
        const sel = await page.evaluate(() => { const x = window.sheet().grid.selection(); return `${x.rows.length}x${x.cols.length}` })
        altSeen.push({ combo, active: now.active, editing: now.editing, sel, holder: await page.evaluate(() => !! document.activeElement?.classList.contains('tabulator-tableholder')) })
    }
    await press('ArrowLeft')
    const plainLeft = (await inEditor()).active
    await press('ArrowRight')
    const plainRight = (await inEditor()).active
    const altEvents = await page.evaluate(() => window.__alt.map((e) => ({ key: e.key, alt: e.altKey, prevented: e.defaultPrevented })))
    check('Alt+ArrowLeft and Alt+ArrowRight on a selected cell are left to the browser: not prevented, the active cell and the range stay; the plain arrows still move it', clean() && altSeen.every((x) => x.active === '3/category_id' && ! x.editing && x.sel === '1x1' && x.holder) && plainLeft === '3/name' && plainRight === '3/category_id' && altEvents.length === 5 && altEvents.filter((e) => e.alt).length === 3 && altEvents.every((e) => e.prevented === ! e.alt), JSON.stringify({ altSeen, plainLeft, plainRight, altEvents, errors: errors.slice(errorsSeen) }))

    // the keyboard-only pass: no pointer from the load to the save
    await fresh()
    errorsSeen = errors.length
    const here = async () => { const a = (await state()).active; return a && `${a.id}/${a.col}` }
    const focusOnLoad = await page.evaluate(() => !! document.activeElement?.classList.contains('tabulator-tableholder'))
    const startAt = await here()
    await press('ArrowDown', 60)
    await press('ArrowDown', 60)
    await press('ArrowRight', 60)
    const path = [await here()]
    await page.keyboard.type('Keyboard only')
    await press('Tab')
    path.push(await here())
    const categoryBefore = await valueOf(3, 'category_id')
    await press('F2', 300)
    await press('ArrowDown')
    await press('Enter')
    path.push(await here())
    await press('ArrowUp', 60)
    await press('ArrowRight', 60)
    path.push(await here())
    await page.keyboard.type('12.5')
    await press('Tab')
    await press('ArrowRight', 60)
    await press('ArrowRight', 60)
    path.push(await here())
    const activeBefore3 = await valueOf(3, 'is_active')
    await press(' ')
    await press('ArrowRight', 60)
    path.push(await here())
    for (const digit of '11112027') await press(digit, 50)
    await press('Enter')
    path.push(await here())
    const typedAll = await page.evaluate(() => JSON.stringify(window.sheet().buffer.changes))
    await press('Control+z')
    await press('Control+z')
    const undone = await page.evaluate(() => JSON.stringify(window.sheet().buffer.changes))
    await press('Control+y')
    const savesPass = await page.evaluate(() => window.__server.calls.save.length)
    await page.keyboard.press('Control+s')
    await page.waitForFunction((n) => ! window.sheet().saving && window.__server.calls.save.length === n + 1, savesPass, { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(150)
    const pass = await page.evaluate(() => { const c = window.__server.calls.save.at(-1); const p = window.__server.products.find((x) => x.id === '3'); return { changed: JSON.stringify(c?.changed), created: JSON.stringify(c?.created), deleted: JSON.stringify(c?.deleted), server: { name: p.name, category_id: p.category_id, price: p.price, is_active: p.is_active, available_on: p.available_on }, holder: !! document.activeElement?.classList.contains('tabulator-tableholder') } })
    s = await state()
    const want = { name: 'Keyboard only', category_id: '2', price: 12.5, is_active: ! activeBefore3 }
    check('a keyboard-only pass (arrows to a text cell, text, Tab, a select by F2 / ArrowDown / Enter, a number, a boolean by Space, a date typed on the cell, Enter, Ctrl+Z twice, Ctrl+Y, Ctrl+S) saves exactly what was typed and kept, the focus on the grid throughout', clean() && focusOnLoad && startAt === '1/sku' && path.join() === '3/name,3/category_id,4/category_id,3/price,3/is_active,3/available_on,4/available_on' && categoryBefore === '1' && typedAll === JSON.stringify({ 3: { ...want, available_on: '2027-11-11' } }) && undone === JSON.stringify({ 3: { name: want.name, category_id: want.category_id, price: want.price } }) && pass.changed === JSON.stringify({ 3: want }) && pass.created === '{}' && pass.deleted === '[]' && pass.server.name === want.name && String(pass.server.category_id) === '2' && pass.server.price === 12.5 && pass.server.is_active === want.is_active && pass.holder && s.dirty.total === 0 && ! s.editing, JSON.stringify({ focusOnLoad, startAt, path, categoryBefore, typedAll, undone, pass, dirty: s.dirty, errors: errors.slice(errorsSeen) }))

    // the listeners go with the sheet
    const keyListener = await page.evaluate(() => {
        const el = window.sheet().grid.table.element
        const calls = []
        const orig = el.removeEventListener
        el.removeEventListener = function (type, listener, options) { calls.push(type + ':' + String(options)); return orig.call(this, type, listener, options) }
        window.sheet().grid.destroy()

        return calls.includes('keydown:true') && calls.includes('keyup:true')
    })
    check('destroying the grid removes the editor-key listeners (keydown, and the keyup kept from the select list)', keyListener)

    /* ---------------------------------------------------------------- a formula column follows the row's unsaved cells */

    await fresh()
    errorsSeen = errors.length
    const marginOf = async () => ({ value: await page.evaluate(() => window.sheet().grid.value('1', 'margin')), text: (await cell(0, 'margin').innerText()).trim() })
    const formulaBefore = await marginOf()
    await cell(0, 'cost').click()
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(80)
    const formulaEdited = await marginOf()
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(80)
    const formulaUndone = await marginOf()
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(80)
    await page.locator('.ps-sheet-toolbar .ps-sheet-btn-primary').click()
    await page.waitForFunction(() => ! window.sheet().saving && window.sheet().dirty.total === 0)
    await page.waitForTimeout(80)
    const formulaSaved = await marginOf()
    await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).click()
    await page.waitForTimeout(150)
    const temp = await page.evaluate(() => window.sheet().buffer.createdOrder[0])
    const formulaNew = await page.evaluate((id) => window.sheet().grid.value(id, 'margin'), temp)
    check('a formula cell follows an unsaved edit (13.70 − 10 = 3.70), the undo and the save; a new row\'s is empty', formulaBefore.value === 6.6 && formulaBefore.text === '6.60' && formulaEdited.value === 3.7 && formulaEdited.text === '3.70' && formulaUndone.value === 6.6 && formulaSaved.value === 3.7 && formulaSaved.text === '3.70' && formulaNew === null && errors.length === errorsSeen, JSON.stringify({ formulaBefore, formulaEdited, formulaUndone, formulaSaved, formulaNew, errors: errors.slice(errorsSeen) }))

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

    // Back with unsaved cells, cancelled: the sheet goes back to the entry it was on (the URL it has by then, here one a
    // #[Url] property pushed), by the Navigation API, without asking twice and without a new history entry (a pushState
    // of its first URL left Livewire's snapshot cache on the other page). The popstate listener stands in for Livewire's.
    await fresh()
    await page.evaluate(() => {
        window.__popNavigate = () => document.dispatchEvent(new CustomEvent('livewire:navigate', { cancelable: true, detail: { history: true } }))
        window.addEventListener('popstate', window.__popNavigate)
        history.pushState({ sheet: true }, '', `${location.pathname}?sheet=2`)
    })
    await cell(0, 'name').click()
    await page.keyboard.type('Unsaved')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(80)
    const backEntries = await page.evaluate(() => ({ index: navigation.currentEntry.index, length: navigation.entries().length }))
    const backAsked = dialogs
    dismissDialogs = true
    await page.evaluate(() => history.back())
    await page.waitForTimeout(500)
    dismissDialogs = false
    const backAfter = await page.evaluate(() => ({ search: location.search, index: navigation.currentEntry.index, length: navigation.entries().length, dirty: window.sheet().dirty.total, returning: !! window.sheet()._returning }))
    await page.evaluate(() => window.removeEventListener('popstate', window.__popNavigate))
    check('Back with unsaved cells, cancelled, returns to the sheet\'s entry and URL, asked once, no entry added', dialogs - backAsked === 1 && backAfter.search === '?sheet=2' && backAfter.index === backEntries.index && backAfter.length === backEntries.length && backAfter.dirty === 1 && ! backAfter.returning, JSON.stringify({ backEntries, backAfter, asked: dialogs - backAsked }))
    await fresh()

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

    // a frozen column's header and cells are opaque: the columns scrolling under them never show through (the head and range tints are translucent)
    await fresh()
    const frozen = await page.evaluate(() => { const h = getComputedStyle(document.querySelector('.tabulator-header .tabulator-col.tabulator-frozen[tabulator-field="sku"]')); const c = getComputedStyle(document.querySelector('.tabulator-tableholder .tabulator-row .tabulator-cell.tabulator-frozen[tabulator-field="sku"]')); return { headerImage: h.backgroundImage, headerColor: h.backgroundColor, cellColor: c.backgroundColor } })
    check('a frozen column header and its cells paint an opaque background', frozen.headerImage.includes('linear-gradient') && ! /rgba\(0, 0, 0, 0\)|transparent/.test(frozen.headerColor) && ! /rgba\(0, 0, 0, 0\)|transparent/.test(frozen.cellColor), JSON.stringify(frozen))

    // the errors badge sits in the footer beside the status line
    check('the errors badge is in the footer status line', await page.evaluate(() => !! document.querySelector('.ps-sheet-footer .ps-sheet-status .ps-sheet-pill-errors') && ! document.querySelector('.ps-sheet-toolbar .ps-sheet-pill-errors')))

    // the filters behind a funnel button: the panel opens, a pick narrows the rows and counts on the button, Reset clears
    await fresh('?filters=dropdown')
    const dropdownShape = await page.evaluate(() => ({ btn: !! document.querySelector('.ps-sheet-filters-btn')?.getClientRects().length, inline: !! document.querySelector('.ps-sheet-filters-inline'), above: !! document.querySelector('.ps-sheet-filters-above'), panelOpen: !! document.querySelector('.ps-sheet-filters-panel')?.getClientRects().length }))
    await page.locator('.ps-sheet-filters-btn').click()
    await page.waitForTimeout(250)
    const panelOpen = await page.evaluate(() => !! document.querySelector('.ps-sheet-filters-panel')?.getClientRects().length)
    await page.locator('.ps-sheet-filters-panel .ps-sheet-filter select').first().selectOption('1')
    await page.waitForFunction(() => window.sheet().rows.length < 100 && ! window.sheet().loading)
    const picked = await page.evaluate(() => ({ rows: window.sheet().rows.length, count: document.querySelector('.ps-sheet-filters-count')?.textContent.trim(), reset: !! document.querySelector('.ps-sheet-filters-reset')?.getClientRects().length }))
    await page.locator('.ps-sheet-filters-reset').click()
    await page.waitForFunction(() => window.sheet().rows.length === 100 && ! window.sheet().loading)
    const reset = await page.evaluate(() => ({ count: document.querySelector('.ps-sheet-filters-count')?.getClientRects().length ?? 0, value: document.querySelector('.ps-sheet-filters-panel .ps-sheet-filter select').value }))
    check('filtersLayout dropdown: a funnel button opens the filters, a pick narrows the rows and is counted on the button, Reset filters clears them', dropdownShape.btn && ! dropdownShape.inline && ! dropdownShape.above && ! dropdownShape.panelOpen && panelOpen && picked.rows < 100 && picked.count === '1' && picked.reset && reset.count === 0 && reset.value === '', JSON.stringify({ dropdownShape, panelOpen, picked, reset }))
    await fresh('?filters=above')
    const above = await page.evaluate(() => ({ above: !! document.querySelector('.ps-sheet-filters-above .ps-sheet-filter select')?.getClientRects().length, toolbar: !! document.querySelector('.ps-sheet-toolbar .ps-sheet-filter'), btn: !! document.querySelector('.ps-sheet-filters-btn') }))
    check('filtersLayout above: the filters on a row of their own under the toolbar', above.above && ! above.toolbar && ! above.btn, JSON.stringify(above))

    // the shortcuts: a "?" button opens Filament's modal with every shortcut as bound; Escape closes it and hands the keyboard back to the grid
    await fresh()
    await page.locator('.ps-sheet-help-btn').click()
    await page.waitForTimeout(400)
    const help = await page.evaluate(() => { const m = document.querySelector('.ps-sheet-help'); return { open: m.classList.contains('fi-modal-open'), items: m.querySelectorAll('.ps-sheet-shortcut').length, first: m.querySelector('.ps-sheet-shortcut dd').textContent.trim(), expected: window.sheet().keyLabel('save') } })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const helpClosed = await page.evaluate(() => ({ open: document.querySelector('.ps-sheet-help').classList.contains('fi-modal-open'), focus: !! document.activeElement?.closest('.ps-sheet-grid') }))
    check('the help button opens the shortcuts modal with the bound keys; Escape closes it and the grid has the keyboard again', help.open && help.items === 14 && help.first === help.expected && ! helpClosed.open && helpClosed.focus, JSON.stringify({ help, helpClosed }))

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
    check('a read-only sheet takes no typing, no paste, and disables Save and Add row', s.dirty.total === 0 && ! s.editing && (await page.locator('.ps-sheet-toolbar .ps-sheet-btn-primary').isDisabled()) && (await page.locator('.ps-sheet-pill-readonly').isVisible()) && ! (await page.locator('.ps-sheet-btn', { hasText: 'Add row' }).isVisible()), JSON.stringify(s.dirty))

    // Enter on a boolean or a computed cell of a read-only sheet: no editor to open, nothing thrown, nothing changed
    errorsSeen = errors.length
    const readOnlyEnter = []
    for (const field of ['is_active', 'margin']) {
        await cell(0, field).click()
        const before = await page.evaluate((f) => window.sheet().grid.value('1', f), field)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
        s = await state()
        readOnlyEnter.push({ field, same: (await page.evaluate((f) => window.sheet().grid.value('1', f), field)) === before, editing: s.editing, dirty: s.dirty.total, active: `${s.active?.id}/${s.active?.col}` })
    }
    check('Enter on a boolean and on a computed cell of a read-only sheet does nothing and throws nothing', errors.length === errorsSeen && readOnlyEnter.every((x) => x.same && ! x.editing && x.dirty === 0 && x.active === `1/${x.field}`), JSON.stringify({ readOnlyEnter, errors: errors.slice(errorsSeen) }))
} catch (e) {
    check('the run did not throw', false, String(e.stack ?? e))
} finally {
    await page.screenshot({ path: join(shots, 'final.png') }).catch(() => {})
    await browser.close()
    server.close()
}

const tabulatorWarnings = [...new Set(logged.filter((m) => /^Invalid (column definition|table constructor) option/.test(m)))]
check('Tabulator warns about no option it does not know (one its modules would read but is not registered)', ! tabulatorWarnings.length, tabulatorWarnings.join(' | '))
if (errors.length) check('no console or page errors', false, errors.join(' | '))
else check('no console or page errors', true)

const failed = results.filter((r) => ! r.ok)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots in ${shots}`)
process.exit(failed.length ? 1 : 0)
