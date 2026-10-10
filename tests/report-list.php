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
listCheck(isset($reports[0]['address'], $reports[0]['contact_name'], $reports[0]['contact_phone']) && !isset($reports[0]['training_topics']), 'List includes quick contact fields but excludes checklist details');
$html = renderReportList($reports);
listCheck(str_contains($html, '&lt;script&gt;TEST&lt;/script&gt;') && !str_contains($html, '<script>'), 'Report title safely escaped');
listCheck(str_contains($html, 'index.php?id=1'), 'Report remains reopenable');
listCheck(str_contains($html, 'class="button button-primary report-card-open"') && str_contains($html, '>Ouvrir</a>')
    && strpos($html, '>Ouvrir</a>') < strpos($html, '>Actions</button>'), 'Explicit wide Open button precedes Actions; card has no overlay link');
listCheck(!str_contains($html, 'ARCHIVE') && !str_contains($html, 'Interventions récentes') && !str_contains($html, 'count-pill'), 'List displays cards without redundant heading or count');
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
foreach ([0=>'started',49=>'started',50=>'progress',99=>'progress',100=>'complete'] as $percent=>$tone) {
    $card=renderReportList([array_replace($reports[0], ['completion'=>['percent'=>$percent,'filled'=>0,'total'=>41]])]);
    listCheck(str_contains($card, 'report-card-' . $tone) && str_contains($card, $percent . ' %'), 'Exact color threshold and rate at ' . $percent . '%');
}
listCheck(substr_count($html, '<article class="report-card ') === 1 && !str_contains($html, '<table'), 'One compact card per report replaces table');
listCheck(str_contains($html, '<dialog id="report-actions-1"') && str_contains($html, 'aria-haspopup="dialog"')
    && str_contains($html, 'rapport.php?id=1') && str_contains($html, 'name="confirm_delete" value="1" required'), 'Action popup exposes preview and mandatory deletion checkbox');
listCheck(str_contains(renderReportList($reports), 'report-card-invalid'), 'Invalid completion has explicit error color');
$contactReport = array_replace($reports[0], ['address'=>'12 rue Test & Café', 'contact_name'=>'Marie <Test>', 'contact_phone'=>'+33 (0)6 12 34 56 78']);
$contactCard = renderReportList([$contactReport]);
listCheck(str_contains($contactCard, 'https://www.google.com/maps/search/?api=1&amp;query=12%20rue%20Test%20%26%20Caf%C3%A9')
    && str_contains($contactCard, 'https://www.waze.com/ul?q=12%20rue%20Test%20%26%20Caf%C3%A9&amp;navigate=yes'), 'Address offers encoded Maps and Waze links');
listCheck(str_contains($contactCard, 'Marie &lt;Test&gt;') && str_contains($contactCard, 'href="tel:+33612345678"'), 'Contact safely escaped and international phone omits optional national zero');
listCheck(strpos($contactCard, 'report-card-name') < strpos($contactCard, 'report-card-address')
    && strpos($contactCard, 'report-card-address') < strpos($contactCard, 'report-card-contact'), 'Address and contact appear immediately below restaurant');
listCheck(!str_contains(renderReportList([$reports[0]]), 'report-card-address'), 'Empty address does not create placeholder links');
listCheck(!str_contains(renderReportList([array_replace($contactReport, ['contact_phone'=>'javascript:alert(1)'])]), 'href="tel:'), 'Invalid phone never becomes a callable link');
