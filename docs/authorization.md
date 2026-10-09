# Authorization

Three layers, each checked on the server whatever the browser showed.

## Access to the page

A `SpreadsheetResourcePage` is reachable when the resource is (`viewAny`), like its list page; a `SpreadsheetPage` follows Filament's page `canAccess()`. `SheetAction` hides itself when the sheet page cannot be accessed.

## Per row: update, create, delete

On a resource page the resource decides, the way its edit page, create page and delete action do:

- a changed row must pass `ProductResource::canEdit($record)` (the policy's `update`);
- a new row must pass `canCreate()` (`create`);
- a deletion must pass `canDelete($record)` (`delete`).

On a standalone page, or when you prefer your own rule, set the closures; each replaces the policy check for that ability:

```php
->authorizeUpdate(fn (Product $product) => $product->owner_id === auth()->id())
->authorizeCreate(fn () => auth()->user()->can('create', Product::class))
->authorizeDelete(fn (Product $product) => false)
```

Without closures, a standalone page uses the model's policy when it has that ability (`Gate::getPolicyFor()`), and allows when it has none: the page's own access check is the gate then.

What the user sees: a row the policy will not let them update is **greyed** and refuses edits, pastes and fill-downs (the server refuses it again, "You cannot change this row."); a row they may not delete cannot be marked; without `create`, the Add row button is gone and a paste past the last row is skipped. A page with no row the user may edit or delete and no row to add wears the "Read-only" pill, as a `readOnly()` sheet does, so a viewer sees why nothing responds. The policy runs for every row of a page: see [Performance](performance.md#policies) when it reads a permission package.

## Per cell: read-only columns

```php
NumberColumn::make('cost')->readOnly()                                   // for everyone
NumberColumn::make('cost')->readOnly(fn (Product $p) => $p->is_locked)  // for some records
ComputedColumn::make('margin')                                           // always
```

A read-only cell is drawn on a muted background, opens no editor, is skipped by pastes and fill-downs, and is refused by the server ("This cell cannot be edited.") should anything reach it anyway.

## Read-only mode

```php
->readOnly()                                   // or ->readOnly(fn () => ! auth()->user()->can('update', Product::class))
```

The whole sheet becomes a viewer: no editing, no paste, no Save, no adding or deleting, a "Read-only" pill in the toolbar; the server refuses every save with "This sheet is read-only." Useful when a role may look but not touch, without a second page.

## What the browser can never do

Every renderless call is checked again by `Spreadsheet`: a record is loaded through the sheet's `query()` (never by key alone), a column must be one of the definition's and editable for that record, a sort must be on a sortable column, a filter value one the filter offered, a page size within the config. `SavePayload::fromArray()` keeps only well-formed keys and rows. Nothing a public Livewire method answers holds a model.
