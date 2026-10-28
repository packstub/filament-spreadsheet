# Adding and deleting rows

![A new row at the bottom marked with a plus, a row struck through for deletion](https://raw.githubusercontent.com/packstub/art/main/filament-spreadsheet/docs/rows.png)

## New rows

```php
->creatable()
```

shows the **Add row** button (Ctrl+Enter) and lets a paste past the last row create rows. A new row appears at the bottom of the page with a `+` in place of its number, scrolled into view with its first editable cell selected (so the next thing typed goes into it), and starts from the columns' `default()` values:

```php
NumberColumn::make('stock')->default(0),
BooleanColumn::make('is_active')->default(true),
SelectColumn::make('status')->default('draft'),
TextColumn::make('sku')->default(fn () => Sku::next()),
```

New rows travel with the next Save. The server validates each over **every** editable column (a `required` name is required even if the user never touched the cell), runs `mutateRowBeforeSave($data, null)`, creates the record with `forceFill()` and answers with the row as saved (its real key, its defaults from the database, its version); the browser replaces the pending row with it. `RowsSaved::$created` lists them.

Creating needs `creatable()` **and** the policy's `create` (or `authorizeCreate()`); otherwise the button is hidden and the server answers "You cannot add rows here." for every new row.

## Deleting rows

```php
->deletable()
```

shows the **Delete rows** button and the row menu's **Delete row**. Click a row's number (Shift for several), then Delete rows; or right-click the row (Shift+F10 or the menu key opens the same menu on the active cell's row). Delete on a selected row clears its cells, it does not mark the row. The row is struck through and marked for deletion, and deleted with the next Save — until then Ctrl+Z or the menu's **Keep row** takes the mark away. A new row that was never saved is simply dropped.

Deleting needs `deletable()` **and** the policy's `delete($record)` (or `authorizeDelete()`) for each record; a row the user may not delete cannot be marked, and the server refuses it again ("You cannot delete this row."). The record's `delete()` is called, so soft deletes and `deleting` observers apply. `RowsSaved::$deleted` lists the keys.

## Rows and the batch

Updates, creations and deletions of one Save share the transaction in `AllOrNothing` mode: a refused new row rolls the updates back too. In `PerRow` mode each stands alone. See [Saving](saving.md).
