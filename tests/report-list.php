<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/report-list.php';

function listCheck(bool $condition, string $label): void
{
    if (!$condition) { throw new RuntimeException('FAIL: ' . $label); }
    echo 'PASS: ' . $label . PHP_EOL;
}

class ReportListTestStatement extends PDOStatement
{
    public function __construct(private array $rows) {}
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array { return $this->rows; }
}
class ReportListTestPDO extends PDO
{
    public function __construct(private array $columns, private array $rows) {}
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        return new ReportListTestStatement(str_starts_with($query, 'SHOW COLUMNS') ? $this->columns : $this->rows);
    }
}
$columns = array_merge(['id','revision','report_type','status','updated_at'], FOXREPORT_COMPLETION_FIELDS);
$row = array_fill_keys($columns, '');
$row = array_replace($row, [
    'id'=>1, 'revision'=>3, 'establishment'=>'<script>TEST</script>', 'report_date'=>'2026-10-07',
    'report_type'=>'Installation et formation Lightspeed', 'status'=>'draft', 'training_topics'=>'[]',
]);
$pdo = new ReportListTestPDO($columns, [$row]);
$reports = loadReportList($pdo);
listCheck(count($reports) === 1 && $reports[0]['completion']['filled'] === 2, 'List includes report and saved completion');
listCheck(!isset($reports[0]['contact_phone']) && !isset($reports[0]['training_topics']), 'List excludes detail fields');
$html = renderReportList($reports);
listCheck(str_contains($html, '&lt;script&gt;TEST&lt;/script&gt;') && !str_contains($html, '<script>'), 'Report title safely escaped');
listCheck(str_contains($html, 'index.php?id=1'), 'Report remains reopenable');
listCheck(str_contains(renderReportList($reports, 'test-token'), 'value="test-token"')
    && str_contains($html, 'name="revision" value="3"')
    && str_contains($html, 'name="confirm_delete"'), 'Delete form requires confirmation, CSRF and displayed revision');
$broken = array_replace($row, ['id'=>2,'training_topics'=>'not-json']);
$reports = loadReportList(new ReportListTestPDO($columns, [$row,$broken]));
listCheck(count($reports) === 2 && $reports[1]['completion'] === null && $reports[0]['completion'] !== null, 'Malformed checklist does not remove other reports');
listCheck(str_contains(renderReportList($reports), 'checklist invalide'), 'Invalid completion displayed explicitly');
try {
    loadReportList(new ReportListTestPDO(array_diff($columns,['latitude','longitude','map_zoom']), []));
    throw new LogicException('Missing migration was not detected');
} catch (RuntimeException $exception) {
    listCheck(str_contains($exception->getMessage(), '003-location.sql') && str_contains($exception->getMessage(), 'latitude'), 'Missing location migration diagnosed even for empty table');
}
listCheck(str_contains(renderReportList([]), 'Tout commence ici'), 'Valid empty list displays empty state');
listCheck(!str_contains(renderReportList([array_replace($reports[0], ['status'=>'finalized'])], '', 'open'), 'index.php?id=1'), 'Open filter excludes finalized reports');
listCheck(str_contains(renderReportList([array_replace($reports[0], ['status'=>'finalized'])], '', 'closed'), 'index.php?id=1'), 'Closed filter includes finalized reports');
