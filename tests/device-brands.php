<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/report-definition.php';
require_once dirname(__DIR__) . '/app/device-catalogue.php';
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE foxreport_device_brands (brand_key TEXT PRIMARY KEY, name TEXT, archived INTEGER DEFAULT 0, ever_used INTEGER DEFAULT 0, revision INTEGER DEFAULT 1)');
$pdo->exec('CREATE TABLE foxreport_device_brand_deletions (brand_key TEXT PRIMARY KEY)');
$pdo->exec('CREATE TABLE foxreport_devices (report_id INTEGER, category TEXT, brand TEXT, model TEXT, serial_number TEXT, mac_address TEXT, location TEXT, state TEXT, comment TEXT, decoded_password TEXT)');
$pdo->exec('CREATE TABLE foxreport_device_types (category TEXT, label TEXT)');
$pdo->exec('CREATE TABLE foxreport_device_models (model_key TEXT, category TEXT, name TEXT)');
function checkBrand(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function expectBrandError(callable $action): void {
    try { $action(); } catch (RuntimeException $error) { return; }
    throw new RuntimeException('Invalid operation was accepted.');
}
$input = ['types'=>[], 'models'=>[], 'brands'=>[['brand_key'=>deviceBrandKey('EPSON'), 'name'=>'EPSON', 'archived'=>0]]];
$clean = deviceCatalogueInput(json_encode($input));
saveDeviceCatalogue($pdo, $clean);
ensureDeviceBrand($pdo, 'epson');
checkBrand(count(deviceCatalogue($pdo)['brands']) === 1, 'Case variants must not duplicate brands.');
$key = deviceBrandKey('EPSON');
changeDeviceBrand($pdo, $key, 'archive');
saveDeviceCatalogue($pdo, $clean);
checkBrand(deviceCatalogue($pdo)['brands'][0]['archived'] === 1, 'An old offline snapshot must not unarchive a brand.');
changeDeviceBrand($pdo, $key, 'restore');
checkBrand(deviceCatalogue($pdo)['brands'][0]['archived'] === 0, 'Restore must reactivate the brand.');
$pdo->beginTransaction(); ensureDeviceBrand($pdo, 'EPSON', true); $pdo->commit();
expectBrandError(fn()=>changeDeviceBrand($pdo, $key, 'delete'));
changeDeviceBrand($pdo, $key, 'archive');
checkBrand(deviceCatalogue($pdo)['brands'][0]['ever_used'] === 1, 'Historical usage must remain after removal of report devices.');
ensureDeviceBrand($pdo, 'Typo');
$typo = deviceBrandKey('Typo');
changeDeviceBrand($pdo, $typo, 'delete');
checkBrand(!ensureDeviceBrand($pdo, 'Typo'), 'Deleted unused brand must not be recreated by old offline catalogue.');
checkBrand(in_array($typo, deviceCatalogue($pdo)['deleted_brands'], true), 'Deleted key must refresh client caches.');
expectBrandError(fn()=>ensureDeviceBrand($pdo, 'Typo', true));
expectBrandError(fn()=>deviceCatalogueInput(json_encode(['types'=>[], 'models'=>[], 'brands'=>[['brand_key'=>'wrong', 'name'=>'Test']]])));
expectBrandError(fn()=>deviceCatalogueInput(json_encode(['types'=>[], 'models'=>[], 'brands'=>[$input['brands'][0], $input['brands'][0]]])));
ensureDeviceBrand($pdo, 'Rollback');
$pdo->beginTransaction(); ensureDeviceBrand($pdo, 'Rollback', true); $pdo->rollBack();
changeDeviceBrand($pdo, deviceBrandKey('Rollback'), 'delete');
checkBrand(count(deviceCatalogue($pdo)['brands']) === 1, 'Rolled back report saves must not mark a brand used.');
echo "PASS: Brand validation, deduplication, archive/restore, historical deletion protection and stale offline snapshots.\n";

require_once dirname(__DIR__) . '/app/sync.php';
require_once dirname(__DIR__) . '/app/photo-state.php';
$source = file_get_contents(dirname(__DIR__) . '/index.php');
$start = strpos($source, 'function saveReport(');
$end = strpos($source, "\n$" . 'errors = [];', $start);
eval(substr($source, $start, $end - $start));
$pdo->exec("CREATE TABLE foxreport_reports (id INTEGER PRIMARY KEY, revision INTEGER, status TEXT, training_topics TEXT)");
$pdo->exec("INSERT INTO foxreport_reports VALUES (1, 1, 'draft', '[]')");
$pdo->exec('CREATE TABLE foxreport_photos (id INTEGER PRIMARY KEY, report_id INTEGER, section_number INTEGER, stored_name TEXT, mime_type TEXT, caption TEXT, crop_format TEXT, client_uid TEXT, sort_order INTEGER, deleted_at TEXT)');
$device = ['category'=>'router', 'brand'=>'Nouvelle marque de brouillon', 'model'=>'Test', 'serial_number'=>'BRAND-001', 'mac_address'=>'', 'location'=>'', 'state'=>'installed', 'comment'=>'', 'decoded_password'=>''];
$pdo->beginTransaction();
saveReport($pdo, 1, ['training_topics'=>['items'=>[], 'legacy'=>[]]], [$device], [], 'draft', ['photo_order'=>[], 'photo_deleted'=>[], 'photo_captions'=>[]]);
$pdo->commit();
checkBrand($pdo->query('SELECT brand FROM foxreport_devices WHERE report_id = 1')->fetchColumn() === $device['brand'], 'Report save must persist the new brand.');
$catalogue = deviceCatalogue($pdo);
$usedBrand = array_values(array_filter($catalogue['brands'], static fn(array $brand): bool => $brand['name'] === $device['brand']))[0] ?? [];
checkBrand(($usedBrand['ever_used'] ?? 0) === 1, 'The actual draft save must add and track the brand in the shared catalogue.');
$pdo->exec('DELETE FROM foxreport_devices WHERE report_id = 1');
expectBrandError(fn()=>changeDeviceBrand($pdo, deviceBrandKey($device['brand']), 'delete'));
echo "PASS: Actual draft save persists a new brand and preserves usage history after device removal.\n";
