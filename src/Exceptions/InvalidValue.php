<?php

namespace Packstub\Spreadsheet\Exceptions;

use InvalidArgumentException;

/** A cell value the column cannot read ("abc" in a number column); its message lands on the cell. Internal. */
class InvalidValue extends InvalidArgumentException {}
