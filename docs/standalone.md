# A sheet outside a resource

## A standalone panel page

`SpreadsheetPage` is a normal Filament page (navigation, `canAccess()`, header actions as usual) holding one sheet with its own query:

```php
namespace App\Filament\Pages;

use App\Models\Product;
use Packstub\Spreadsheet\Columns\NumberColumn;
use Packstub\Spreadsheet\Columns\TextColumn;
use Packstub\Spreadsheet\Pages\SpreadsheetPage;
use Packstub\Spreadsheet\Spreadsheet;

class PriceList extends SpreadsheetPage
{
    protected static ?string $navigationLabel = 'Price list';

    public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet
            ->query(fn () => Product::query()->where('is_active', true))
            ->columns([
                TextColumn::make('sku')->readOnly(),
                NumberColumn::make('price')->decimals(2)->min(0),
            ])
            ->searchable(['sku'])
            ->authorizeUpdate(fn (Product $product) => auth()->user()->can('update', $product));
    }
}
```

`query()` is required here and is the single source of records: every read and every write goes through it. Without `authorize*()` closures the model's policy is used when it has the ability ([Authorization](authorization.md)).

## The trait in any Livewire component

The pages are thin: the sheet lives in `InteractsWithSpreadsheet`. Put it on any Livewire component and include the view:

```php
use Livewire\Component;
use Packstub\Spreadsheet\Concerns\InteractsWithSpreadsheet;
use Packstub\Spreadsheet\Spreadsheet;

class OrderLines extends Component
{
    use InteractsWithSpreadsheet;

    public Order $order;

    public function spreadsheet(Spreadsheet $spreadsheet): Spreadsheet
    {
        return $spreadsheet
            ->query(fn () => $this->order->lines()->getQuery())
            ->columns([...])
            ->mutateRowBeforeSave(fn (array $data, ?OrderLine $line) => $data + ['order_id' => $this->order->id])
            ->creatable();
    }

    public function render()
    {
        return view('livewire.order-lines'); // @include('packstub-spreadsheet::spreadsheet')
    }
}
```

The component needs no Filament actions or schemas: the sheet is renderless on the server. `getSpreadsheetHeight()` returns a CSS height for the grid, which scrolls inside it (`null`, the default, measures it: the window below the grid, shrunk to the rows, see [Styling](styling.md)); `spreadsheetSaved(SaveResult $result)` is a hook after every save.

## In a tab or a collapsed section

The sheet can be rendered where it is not visible yet: a Filament tab that is not the open one, a collapsed section, anything under `display: none`. It loads its first page as usual and draws the grid when it becomes visible; it also redraws when its size changes (the window resized), an open editor kept as it is. Nothing to call from your side. The measured height (the default) is taken when the sheet is shown; a length from `getSpreadsheetHeight()` must not depend on the hidden parent, as in [Styling](styling.md).
