<?php
declare(strict_types=1);

class ReportConflict extends RuntimeException {}

function lockReportVersion(PDO $pdo, int $reportId, int $expectedRevision, bool $allowFinalized = false): array
{
    $query = $pdo->prepare('SELECT id, revision, status FROM foxreport_reports WHERE id = ? FOR UPDATE');
    $query->execute([$reportId]);
    $report = $query->fetch(PDO::FETCH_ASSOC);
    if (!$report) {
        error_log('FoxReport save conflict; reason missing_report; report ' . $reportId . '; local ' . $expectedRevision);
        throw new ReportConflict('Ce rapport est introuvable ou a été supprimé. Votre copie locale est conservée ; créez une copie si nécessaire.');
    }
    if ((int) $report['revision'] !== $expectedRevision) {
        error_log('FoxReport revision conflict; report ' . $reportId . '; local ' . $expectedRevision . '; server ' . (int) $report['revision']);
        throw new ReportConflict('Ce rapport a été modifié ailleurs (version locale ' . $expectedRevision . ', serveur ' . (int) $report['revision'] . '). Votre version locale est conservée ; rechargez la version serveur ou créez une copie.');
    }
    if (!$allowFinalized && $report['status'] === 'finalized') {
        error_log('FoxReport save conflict; reason finalized; report ' . $reportId . '; local ' . $expectedRevision . '; server ' . (int) $report['revision']);
        throw new ReportConflict('Ce rapport est finalisé. Rouvrez-le explicitement avant modification.');
    }
    return $report;
}

function syncJson(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    exit;
}
