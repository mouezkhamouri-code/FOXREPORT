<?php
declare(strict_types=1);
require_once __DIR__ . '/build-version.php';

function foxAsset(string $path): string
{
    return $path . '?v=' . rawurlencode(FOXREPORT_VERSION);
}
