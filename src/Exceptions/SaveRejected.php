<?php

namespace Packstub\Spreadsheet\Exceptions;

use RuntimeException;

/**
 * Thrown from beforeSave(), mutateRowBeforeSave() or afterSave() to refuse a
 * save with a message the user sees. Any other exception is reported and the
 * user sees a generic one: an exception's text is for the log.
 */
class SaveRejected extends RuntimeException {}
