<?php
declare(strict_types=1);
require_once __DIR__ . '/app/auth.php';
requireFoxAuth(false);
require_once __DIR__ . '/app/version.php';
require_once __DIR__ . '/app/device-catalogue.php';
require_once __DIR__ . '/SERVEUR/db.php';
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; style-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
if (!isset($_SESSION['foxreport_csrf'])) $_SESSION['foxreport_csrf'] = bin2hex(random_bytes(32));
function brandEscape(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
$error = '';
$brands = [];
$validDatabase = false;
try {
    if (!isset($pdo) || !$pdo instanceof PDO) throw new RuntimeException('Connexion FoxReport indisponible.');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $database = $pdo->query('SELECT DATABASE()')->fetchColumn();
    if (!is_string($database) || stripos($database, 'planesto') !== false) throw new RuntimeException('Une base dédiée FoxReport est requise.');
    $validDatabase = true;
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_POST['csrf_token'] ?? null;
        if (!is_string($token) || !hash_equals($_SESSION['foxreport_csrf'], $token)) {
            http_response_code(403);
            throw new RuntimeException('Session du formulaire expirée. Rechargez la page.');
        }
        $action = $_POST['action'] ?? '';
        if ($action === 'create') {
            $pdo->beginTransaction();
            if (!ensureDeviceBrand($pdo, deviceBrandName($_POST['name'] ?? null))) throw new RuntimeException('Cette marque a été supprimée. Choisissez une référence valide.');
            $pdo->commit();
        } else {
            if ($action === 'delete' && ($_POST['confirm_delete'] ?? '') !== '1') throw new RuntimeException('Confirmez la suppression de la marque.');
            changeDeviceBrand($pdo, $_POST['brand_key'] ?? null, $action);
        }
        header('Location: device-brands.php?saved=1', true, 303);
        exit;
    }
} catch (PDOException $exception) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    error_log('FoxReport brands unavailable; SQLSTATE ' . $exception->getCode());
    http_response_code(503);
    $error = 'Catalogue des marques indisponible. Vérifiez la migration database/migrations/015-device-brands.sql.';
} catch (RuntimeException $exception) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    if (http_response_code() !== 403) http_response_code(422);
    $error = $exception->getMessage();
}
try {
    if ($validDatabase) $brands = $pdo->query('SELECT brand_key, name, archived, ever_used FROM foxreport_device_brands ORDER BY archived, name, brand_key')->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $exception) { $error = 'Appliquez database/migrations/015-device-brands.sql pour préparer le catalogue des marques.'; }
?>
<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marques de matériel · FoxReport</title><link rel="stylesheet" href="<?= brandEscape(foxAsset('assets/app.css')) ?>"></head>
<body><header class="topbar"><a class="brand" href="index.php">FoxReport</a><a class="button button-secondary" href="index.php">Rapports</a></header>
<main class="page-shell"><h1>Marques de matériel</h1>
<p>Les marques archivées restent dans les rapports existants et ne sont plus proposées pour ajouter du matériel. Seules les marques jamais utilisées peuvent être supprimées définitivement.</p>
<?php if ($error !== ''): ?><p class="alert alert-error" role="alert"><?= brandEscape($error) ?></p><?php endif; ?>
<?php if (isset($_GET['saved'])): ?><p class="alert" role="status">Catalogue des marques mis à jour.</p><?php endif; ?>
<form method="post" class="brand-create panel">
<input type="hidden" name="csrf_token" value="<?= brandEscape($_SESSION['foxreport_csrf']) ?>"><input type="hidden" name="action" value="create">
<label class="field field-floating"><input placeholder=" " name="name" maxlength="120" required><span class="field-title">Nouvelle marque</span></label>
<button class="button button-primary" type="submit">Ajouter</button></form>
<div class="brand-management-list">
<?php foreach ($brands as $brand): ?>
<article class="brand-management-item<?= (int) $brand['archived'] ? ' is-archived' : '' ?>">
<div><strong><?= brandEscape($brand['name']) ?></strong><p><?= (int) $brand['archived'] ? 'Archivée' : 'Active' ?> · <?= (int) $brand['ever_used'] ? 'Déjà utilisée' : 'Jamais utilisée' ?></p></div>
<div class="brand-management-actions"><form method="post">
<input type="hidden" name="csrf_token" value="<?= brandEscape($_SESSION['foxreport_csrf']) ?>"><input type="hidden" name="brand_key" value="<?= brandEscape($brand['brand_key']) ?>">
<button class="button button-secondary" name="action" value="<?= (int) $brand['archived'] ? 'restore' : 'archive' ?>"><?= (int) $brand['archived'] ? 'Désarchiver' : 'Archiver' ?></button></form>
<?php if (!(int) $brand['ever_used']): ?><form method="post" class="brand-delete-form">
<input type="hidden" name="csrf_token" value="<?= brandEscape($_SESSION['foxreport_csrf']) ?>"><input type="hidden" name="brand_key" value="<?= brandEscape($brand['brand_key']) ?>">
<label><input type="checkbox" name="confirm_delete" value="1" required> Confirmer</label><button class="button button-danger" name="action" value="delete">Supprimer</button></form><?php endif; ?>
</div></article>
<?php endforeach; ?>
<?php if ($brands === [] && $error === ''): ?><p>Aucune marque enregistrée.</p><?php endif; ?>
</div></main></body></html>
