<?php
declare(strict_types=1);

require_once __DIR__ . '/app/auth.php';
requireFoxAuth(true);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; img-src 'self'; frame-ancestors 'none'");
header('Cache-Control: private, no-store');

require_once __DIR__ . '/SERVEUR/db.php';
if (!isset($pdo) || !$pdo instanceof PDO) {
    http_response_code(500);
    exit('La connexion FoxReport est indisponible.');
}
try {
    $connectedDatabase = $pdo->query('SELECT DATABASE()')->fetchColumn();
} catch (PDOException $exception) {
    error_log('FoxReport photo database check failed: ' . $exception->getMessage());
    http_response_code(500);
    exit('Impossible de vérifier la base FoxReport.');
}
if (!is_string($connectedDatabase) || stripos($connectedDatabase, 'planesto') !== false) {
    http_response_code(503);
    exit('FoxReport doit utiliser une base dédiée.');
}

$photoId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$photoId) {
    http_response_code(404);
    exit('Photo introuvable.');
}

try {
    $query = $pdo->prepare('SELECT report_id, stored_name, mime_type FROM foxreport_photos WHERE id = ? AND deleted_at IS NULL');
    $query->execute([$photoId]);
    $photo = $query->fetch(PDO::FETCH_ASSOC);
} catch (PDOException $exception) {
    error_log('FoxReport photo read failed: ' . $exception->getMessage());
    http_response_code(500);
    exit('La photo ne peut pas être lue. Vérifiez le schéma FoxReport.');
}
require_once __DIR__ . '/app/images.php';
if (!$photo) {
    http_response_code(404);
    exit('Photo introuvable.');
}

try {
    $photoPath = storedPhotoPath($photo);
} catch (RuntimeException $exception) {
    error_log('FoxReport photo path: ' . $exception->getMessage());
    http_response_code(404);
    exit('Photo introuvable.');
}

header('Content-Type: ' . $photo['mime_type']);
header('Content-Disposition: inline; filename="foxreport-photo.' . pathinfo($photoPath, PATHINFO_EXTENSION) . '"');
header('Content-Length: ' . (string) filesize($photoPath));
readfile($photoPath);
