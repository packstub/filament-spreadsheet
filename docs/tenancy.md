# Tenancy

## Resource pages

A `SpreadsheetResourcePage` in a panel with tenancy needs nothing extra. Its rows come from the resource's `getEloquentQuery()`, which Filament scopes to the current tenant (the tenancy global scope on the model, or `scopeEloquentQueryToTenant()`); a record of another tenant is outside the sheet's query, so it can neither be read nor written ("This row is no longer in the sheet." should a key be crafted).

New rows are created with `$record->save()` inside the panel's request, so Filament's `creating` observer on the resource's model associates them with the current tenant the way the resource's create page does. Nothing in the sheet writes the tenant key itself.

The resource's own abilities apply per row ([Authorization](authorization.md)); a policy that checks the tenant is honoured.

## Standalone pages

A `SpreadsheetPage` has no resource to inherit from: scope the query yourself, and set the tenant on new rows in `mutateRowBeforeSave()` if your model has no global scope or observer for it:

```php
->query(fn () => Product::query()->whereBelongsTo(Filament::getTenant()))
->mutateRowBeforeSave(fn (array $data, ?Product $record) => $record ? $data : $data + ['team_id' => Filament::getTenant()->getKey()])
```

## Relationship options

A `SelectColumn::relationship()` lists the related model's records; narrow them to the tenant with the closure when the related model has no global scope:

```php
SelectColumn::make('category_id')->relationship('category', 'name', fn (Builder $query) => $query->whereBelongsTo(Filament::getTenant()))
```
