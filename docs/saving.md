# Saving

<!-- TODO screenshot: after a save with two refused cells, red, one with its message shown -->

## One batch

Save (or Ctrl+S) sends everything unsaved in one renderless Livewire call:

```json
{
    "changed": { "12": { "price": 19.5, "stock": 4 }, "40": { "name": "Mallet" } },
    "versions": { "12": "2026-10-14 10:00:00", "40": "2026-10-13 08:12:44" },
    "created": { "n1": { "sku": "H-2", "name": "Hammer", "stock": 0, "is_active": true } },
    "deleted": ["7"]
}
```

`Spreadsheet::save()` reads it strictly (a key that is not a scalar, a row that is not an object, a column that is not a string: dropped), then for each row:

1. loads the record through the sheet's `query()` (a record outside it "is no longer in the sheet");
2. checks the ability: `canUpdate()`, `canCreate()`, `canDelete()` ([Authorization](authorization.md));
3. compares the version ([Conflicts](#conflicts));
4. coerces every value by its column, and refuses a column the sheet does not have, a computed or read-only column, or a cell locked for that record ("This cell cannot be edited.");
5. validates with Laravel's validator: the changed columns' rules for an update, every editable column for a new row (defaults filled in), a `unique` rule ignoring the record. Every error of a row comes back at once;
6. runs `mutateRowBeforeSave()`, `forceFill()`s and saves (the sheet's columns are the whitelist; the model's `$fillable` is not consulted). Deletions call `delete()` on the record, so soft deletes and model events apply.

The answer carries the saved rows as they are after casts, mutators and database defaults (a `strtoupper` mutator on the SKU shows at once), plus, per key, the cell errors, the row errors and the conflicts. The browser clears what was saved, keeps and paints what was not.

## All-or-nothing versus per-row

```php
->saveMode(SaveMode::AllOrNothing)   // the default, or 'all_or_nothing' in the config
->saveMode(SaveMode::PerRow)
```

**AllOrNothing** wraps the batch in one transaction. One refused row (a rule, a policy, a conflict, a database error) rolls everything back; every error of every row still comes back, so the user fixes them all and saves once more. Right for data that must stay consistent as a set (prices and their costs, a schedule).

**PerRow** writes each row in its own transaction: the good rows commit, the refused ones come back with their reasons and stay in the sheet. Right for long lists where one bad cell should not hold up the rest.

In both modes a batch larger than `max_rows_per_save` (2,000 by default) is refused before anything is read.

## Conflicts

Every row the browser loads carries a **version**: the raw value of `updated_at` (or the column named by `versionColumn()` / the config's `version_column`, a `lock_version` integer for instance). A save sends, per changed row, the version the user saw. When it differs from the current one — someone else saved the record meanwhile — the row is refused as a conflict: the cell turns purple and shows the other user's value next to yours. Saving again wins (the browser now has the current version); undoing the cell keeps theirs.

`->versionColumn(false)` turns the check off: the last write wins. A model without timestamps has no version and behaves the same. `updated_at` has whole seconds, so two saves within one second are told apart only with a dedicated version column.

## Refusing a save

`beforeSave()` runs before anything is written and may throw `SaveRejected` with a message the user sees; `afterSave()` runs inside the transaction (an exception rolls the save back; a `SaveRejected` shows its message, anything else a generic one). Any other exception while writing (the database's, a hook's) is reported to the exception handler and answered with "The save did not go through.": an exception's text is for the log, never for the notification.

## Rows outside the sheet

A `PerRow` save can also delete through `spreadsheetDelete(ids)` / `Spreadsheet::delete(ids)`, the same checks applied. The toolbar itself marks rows and deletes them with the next Save, so a deletion can be undone until then.
