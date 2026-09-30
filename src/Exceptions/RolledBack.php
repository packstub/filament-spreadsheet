<?php

namespace Packstub\Spreadsheet\Exceptions;

use RuntimeException;

/** Internal: unwinds the AllOrNothing transaction when a row was refused. */
final class RolledBack extends RuntimeException {}
