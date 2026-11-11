# Upgrading

## 1.x

The first release. Nothing to upgrade from yet. After every package update run `php artisan filament:assets` so the bundled grid and stylesheet in `public/` are the current ones.

The changelog lives in the repository: [CHANGELOG.md](https://github.com/packstub/filament-spreadsheet/blob/main/CHANGELOG.md).

## Planned

Ideas for later 1.x releases, in no promised order:

- A `Spreadsheet` form field on the same grid (rows × typed columns stored as JSON or on a relation, "paste into a repeater").
- An "Edit as sheet" action for relation managers.
