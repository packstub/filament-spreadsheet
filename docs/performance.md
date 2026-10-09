# Performance

## What is queried when

- **A page of rows**: one query for the page (`paginate()`, with a count), through the sheet's `query()`. Eager-load what your columns read (`->query(fn () => Product::query()->with('category'))` for a `ComputedColumn` on `category.name`); a `SelectColumn::relationship()` does not need the relation loaded, it presents the foreign key.
- **Relationship options**: one query per `SelectColumn::relationship()` per request, cached on the definition. They travel to the browser with the sheet, so a list of thousands wants a narrowing closure.
- **A policy check per row** for `update` and `delete` while presenting a page: two gate calls per row, none on a `readOnly()` sheet for `update` and none for `delete` when the sheet is not `deletable()`. A policy that answers from a cached permission set is cheap; one that queries is not. See [Policies](#policies) below for the numbers.
- **A save**: one query to load every touched record by key, the writes, and one query to re-read the saved rows, plus whatever your rules do (`unique` is a query per row with it).

## Page sizes

The default page is 100 rows; the toolbar goes up to `max_per_page` (1,000). The grid has a height of its own (measured by default: the window below the grid's top edge, or less when the page has fewer rows, see [Styling](styling.md)) and scrolls inside it, the header and the toolbar staying in place. It builds elements only for the rows around the visible window (every column of those rows: a sheet has a dozen columns, the rows are the long axis): about 60 row elements in a grid of some 500 pixels, whether the page holds 100 rows or 1,000. So the number of elements follows the grid's height, not the page size, and the cost of a bigger page is the query, the JSON and the policy checks. A sheet of 10,000 rows is ten pages of 1,000 — the unsaved cells follow across pages, so a bulk change over several pages is one Save. For a fixed table of that size, sort by the key and let the user page.

## Policies

The gate runs for every row on the page, so what the policy does is multiplied by the page size. A policy that reads a permission through a role package (Shield over spatie/laravel-permission in teams mode, say) costs about half a millisecond per call through `Gate::allows()`: about 0.4 s of a 100-row page and close to 3 s of a 1,000-row page go to the two checks per row, against about 0.15 s for the rows themselves. Measure with `rows()` in Tinker if a page feels slow.

When the answer does not depend on the record (the usual case: "may this user update products?"), answer once per request:

```php
use Illuminate\Database\Eloquent\Model;

$sheet
    ->authorizeUpdate(fn (Model $record) => once(fn () => auth()->user()->can('update', Product::class)))
    ->authorizeDelete(fn (Model $record) => once(fn () => auth()->user()->can('delete', Product::class)));
```

`once()` memoises per request and per closure, so the gate runs once for the page and every row gets the same answer; the save path runs the same closures. Keep the per-record check when it matters (a row owned by another user), or memoise what does not vary: `$user->can('Update:Product')` once, the ownership compare per row.

## Saves

`max_rows_per_save` (2,000) caps a batch; the browser knows the cap, so a paste past the last row stops creating rows there and says how many lines were left out. A few hundred rows save in a fraction of a second in either mode; both run in one transaction with a savepoint per row (a `SAVEPOINT` / `RELEASE` pair around each write, cheap on every database). Heavy `afterSave()` work belongs in a queued job dispatched from the hook or from a `RowsSaved` listener.

## The bundle

Tabulator and the sheet's own code are one minified ES module (about 312 KB, 81 KB gzipped) and one stylesheet (42 KB, 7 KB gzipped), loaded on request only on pages that show a sheet (`x-load`), cached like any Filament asset. Pages without a sheet pay nothing.

## Locking

Editing takes no lock: conflict detection is optimistic (the version compare), so two users can edit the same page at once and only the rows they both changed are refused. A save locks the rows it updates or deletes (`SELECT … FOR UPDATE`; SQLite has no row locks and serialises writes instead) until its transaction ends, so two saves of the same row run one after the other and the second is answered with a conflict instead of overwriting the first.
