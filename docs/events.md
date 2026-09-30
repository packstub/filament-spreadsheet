# Events and hooks

## Hooks on the definition

```php
use Illuminate\Database\Eloquent\Collection;
use Packstub\Spreadsheet\Exceptions\SaveRejected;
use Packstub\Spreadsheet\SavePayload;

$spreadsheet
    ->beforeSave(function (SavePayload $payload): void {
        // Before anything is read or written. $payload->changed, ->versions, ->created, ->deleted, ->rowCount().
        throw_if($payload->rowCount() > 500, new SaveRejected('Save at most 500 rows at a time.'));
    })
    ->mutateRowBeforeSave(function (array $data, ?Product $record): array {
        // The coerced, validated values of one row, just before forceFill(). $record is null for a new row.
        return $data + ['updated_by' => auth()->id()];
    })
    ->afterSave(function (Collection $records): void {
        // Inside the transaction, once every row is written: the updated and created records.
        ProductIndexer::dispatch($records->modelKeys());
    });
```

`beforeSave()` and `afterSave()` refuse the whole save with a `SaveRejected`'s message; any other exception in `afterSave()` rolls the batch back in both modes (the hook runs after the rows, inside the batch's transaction; in `PerRow` mode each row is a savepoint of it) and the user sees a generic message while the exception is reported.

## Laravel events

```php
use Packstub\Spreadsheet\Events\RowsSaved;
use Packstub\Spreadsheet\Events\RowSaveFailed;
```

**`RowsSaved`** fires once per save that wrote something, after the transaction committed: `$updated` (a collection of the changed records), `$created` (the new ones), `$deleted` (the keys deleted), `$spreadsheet` (the definition's `key()`, the page class by default), and `records()` for updated and created together. Log it, sync a search index, notify a channel.

**`RowSaveFailed`** fires for every row a save refused: `$record` (null for a new row), `$data` (what the user sent for it), `$errors` (attribute → message), `$reason` (the row-level message: a denied policy, a conflict, a record gone), `$spreadsheet`.

```php
Event::listen(RowsSaved::class, function (RowsSaved $event) {
    activity()->withProperties(['keys' => $event->records()->modelKeys()])->log("Sheet {$event->spreadsheet} saved");
});
```

## Model events

Records are saved with `$record->save()` and deleted with `$record->delete()`: observers, `saving`/`saved`/`deleting` events, soft deletes and packages such as `spatie/laravel-activitylog` see every change as they do from a form. The sheet keeps no audit table of its own.

## Browser events

`$dispatch('packstub-spreadsheet-refresh')` anywhere on the page reloads the current page of rows (unsaved cells stay). The component's `spreadsheetSaved(SaveResult $result)` method is a hook after every save attempt for the page class.
