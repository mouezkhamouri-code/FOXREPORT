<?php
declare(strict_types=1);

// Copy to storage/private/maps.php; restrict this key to Maps Static API and server IPs.
return [
    'api_key' => '',
    'enabled' => false,
    // Enable only after verifying PDF use under your Google contract/permissions.
    'pdf_allowed' => false,
    'scale' => 2,
    // No persistent image cache is created. Each PDF generation requests a fresh image.
];
