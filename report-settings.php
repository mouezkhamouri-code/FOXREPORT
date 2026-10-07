<?php
declare(strict_types=1);
require_once __DIR__ . '/app/auth.php';
requireFoxAuth(false);
require_once __DIR__ . '/app/version.php';
require_once __DIR__ . '/app/report-branding.php';
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
if (!isset($_SESSION['foxreport_csrf'])) $_SESSION['foxreport_csrf'] = bin2hex(random_bytes(32));
function brandingEscape(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
$error = '';
$logo = null;
try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_POST['csrf_token'] ?? null;
        if (!is_string($token) || !hash_equals($_SESSION['foxreport_csrf'], $token)) {
            http_response_code(403);
            throw new RuntimeException('Session du formulaire expirée. Rechargez la page.');
        }
        $upload = $_FILES['report_logo'] ?? [];
        if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
            || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])
            || !is_int($upload['size'] ?? null) || $upload['size'] < 1 || $upload['size'] > 8*1024*1024) {
            throw new RuntimeException('Choisissez une image JPEG, PNG ou WebP de 8 Mo maximum.');
        }
        saveReportLogo($upload['tmp_name']);
        header('Location: report-settings.php?saved=1', true, 303);
        exit;
    }
    $logo = reportLogoData();
} catch (RuntimeException $exception) {
    if (http_response_code() !== 403) http_response_code(422);
    $error = $exception->getMessage();
}
?>
<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paramètres du rapport · FoxReport</title><link rel="stylesheet" href="<?= brandingEscape(foxAsset('assets/app.css')) ?>"></head>
<body><header class="topbar"><a class="brand" href="index.php">FoxReport</a><a class="button button-secondary" href="index.php">Rapports</a></header>
<main class="page-shell"><h1>Paramètres du rapport</h1>
<?php if ($error !== ''): ?><p class="alert alert-error" role="alert"><?= brandingEscape($error) ?></p><?php endif; ?>
<?php if (isset($_GET['saved'])): ?><p role="status">Logo du rapport enregistré.</p><?php endif; ?>
<section class="panel editor-footer"><h2>Logo commun aux rapports</h2>
<p>Il apparaît en haut à gauche de chaque page du PDF. Vous pouvez réunir plusieurs logos dans une seule image. Le remplacement s’applique aux prochaines prévisualisations de tous les rapports.</p>
<?php if ($logo !== null): ?><img class="report-logo-preview" src="<?= brandingEscape($logo) ?>" alt="Logo actuel du rapport"><?php else: ?><p>Aucun logo configuré.</p><?php endif; ?>
<form method="post" action="report-settings.php" enctype="multipart/form-data">
<input type="hidden" name="csrf_token" value="<?= brandingEscape($_SESSION['foxreport_csrf']) ?>">
<label class="field">Logo du rapport (JPEG, PNG ou WebP · 8 Mo maximum)<input type="file" name="report_logo" accept="image/jpeg,image/png,image/webp" required></label>
<button class="button button-primary" type="submit">Enregistrer le logo</button>
</form></section></main></body></html>
