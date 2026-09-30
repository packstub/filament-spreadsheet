# Columns

<!-- TODO screenshot: a sheet with every column type, the select's list open -->

A column names an attribute of the model and says how it is read into the grid and written back. Every column lives in `Packstub\Spreadsheet\Columns`.

## Common options

```php
TextColumn::make('name')
    ->label('Product name')                  // default: the name, headlined ("category_id" → "Category")
    ->width(220)                             // pixels; default: what the content needs
    ->frozen()                               // pinned while scrolling sideways (the first column is, by config)
    ->readOnly()                             // never editable
    ->readOnly(fn (Product $p) => $p->is_locked) // not for some records: the cell is greyed and refused
    ->rules(['required', 'max:120'])         // Laravel rules (a list, "required|max:120", or fn (?Product $record): array)
    ->default('Untitled')                    // the value a new row starts with (a value or a closure)
    ->hidden(fn () => ! auth()->user()->isAdmin()) // left out of the sheet, never written
    ->sortable(false)                        // no sorting from the header (a computed column never sorts)
    ->placeholder('Optional')
```

Rules are validated with Laravel's validator, with the type's own rules added. A `unique` rule, as a string (`unique:products,sku`) or as `Rule::unique('products', 'sku')`, ignores the record being updated, so an unchanged SKU never conflicts with itself.

A column whose name contains a dot (`category.name`) reads through the relation and is read-only.

## `TextColumn`

```php
TextColumn::make('sku')->maxLength(32)
```

Strings. `maxLength()` adds a `max:` rule and tells the editor.

## `NumberColumn`

```php
NumberColumn::make('price')->decimals(2)->min(0)->max(9999)->step(0.5)
NumberColumn::make('stock')->integer()->min(0)
```

Numbers on the wire (a `decimal:2` cast's `"12.50"` becomes `12.5`). `decimals()` rounds what is saved and formats what is shown; `integer()` refuses fractions. `min()` and `max()` add rules. What a paste brings is read the same way on both sides: with both separators present the last one is the decimal mark (`1,234.50` and `1.234,50` are both 1234.5), a lone comma followed by one or two digits is a decimal mark (`0,5`), otherwise it groups thousands (`1,234`); spaces, thin spaces and apostrophes are ignored.

## `BooleanColumn`

```php
BooleanColumn::make('is_active')->default(true)
```

A tick or a cross; a double-click, Enter or Space flips it, Delete clears it (null). A paste accepts `1`/`0`, `true`/`false`, `yes`/`no`, `y`/`n`, `on`/`off` (and a few translations).

## `SelectColumn`

```php
SelectColumn::make('status')->options(['draft' => 'Draft', 'live' => 'Live'])
SelectColumn::make('status')->options(fn () => Status::pluck('label', 'code')->all())
SelectColumn::make('status')->options(Status::class)         // a backed enum; labels from HasLabel or the case name
SelectColumn::make('category_id')->relationship('category', 'name')
SelectColumn::make('category_id')->relationship('category', 'name', fn (Builder $query) => $query->where('active', true))
```

The key is stored, the label shown; the list editor filters as you type. A paste matches by label first (case and spaces aside), then by key. A value that is none of the options is refused. `relationship()` takes a `BelongsTo` on the model: the column is the foreign key, the options are the related records (their key, their `$titleAttribute`), loaded once per request, narrowed by the closure. Options are sent to the browser with the sheet, so keep the list to what a select can hold; a relation with thousands of records wants a narrowing closure.

## `DateColumn` and `DateTimeColumn`

```php
DateColumn::make('available_on')->format('d/m/Y')
DateTimeColumn::make('published_at')->format('M j, Y H:i')
```

For `date` and `datetime` casts (or plain `Y-m-d` / `Y-m-d H:i:s` strings). On the wire the value is ISO (`2026-02-28`, `2026-02-28 09:30:00`, the model's timezone as Eloquent reads it); the cell shows it in `format()` (default: the config's `date_format` / `datetime_format`) and edits it with the browser's date or date-time input. A paste is read as ISO or in the display format when it is numeric (`28/02/2026` for `d/m/Y`, `28.02.2026 09:30` for `d.m.Y H:i`, a `g:i a` time with am/pm); month names are shown but not read back. Nothing is guessed: `2026-02-30` or `tomorrow` are refused.

## `ComputedColumn`

```php
ComputedColumn::make('margin')->state(fn (Product $product) => $product->price - $product->cost)
ComputedColumn::make('category.name')
```

Read-only, computed from the record on every read (after a save too, so it follows the saved values). Without `state()` it reads the attribute or dotted path.

## Writing your own type

Extend `Column` (or one of the types) and override `getType()`, `presentValue()`, `coerce()` and `typeRules()`; the grid draws an unknown type as text. Anything the browser must know goes into `toArray()`.
