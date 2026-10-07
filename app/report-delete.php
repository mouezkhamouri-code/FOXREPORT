<?php
declare(strict_types=1);

require_once __DIR__ . '/sync.php';

function deleteReport(PDO $pdo, int $id, int $revision): ?string
{
    $pdo->beginTransaction();
    try {
        lockReportVersion($pdo, $id, $revision, true);
        foreach (['foxreport_sync_operations', 'foxreport_devices', 'foxreport_photos', 'foxreport_reports'] as $table) {
            $statement = $pdo->prepare('DELETE FROM ' . $table . ' WHERE ' . ($table === 'foxreport_reports' ? 'id' : 'report_id') . ' = ?');
            $statement->execute([$id]);
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $exception;
    }

    // The database commit comes first: a failed transaction must keep its photos.
    $directory = dirname(__DIR__) . '/storage/photos/' . $id;
    if (!file_exists($directory)) { return null; }
    $cleaned = true;
    if (is_link($directory) || !is_dir($directory)) {
        $cleaned = false;
    } else {
        $files = scandir($directory);
        if ($files === false) {
            $cleaned = false;
        } else {
            foreach ($files as $name) {
                if ($name === '.' || $name === '..') { continue; }
                $path = $directory . DIRECTORY_SEPARATOR . $name;
                if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $name)
                    || is_link($path) || !is_file($path) || !unlink($path)) {
                    $cleaned = false;
                }
            }
            if ($cleaned && !rmdir($directory)) { $cleaned = false; }
        }
    }
    if (!$cleaned) {
        error_log('FoxReport deleted report photo cleanup failed; report ' . $id);
        return 'Rapport supprimé, mais le nettoyage de ses fichiers photo est incomplet. Demandez à l’administrateur de vérifier le stockage ; consultez le journal PHP.';
    }
    return null;
}
