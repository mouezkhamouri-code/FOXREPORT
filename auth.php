<?php
declare(strict_types=1);

require_once __DIR__ . '/app/auth.php';
require_once __DIR__ . '/app/version.php';
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
$error = '';
$loggedOut = false;
try {
    $config = oauthConfig();
    $action = $_GET['action'] ?? '';
    if (!is_string($action)) { throw new RuntimeException('Action de connexion invalide.'); }
    if (!oauthRequestIsCanonical($config, $_SERVER)) {
        oauthDiagnostic('noncanonical_origin_or_path');
        // Normalize before creating a state or setting any session cookie.
        // Never replay a callback code to a different origin.
        $destination = explode('?', $config['redirect_uri'], 2)[0];
        header('Location: ' . $destination . ($action === 'callback' || $action === 'login' ? '?action=login' : ''), true, 303);
        exit;
    }
    startFoxSession();
    if ($action === 'login') {
        $pending = newOAuthAttempt($config, time());
        $state = $pending['state'];
        $verifier = $pending['verifier'];
        $attempts = $_SESSION['foxreport_oauth_attempts'] ?? [];
        if (!is_array($attempts)) { $attempts = []; }
        $attempts = array_filter($attempts, static fn($attempt): bool =>
            is_array($attempt) && is_int($attempt['created'] ?? null) && time() - $attempt['created'] <= 600);
        if (count($attempts) >= 5) {
            http_response_code(429);
            oauthDiagnostic('too_many_attempts');
            throw new RuntimeException('Cinq connexions sont déjà en cours. Terminez-en une ou attendez dix minutes.');
        }
        $attempts[$state] = $pending;
        $_SESSION['foxreport_oauth_attempts'] = $attempts;
        $_SESSION['foxreport_oauth_issued'] = true;
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $parameters = [
            'client_id' => $config['client_id'], 'redirect_uri' => $config['redirect_uri'],
            'response_type' => 'code', 'scope' => 'openid email profile', 'state' => $state,
            'code_challenge' => $challenge, 'code_challenge_method' => 'S256',
            'prompt' => 'select_account',
        ];
        oauthDiagnostic('login_started', $pending['attempt']);
        if (!session_write_close()) {
            oauthDiagnostic('session_write_failed', $pending['attempt']);
            throw new RuntimeException('Impossible de conserver la session OAuth. Vérifiez le stockage PHP des sessions.');
        }
        header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($parameters), true, 302);
        exit;
    }
    if ($action === 'callback') {
        $state = $_GET['state'] ?? null;
        $attempts = $_SESSION['foxreport_oauth_attempts'] ?? [];
        $pending = is_array($attempts) && is_string($state) ? ($attempts[$state] ?? null) : null;
        // Accept an in-flight attempt created immediately before deployment of this fix.
        if ($pending === null && is_array($_SESSION['foxreport_oauth'] ?? null)) {
            $pending = $_SESSION['foxreport_oauth'];
            $pending['configuration'] = oauthConfigurationFingerprint($config);
            unset($_SESSION['foxreport_oauth']);
        }
        $failure = oauthCallbackFailure(is_array($pending) ? $pending : null, $_GET, $config, time());
        if ($pending === null && is_array($attempts) && $attempts !== []) {
            $failure = is_string($state) && $state !== '' ? 'callback_state_mismatch' : 'callback_state_missing';
        } elseif ($pending === null && ($_SESSION['foxreport_oauth_issued'] ?? false) === true) {
            $failure = 'attempt_already_consumed_or_expired';
        }
        if (is_array($pending) && is_string($state) && hash_equals((string) ($pending['state'] ?? ''), $state)) {
            unset($_SESSION['foxreport_oauth_attempts'][$state]);
        }
        if ($failure !== null) {
            oauthDiagnostic($failure, is_array($pending) ? ($pending['attempt'] ?? null) : null);
            http_response_code(400);
            throw new RuntimeException(oauthFailureMessage($failure));
        }
        oauthDiagnostic('state_verified', $pending['attempt'] ?? null);
        if (!session_write_close()) {
            oauthDiagnostic('session_write_failed', $pending['attempt'] ?? null);
            throw new RuntimeException('Impossible de conserver la session OAuth.');
        }
        $code = $_GET['code'];
        $tokens = googleRequest('https://oauth2.googleapis.com/token', [
            'client_id' => $config['client_id'], 'client_secret' => $config['client_secret'],
            'redirect_uri' => $config['redirect_uri'], 'grant_type' => 'authorization_code',
            'code' => $code, 'code_verifier' => $pending['verifier'],
        ]);
        if (!is_string($tokens['access_token'] ?? null)) {
            throw new RuntimeException('Google n’a pas fourni de jeton utilisable.');
        }
        $identity = googleRequest('https://openidconnect.googleapis.com/v1/userinfo', null, $tokens['access_token']);
        if (!googleIdentityAllowed($identity, $config)) {
            oauthDiagnostic('identity_not_authorized', $pending['attempt'] ?? null);
            http_response_code(403);
            throw new RuntimeException('Cette adresse Google ne fait pas partie de l’équipe FoxReport autorisée.');
        }
        startFoxSession();
        if (!session_regenerate_id(true)) {
            oauthDiagnostic('session_regeneration_failed', $pending['attempt'] ?? null);
            throw new RuntimeException('Impossible de sécuriser la session de connexion.');
        }
        $_SESSION['foxreport_user'] = [
            'sub' => $identity['sub'], 'email' => strtolower($identity['email']), 'email_verified' => true,
        ];
        $_SESSION['foxreport_authenticated_at'] = time();
        $_SESSION['foxreport_csrf'] = bin2hex(random_bytes(32));
        oauthDiagnostic('login_completed', $pending['attempt'] ?? null);
        if (!session_write_close()) {
            oauthDiagnostic('session_write_failed', $pending['attempt'] ?? null);
            throw new RuntimeException('Impossible d’enregistrer la session de connexion.');
        }
        header('Location: index.php', true, 303);
        exit;
    }
    if ($action === 'logout') {
        $csrf = $_POST['csrf_token'] ?? null;
        if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !is_string($csrf)
            || !isset($_SESSION['foxreport_csrf']) || !hash_equals($_SESSION['foxreport_csrf'], $csrf)) {
            http_response_code(403);
            throw new RuntimeException('Déconnexion refusée : formulaire invalide.');
        }
        $_SESSION = [];
        session_regenerate_id(true);
        $loggedOut = true;
    }
} catch (RuntimeException | JsonException $exception) {
    oauthDiagnostic('request_failed');
    $error = $exception->getMessage();
    if (http_response_code() < 400) {
        http_response_code(503);
    }
}
?>
<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#176B75">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="FoxReport">
<title>Connexion · FoxReport</title><link rel="stylesheet" href="<?= htmlspecialchars(foxAsset('assets/app.css'), ENT_QUOTES, 'UTF-8') ?>">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/icons/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="assets/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png" sizes="180x180">
<script src="<?= htmlspecialchars(foxAsset('assets/install.js'), ENT_QUOTES, 'UTF-8') ?>" defer></script>
<script src="<?= htmlspecialchars(foxAsset('assets/update.js'), ENT_QUOTES, 'UTF-8') ?>" defer></script>
<script src="<?= htmlspecialchars(foxAsset('assets/local-store.js'), ENT_QUOTES, 'UTF-8') ?>" defer></script>
<script src="<?= htmlspecialchars(foxAsset('assets/logout.js'), ENT_QUOTES, 'UTF-8') ?>" defer></script></head>
<body data-logged-out="<?= $loggedOut ? 'true' : 'false' ?>" data-app-version="<?= htmlspecialchars(FOXREPORT_VERSION, ENT_QUOTES, 'UTF-8') ?>"><main class="page-shell"><section class="panel login-panel">
<h1 class="brand"><img class="brand-logo" src="assets/icons/icon-192.png" width="44" height="44" alt="">FoxReport</h1><p>Connectez-vous avec une adresse Google autorisée pour accéder aux rapports partagés de l’équipe.</p>
<?php if ($error !== ''): ?><div class="alert alert-error" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div><?php endif; ?>
<?php if ($loggedOut): ?><p>Déconnecté. Les copies locales déjà sauvegardées sont retirées ; les éventuelles saisies en attente restent conservées.</p><?php endif; ?>
<a class="button button-primary" href="auth.php?action=login">Connexion avec Google</a>
<div data-install-container></div>
<div data-update-container></div>
</section></main></body></html>
