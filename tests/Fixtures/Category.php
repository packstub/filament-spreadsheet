<?php

namespace Packstub\Spreadsheet\Tests\Fixtures;

use Illuminate\Database\Eloquent\Model;

class Category extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected $casts = ['is_active' => 'boolean'];
}
