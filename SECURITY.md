# Security policy

Filament Spreadsheet lets panel users edit hundreds of records at once and save them in one batch. Every cell goes through your validation rules and the model's policy on the server, so the plugin's job is to make sure a save never writes a column, a row or a value the user may not change, never reaches a record outside the sheet's query, and never renders a cell as markup. Please report anything in that area privately so a fix can ship before details become public.

## Supported versions

Security fixes are released for the latest minor version of each supported release line.

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a vulnerability

Email **security@packstub.dev**. Do not open a public GitHub issue, discussion, or pull request for a security problem.

Include what you can: the package version (`composer show packstub/filament-spreadsheet`), the Filament version, whether the sheet is a `SpreadsheetResourcePage`, a `SpreadsheetPage` or the trait on your own component, the database driver, and a minimal reproduction.

What to expect: acknowledgment within 48 hours from a human, updates while we validate and fix, and coordinated disclosure with credit in the release notes unless you prefer otherwise.

## Scope

Highest priority:

- **Mass assignment**: writing a field that is not an editable column of the sheet (a hidden, computed, read-only or locked column, the key, timestamps, a tenant foreign key), or a relationship value outside the options the user may pick.
- **Authorization**: changing, creating or deleting a row the policy refuses (`canUpdate`, `canCreate`, `canDelete`), or a row outside the sheet's query (another tenant's record).
- **Validation**: a cell that skips the column's rules, or a save that bypasses the row version check and overwrites another user's change without a conflict.
- **Rendering**: a cell value, a select label, an error message or a column label that reaches the grid as HTML.

Also in scope: the pages, the trait, the renderless Livewire methods (`spreadsheetRows`, `spreadsheetSave`, `spreadsheetDelete`, the filter helpers), the browser bundle (Tabulator and the plugin's own code) and the published views and config.

Out of scope: vulnerabilities in Laravel, Filament, Livewire or Tabulator themselves (report upstream; we still ship a mitigation when the exposure is specific to this package), issues that need an already-compromised admin account or server, and missing hardening in your own application.

## Hardening guidance for integrators

- **Query is the boundary.** Every id the browser sends is resolved through the sheet's `query()`; scope it to the tenant, the team or the user. A resource page's `getEloquentQuery()` already is.
- **Policies decide per row.** A `SpreadsheetResourcePage` uses the resource's `canEdit`, `canCreate` and `canDelete`; elsewhere set `authorizeUpdate()`, `authorizeDelete()` and the create flag, or the sheet is editable by anyone who can open the page.
- **`SelectColumn::relationship()` lists the related model's query.** Narrow it with `modifyQueryUsing()` (or a global scope) in a multi-tenant app, or a user can pick another tenant's related record by id.
- **New rows need their tenant.** Filament sets it on a resource page; on a standalone sheet set it in `mutateRowBeforeSave()`.
- **Rules run on the server for every cell**, including pasted and new rows. A `TextColumn` without `maxLength()` is capped at 65,535 characters; set a tighter one where the column is shorter.
