# Search, sort, filters, pagination

<!-- TODO screenshot: the toolbar with a search term, a filter set, "12 changes on 3 pages" -->

Everything the toolbar does happens on the server, one renderless call per change (`spreadsheetRows`), and none of it touches the unsaved cells.

## Search

```php
->searchable(['sku', 'name', 'category.name'])
```

The search box looks in these attributes with `like %term%` (`ilike` on Postgres); a dotted path searches a `BelongsTo`/`HasMany` relation's attribute. Wildcards in the term are escaped (with `!` and an explicit `ESCAPE` clause, which SQLite, MySQL and Postgres all parse), so `100%` finds `100% cotton`. The box debounces; the term is cut at 200 characters, and only the latest answer is shown when requests overlap. An answer that arrives while you are typing in a cell takes that cell first: what you typed becomes an unsaved change, then the new rows are shown.

## Sort

```php
->defaultSort('sku')          // or ('price', 'desc')
```

A click on a header sorts by that column, another click reverses it; the arrow shows which. Only a sortable column is accepted (a computed column and a dotted path are not; `->sortable(false)` opts a column out): anything else the browser could send falls back to the default sort. The primary key is always the tie-breaker, so pages never overlap.

A sortable column must be a real database column: the sort is an `ORDER BY` on it. A column backed by an accessor, a JSON path or a virtual attribute sorts to a query error ("The rows could not be loaded."), so mark it `->sortable(false)`.

## Filters

```php
->filters([
    Filter::select('category_id')->options(fn () => Category::pluck('name', 'id')->all()),
    Filter::select('status')->options(['live' => 'Live', 'draft' => 'Draft'])->label('State'),
    Filter::boolean('is_active'),
    Filter::dateRange('available_on'),
    Filter::select('warehouse')->options([...])->query(fn (Builder $query, string $value) => $query->whereHas('stocks', fn ($q) => $q->where('warehouse_id', $value))),
])
```

A select is a small native select in the toolbar (`Filter::select()`); `Filter::boolean()` is a yes/no select; `Filter::dateRange()` two date inputs, either side open. By default a select narrows `where(<name>, <value>)`, a boolean `where(<name>, true|false)`, a date range `where(<name>, >=, from)` and `where(<name>, <, the day after until)` (plain ranges, so the column's index stays in use). `query()` replaces the default. A value the filter did not offer, or a malformed date, is ignored: the browser cannot inject a raw value.

## Pagination

```php
->perPage(200)
```

The page size runs from 25 to `max_per_page` (1,000) in the toolbar; `perPage()` sets the initial one. Row numbers continue across pages. The grid scrolls inside its own height, the header and the toolbar staying in place, however many rows the page holds. Another page, page size, sort, search or filter result opens at its first row; the same page read again (a `packstub-spreadsheet-refresh`, the re-read after a save, Discard) stays where it was scrolled to, with the active cell and the selected range where they were (when that row is gone, on the row now at its place), so what you type next goes into the cell you were on. A sheet with 5,000 rows is five pages of 1,000 or fifty of 100; see [Performance](performance.md) for what fits.

## When a request fails

A page, a sort or a page size the server did not answer (the connection dropped, the session expired) is not shown as if it had been: the pager, the header arrow and the size select go back to what the rows on screen are, and the sheet says so. Next after that is the page after the one you see. The search text and the filters stay as typed, so the next request sends them again.

## Unsaved changes across all of that

Changed cells, new rows and deletion marks live in the browser and are keyed by record, not by position: change a price on page 1, search for something else, sort by stock, come back — the cell is still amber. The badge says "12 changes on 3 pages" so nothing is forgotten before Save; a Save sends every page's changes at once. New rows show at the bottom of whichever page is open; Add row scrolls the grid to the new one.
