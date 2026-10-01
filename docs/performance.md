# Performance

## What is queried when

- **A page of rows**: one query for the page (`paginate()`, with a count), through the sheet's `query()`. Eager-load what your columns read (`->query(fn () => Product::query()->with('category'))` for a `ComputedColumn` on `category.name`); a `SelectColumn::relationship()` does not need the relation loaded, it presents the foreign key.
- **Relationship options**: one query per `SelectColumn::relationship()` per request, cached on the definition. They travel to the browser with the sheet, so a list of thousands wants a narrowing closure.
- **A policy check per row** for `update` and `delete` while presenting a page (cheap PHP; keep the policy free of queries, or memoise in it).
- **A save**: one query to load every touched record by key, the writes, and one query to re-read the saved rows, plus whatever your rules do (`unique` is a query per row with it).

## Page sizes

The default page is 100 rows; the toolbar goes up to `max_per_page` (1,000). The grid renders only the rows in view (virtual DOM, both ways), so 1,000 rows scroll smoothly; the cost of a bigger page is the query, the JSON and the policy checks. A sheet of 10,000 rows is ten pages of 1,000 — the unsaved cells follow across pages, so a bulk change over several pages is one Save. For a fixed table of that size, sort by the key and let the user page.

## Saves

`max_rows_per_save` (2,000) caps a batch; the browser knows the cap, so a paste past the last row stops creating rows there and says how many lines were left out. A few hundred rows save in a fraction of a second in either mode; both run in one transaction with a savepoint per row (a `SAVEPOINT` / `RELEASE` pair around each write, cheap on every database). Heavy `afterSave()` work belongs in a queued job dispatched from the hook or from a `RowsSaved` listener.

## The bundle

Tabulator and the sheet's own code are one minified ES module (about 293 KB, 75 KB gzipped) and one stylesheet (42 KB, 6 KB gzipped), loaded on request only on pages that show a sheet (`x-load`), cached like any Filament asset. Pages without a sheet pay nothing.

## Locking

A save holds row locks only for the duration of its transaction. Conflict detection is optimistic (the version compare), so two users can edit the same page at once and only the rows they both changed are refused, one at a time.
