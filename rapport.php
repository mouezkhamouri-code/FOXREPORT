<?php
declare(strict_types=1);

require_once __DIR__ . '/app/auth.php';
requireFoxAuth();

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: private, no-store');

require_once __DIR__ . '/app/pdf.php';
require_once __DIR__ . '/app/device-catalogue.php';
require_once __DIR__ . '/app/training-catalogue.php';

$report = [];
$devices = [];
$photos = [];
if (isset($_GET['id'])) {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) {
        http_response_code(400);
        exit('Identifiant de rapport invalide.');
    }
    require_once __DIR__ . '/SERVEUR/db.php';
    if (!isset($pdo) || !$pdo instanceof PDO) {
        http_response_code(500);
        exit('La connexion FoxReport est indisponible.');
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    try {
        $database = $pdo->query('SELECT DATABASE()')->fetchColumn();
        if (!is_string($database) || stripos($database, 'planesto') !== false) {
            http_response_code(503);
            exit('FoxReport doit utiliser une base dédiée, distincte de PLANESTO.');
        }
        $query = $pdo->prepare('SELECT * FROM foxreport_reports WHERE id = ?');
        $query->execute([$id]);
        $report = $query->fetch();
        if ($report === false) {
            http_response_code(404);
            exit('Rapport introuvable.');
        }
        $query = $pdo->prepare('SELECT * FROM foxreport_devices WHERE report_id = ? ORDER BY id');
        $query->execute([$id]);
        $devices = $query->fetchAll();
        $deviceCategories += deviceCatalogueCategories(deviceCatalogue($pdo));
        try { loadTrainingChecklist($pdo); }
        catch (PDOException $exception) { error_log('FoxReport training checklist unavailable for PDF; SQLSTATE ' . $exception->getCode()); }
        $query = $pdo->prepare('SELECT * FROM foxreport_photos WHERE report_id = ? AND deleted_at IS NULL ORDER BY section_number, sort_order, id');
        $query->execute([$id]);
        $photos = $query->fetchAll();
    } catch (PDOException $exception) {
        error_log('FoxReport PDF data read failed: ' . $exception->getMessage());
        http_response_code(500);
        exit('Impossible de charger le rapport. Vérifiez le schéma FoxReport.');
    }
}

try {
    $pdf = renderReportPdf($report, $devices, $photos);
    $bytes = $pdf->output();
} catch (RuntimeException | JsonException | Dompdf\Exception $exception) {
    error_log('FoxReport PDF generation failed: ' . $exception->getMessage());
    http_response_code(500);
    exit('Le PDF ne peut pas être généré. Vérifiez les dépendances Composer, les extensions PHP et les photos du rapport.');
}

header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="foxreport-' . ($report === [] ? 'modele' : (int) $report['id']) . '.pdf"');
header('Content-Length: ' . strlen($bytes));
echo $bytes;
