<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/pdf.php';
$source = file_get_contents(dirname(__DIR__) . '/index.php');
$start = strpos($source, 'function loadPostedDevices(');
$end = strpos($source, 'function loadUploads(');
eval(substr($source, $start, $end - $start));
foreach (['installed', 'configured', 'already_present', 'not_installed'] as $state) {
    $_POST = ['devices'=>[['category'=>'printer_wired', 'state'=>$state, 'serial_number'=>'TEST-STATE']]];
    $errors = [];
    $devices = loadPostedDevices($deviceCategories, $errors);
    if ($errors !== [] || $devices[0]['state'] !== $state) throw new RuntimeException('Device state rejected: ' . $state);
    $html = reportPdfHtml([], $devices, []);
    $warnings = substr_count($html, '<tr class="material-warning">');
    if ($state === 'not_installed') {
        if ($warnings !== 2 || substr_count($html, '>Non installé') !== 2) throw new RuntimeException('Non-installed devices must be labelled and orange in both lists.');
        if (!str_contains($html, 'class="evaluation-card material-warning"')) throw new RuntimeException('Installation summary must highlight remaining material.');
    } elseif ($warnings !== 0) throw new RuntimeException('Other device states must keep their existing style.');
}
$_POST = ['devices'=>[['category'=>'printer_wired', 'state'=>'invalid']]];
$errors = [];
loadPostedDevices($deviceCategories, $errors);
if ($errors === []) throw new RuntimeException('Invalid device state accepted.');
if (substr_count($source, '<option value="not_installed"') !== 2) throw new RuntimeException('Existing and new device rows need the option.');
echo "PASS: Device states, invalid input, both dropdowns and orange PDF rows.\n";
