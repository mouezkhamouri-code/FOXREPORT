<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/report-delete.php';

function deleteCheck(bool $condition, string $label): void
{
    if (!$condition) { throw new RuntimeException('FAIL: ' . $label); }
    echo 'PASS: ' . $label . PHP_EOL;
}

class DeleteTestPDO extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return parent::prepare(str_replace(' FOR UPDATE', '', $query), $options);
    }
}
$pdo = new DeleteTestPDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE foxreport_reports (id INTEGER PRIMARY KEY, revision INTEGER, status TEXT)');
foreach (['foxreport_devices', 'foxreport_photos', 'foxreport_sync_operations'] as $table) {
    $pdo->exec('CREATE TABLE ' . $table . ' (report_id INTEGER)');
}
$id = random_int(1000000000, 2000000000);
$directory = dirname(__DIR__) . '/storage/photos/' . $id;
if (file_exists($directory)) { throw new RuntimeException('Test storage collision'); }
$name = str_repeat('a', 32) . '.jpg';
$other = $id + 1;
$pdo->exec("INSERT INTO foxreport_reports VALUES ($id, 3, 'finalized'), ($other, 1, 'draft')");
foreach (['foxreport_devices', 'foxreport_photos', 'foxreport_sync_operations'] as $table) {
    $pdo->exec("INSERT INTO $table VALUES ($id), ($other)");
}
mkdir($directory, 0700, true);
file_put_contents($directory . '/' . $name, 'synthetic test photo');
try {
    try {
        deleteReport($pdo, $id, 2);
        throw new LogicException('Stale version accepted');
    } catch (ReportConflict) {
        deleteCheck((int) $pdo->query('SELECT COUNT(*) FROM foxreport_reports')->fetchColumn() === 2
            && is_file($directory . '/' . $name) && !$pdo->inTransaction(), 'Stale deletion preserves report and photo');
    }
    $pdo->exec("CREATE TRIGGER reject_delete BEFORE DELETE ON foxreport_reports BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    try {
        deleteReport($pdo, $id, 3);
        throw new LogicException('Database failure ignored');
    } catch (PDOException) {
        deleteCheck((int) $pdo->query('SELECT COUNT(*) FROM foxreport_devices')->fetchColumn() === 2
            && is_file($directory . '/' . $name), 'Transaction failure rolls back dependent rows and keeps files');
    }
    $pdo->exec('DROP TRIGGER reject_delete');
    deleteCheck(deleteReport($pdo, $id, 3) === null && !file_exists($directory), 'Finalized report deleted with physical photos');
    foreach (['foxreport_reports', 'foxreport_devices', 'foxreport_photos', 'foxreport_sync_operations'] as $table) {
        deleteCheck((int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn() === 1, 'Only selected report removed from ' . $table);
    }
    try {
        deleteReport($pdo, $id, 3);
        throw new LogicException('Deleted report accepted');
    } catch (ReportConflict) {
        deleteCheck(!$pdo->inTransaction(), 'Already deleted report rejected as conflict');
    }
    deleteCheck(deleteReport($pdo, $other, 1) === null, 'Draft without photos can be deleted');
} finally {
    if (is_file($directory . '/' . $name)) { unlink($directory . '/' . $name); }
    if (is_dir($directory)) { rmdir($directory); }
}
