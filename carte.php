<?php
declare(strict_types=1);

require_once __DIR__ . '/app/auth.php';
requireFoxAuth(true);
require_once __DIR__ . '/app/maps.php';
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
try {
    $location = locationFields($_GET);
    if ($location['latitude'] === null) { throw new RuntimeException('Renseignez latitude et longitude pour afficher une carte.'); }
    $image = googleStaticImage($location, mapsConfig());
    header('Content-Type: image/png');
    echo $image;
} catch (RuntimeException $exception) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $exception->getMessage()], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}
