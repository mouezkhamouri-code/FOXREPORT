<?php
declare(strict_types=1);
require_once __DIR__ . '/app/auth.php';
requireFoxAuth(false);
require_once __DIR__ . '/app/version.php';
require_once __DIR__ . '/app/salespeople.php';
require_once __DIR__ . '/SERVEUR/db.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
if (!isset($pdo) || !$pdo instanceof PDO) { http_response_code(500);exit('Connexion FoxReport indisponible.'); }
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
if (!isset($_SESSION['foxreport_csrf'])) $_SESSION['foxreport_csrf'] = bin2hex(random_bytes(32));
function salesEscape(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
$error = '';
$people = [];
$values = ['last_name'=>'', 'first_name'=>'', 'phone'=>'', 'email'=>''];
try {
    $database = $pdo->query('SELECT DATABASE()')->fetchColumn();
    if (!is_string($database) || stripos($database, 'planesto') !== false) throw new RuntimeException('Une base dédiée FoxReport est requise.');
    $people = $pdo->query('SELECT id, last_name, first_name, phone, email FROM foxreport_salespeople ORDER BY last_name, first_name, id')->fetchAll(PDO::FETCH_ASSOC);
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_POST['csrf_token'] ?? null;
        if (!is_string($token) || !hash_equals($_SESSION['foxreport_csrf'], $token)) {
            http_response_code(403);
            throw new RuntimeException('Session du formulaire expirée. Rechargez la page.');
        }
        foreach ($values as $name=>$_) $values[$name] = is_string($_POST[$name] ?? null) ? $_POST[$name] : '';
        $data = salespersonInput($_POST);
        $insert = $pdo->prepare('INSERT INTO foxreport_salespeople (last_name, first_name, phone, email) VALUES (:last_name, :first_name, :phone, :email)');
        $insert->execute($data);
        header('Location: salespeople.php?created=1', true, 303);
        exit;
    }
} catch (PDOException $exception) {
    error_log('FoxReport salespeople database failure; SQLSTATE ' . $exception->getCode());
    http_response_code(503);
    $error = 'Annuaire indisponible. Vérifiez la migration database/migrations/005-salespeople.sql et la connexion FoxReport.';
} catch (RuntimeException $exception) {
    if (http_response_code() !== 403) http_response_code(422);
    $error = $exception->getMessage();
}
?>
<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Commerciaux · FoxReport</title><link rel="stylesheet" href="<?= salesEscape(foxAsset('assets/app.css')) ?>"></head>
<body><header class="topbar"><a class="brand" href="index.php">FoxReport</a><a class="button button-secondary" href="index.php">Rapports</a></header>
<main class="page-shell"><h1>Commerciaux</h1>
<?php if ($error !== ''): ?><p class="alert alert-error" role="alert"><?= salesEscape($error) ?></p><?php endif; ?>
<?php if (isset($_GET['created'])): ?><p role="status">Commercial créé.</p><?php endif; ?>
<section class="panel editor-footer"><h2>Ajouter un commercial</h2>
<form method="post" action="salespeople.php">
<input type="hidden" name="csrf_token" value="<?= salesEscape($_SESSION['foxreport_csrf']) ?>">
<div class="form-grid">
<?php foreach (['last_name'=>'Nom', 'first_name'=>'Prénom', 'phone'=>'Téléphone', 'email'=>'E-mail'] as $name=>$label): ?>
<label class="field field-floating"><input placeholder=" " name="<?= $name ?>" type="<?= $name === 'email' ? 'email' : ($name === 'phone' ? 'tel' : 'text') ?>" maxlength="<?= in_array($name, ['last_name','first_name'], true) ? 90 : ($name === 'phone' ? 60 : 190) ?>" value="<?= salesEscape($values[$name]) ?>" <?= $name === 'phone' ? '' : 'required' ?>><span class="field-title"><?= $label ?></span></label>
<?php endforeach; ?></div><button class="button button-primary" type="submit">Créer le commercial</button></form></section>
<div class="report-cards">
<?php foreach ($people as $person): ?><section class="report-card report-card-progress"><h2><?= salesEscape(salespersonName($person)) ?></h2><p><?= salesEscape($person['phone']) ?></p><p><?= salesEscape($person['email']) ?></p></section><?php endforeach; ?>
</div></main></body></html>
