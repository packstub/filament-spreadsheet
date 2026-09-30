/**
 * Builds resources/dist/spreadsheet.{js,css} from resources/{js,css}: Tabulator
 * (the modules grid.js registers, tree-shaken) plus the adapter and the Alpine
 * component into one ES module, and Tabulator's base stylesheet plus ours into
 * one CSS file. The output is committed; consumers run only `filament:assets`.
 *
 *   npm run build          once
 *   npm run dev            rebuild on change
 */

import * as esbuild from 'esbuild'
import { readFileSync, statSync } from 'node:fs'

const watch = process.argv.includes('--watch')

const version = JSON.parse(readFileSync(new URL('./node_modules/tabulator-tables/package.json', import.meta.url), 'utf8')).version

const common = {
    bundle: true,
    minify: true,
    legalComments: 'none',
    logLevel: 'info',
    target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
}

const js = {
    ...common,
    entryPoints: ['resources/js/spreadsheet.js'],
    outfile: 'resources/dist/spreadsheet.js',
    format: 'esm',
    banner: { js: `/* packstub/filament-spreadsheet — MIT. Bundles Tabulator ${version} (MIT, https://tabulator.info). */` },
}

const css = {
    ...common,
    entryPoints: ['resources/css/spreadsheet.css'],
    outfile: 'resources/dist/spreadsheet.css',
    banner: { css: `/* packstub/filament-spreadsheet — MIT. Bundles Tabulator ${version}'s stylesheet (MIT, https://tabulator.info). */` },
}

if (watch) {
    const contexts = await Promise.all([esbuild.context(js), esbuild.context(css)])
    await Promise.all(contexts.map((c) => c.watch()))
    console.log('watching resources/js and resources/css…')
} else {
    await Promise.all([esbuild.build(js), esbuild.build(css)])
    for (const file of ['resources/dist/spreadsheet.js', 'resources/dist/spreadsheet.css']) {
        console.log(`${file}: ${(statSync(file).size / 1024).toFixed(1)} KB`)
    }
}
