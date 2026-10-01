# Editing

<!-- TODO screenshot: a range selected, the fill handle at its corner, dirty corners on a few cells -->

## Keyboard

| Keys | What happens |
| --- | --- |
| Click, arrows | Select a cell |
| Shift + arrows, Shift + click, drag | Select a range |
| Click a row number | Select the row (for deletion) |
| Enter, F2, double-click, or just typing | Edit the cell (typing replaces its content, Enter/F2 keep it) |
| Enter while editing | Commit and move down |
| Tab / Shift + Tab while editing | Commit and move right / left |
| Escape | Cancel the edit (the menu, too) |
| Delete, Backspace | Clear the selected cells (the ones you may edit: a locked, read-only or computed cell stays) |
| Enter, Space or a double-click on a boolean | Flip it |
| Ctrl + C | Copy the selection as tab-separated text (labels for selects, ISO dates, TRUE/FALSE) |
| Ctrl + X | Cut: copy the selection, then clear the cells you may edit |
| Ctrl + V | Paste at the selection (see below) |
| Ctrl + D | Fill the first row of the selection down into the rows below |
| Drag the small square at the selection's corner | Fill neighbouring cells |
| Ctrl + Z, Ctrl + Y (or Ctrl + Shift + Z) | Undo, redo — edits, pastes, fill-downs, new rows and deletions, across pages |
| Ctrl + S | Save |
| Ctrl + Enter | Add a row (when the sheet is creatable) |
| Right-click a row | The row menu (delete / keep) |

`mod` is Ctrl on Windows and Linux, ⌘ on macOS. The shortcuts for save, fill-down, undo, redo, add-row and cut can be changed in the config (`keybindings`). Ctrl+S works anywhere in the sheet; every other shortcut applies while the grid has the focus, so in the search box or a filter Ctrl+Z undoes your typing, not the sheet. A toolbar button hands the keyboard back to the grid: after a click on Undo, Ctrl+Y redoes; after Add row, Ctrl+Z takes the row away.

## Paste from Excel, Google Sheets or Numbers

Copy a block in your spreadsheet, select the top-left cell in the sheet, Ctrl+V. The block lands there, column by column, each cell read by the column's type ([Columns](columns.md)): `1 234,50` becomes 1234.5 in a number column, `Paint` the option with that label in a select, `yes` a tick, `28/02/2026` a date when the column shows `d/m/Y`. Quoted cells (a newline inside a cell) are read the way Excel writes them.

- A cell that cannot be read (`abc` in a number) is pasted as it is and painted red at once, with the reason on hover, in a new row too; the server would refuse it too. Fix it or undo.
- A cell that cannot be edited (a read-only column, a locked cell, a row you may not update) is skipped; the toolbar says how many were.
- Columns past the last one are ignored; rows past the last one become **new rows** when the sheet is `creatable()`, starting from the columns' defaults. New rows stop at the config's `max_rows_per_save` (2,000 by default, counting the changed and deleted rows too), and the toolbar says how many lines were left out: save, then paste the rest.
- One copied cell pasted over a selection fills the whole selection, as in Excel.
- A paste is one step for undo: Ctrl+Z takes the whole block back, the rows it created included.

## Fill down

Select a range whose first row holds the values you want, press Ctrl+D: every column of the range copies its first cell into the rows below, where the cell may be edited. Or drag the handle at the bottom-right corner of the selection.

## What a changed cell looks like

A changed cell keeps an amber corner until it is saved (or undone, or changed back to what the server sent, which is not a change at all). The toolbar counts them, and the pages they sit on: sorting, searching, filtering or paging never loses them. A red cell is one the column or the server refused, with the message on hover; a purple one changed on the server while you were editing ([Saving](saving.md#conflicts)).

## While a save is in flight

From Ctrl+S until the answer lands the sheet takes no edits: the grid is dimmed, the pointer shows progress, no editor opens, and a paste, fill-down, undo, new row or deletion does nothing. What is typed meanwhile is dropped, not queued (the answer replaces the saved cells with what the server wrote, and an edit made in between would have been lost with them). A save takes a moment only for a big batch or a slow connection; editing resumes the instant it is answered, and the toolbar buttons follow.

## Leaving the page

With unsaved changes, closing the tab or navigating away (Livewire's navigate too) asks first (`confirm_leave` in the config). Discard drops everything unsaved after a confirmation.
