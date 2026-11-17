# Upgrading

## 1.x

After every package update run `php artisan filament:assets` so the bundled grid and stylesheet in `public/` are the current ones.

### From 1.0.0-beta.1

- `creatable()`, `deletable()`, a column's `frozen()` and `sortable()` now take `bool|Closure`, and `width()` takes `int|string|null`. A subclass of `Spreadsheet` or of a column that overrides one of these methods, or redeclares its property, must take the wider type. Calling them needs no change.
- Filament 4.13.3 is the lowest supported 4.x and 5.8.3 the lowest 5.x: the releases before them carry security advisories.

The changelog lives in the repository: [CHANGELOG.md](https://github.com/packstub/filament-spreadsheet/blob/main/CHANGELOG.md).

## Planned

Ideas for later 1.x releases, in no promised order:

- A `Spreadsheet` form field on the same grid (rows × typed columns stored as JSON or on a relation, "paste into a repeater").
- An "Edit as sheet" action for relation managers.
