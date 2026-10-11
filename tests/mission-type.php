<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/pdf.php';
// Exercise the real input validation without authentication or a production database.
$source = file_get_contents(dirname(__DIR__) . '/index.php');
$start = strpos($source, 'function scalarPost(');
$end = strpos($source, 'function loadPostedDevices(');
eval(substr($source, $start, $end - $start));
if (count(reportMissionTypes()) !== 7) throw new RuntimeException('Seven missions expected.');
foreach (reportMissionTypes() as $title) {
    $_POST = ['report_type' => $title];
    $errors = [];
    $data = loadPostedReport($errors);
    if ($errors !== [] || $data['report_type'] !== $title) throw new RuntimeException('Mission input rejected: ' . $title);
    $html = reportPdfHtml($data, [], []);
    if (!str_contains($html, '<div class="report-header-title">' . $title . '</div>')) {
        throw new RuntimeException('Mission missing from PDF header: ' . $title);
    }
}
$_POST = [];
$errors = [];
if (array_key_exists('report_type', loadPostedReport($errors))) throw new RuntimeException('Old clients must preserve the stored mission.');
foreach (['', '<script>invalid</script>', ['invalid']] as $invalid) {
    $_POST = ['report_type' => $invalid];
    $errors = [];
    loadPostedReport($errors);
    if ($errors === []) throw new RuntimeException('Invalid mission accepted.');
}
foreach ([null, '', 'Installation et formation Lightspeed'] as $legacy) {
    if (reportMissionTitle($legacy) !== DEFAULT_REPORT_MISSION) throw new RuntimeException('Legacy heading changed.');
}
echo "PASS: Seven mission inputs and PDF headers, legacy compatibility and invalid input rejection.\n";

$filename = reportPdfFilename(['report_type'=>'COMPTE RENDU ACCOMPAGNEMENT', 'establishment'=>"Café de l'été / Toulouse", 'report_date'=>'2026-10-08']);
if ($filename !== 'LightSpeed_accompagnement_Cafe_de_l_ete_Toulouse_10_2026.pdf') throw new RuntimeException('Unexpected filename: ' . $filename);
$unsafe = reportPdfFilename(['establishment'=>"Bad\r\n\"/../Name", 'report_date'=>'2026-01-05']);
if (!preg_match('/^LightSpeed_[A-Za-z0-9_]+_01_2026\.pdf$/', $unsafe)) throw new RuntimeException('Unsafe PDF filename.');
echo "PASS: PDF filenames use mission, sanitized restaurant and intervention month/year.\n";
