<?php
declare(strict_types=1);

function startFoxSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = foxRequestIsHttps();
    session_name('FOXREPORTSESSID');
    session_set_cookie_params([
        'httponly' => true, 'secure' => $secure, 'samesite' => 'Lax', 'path' => '/', 'domain' => '',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    if (!session_start()) {
        oauthDiagnostic('session_start_failed');
        throw new RuntimeException('La session PHP ne peut pas être ouverte. Vérifiez le stockage des sessions sur IONOS.');
    }
    header('Cache-Control: private, no-store');
}

function foxRequestIsHttps(): bool
{
    // Do not trust client-supplied X-Forwarded-Proto unless a trusted proxy is configured.
    return (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
}

function oauthDiagnostic(string $reason, ?string $attempt = null): void
{
    $context = [
        'reason' => $reason,
        'secure_request' => foxRequestIsHttps(),
        'session_cookie_present' => isset($_COOKIE['FOXREPORTSESSID']),
        'session_active' => session_status() === PHP_SESSION_ACTIVE,
    ];
    if ($attempt !== null && preg_match('/^[a-f0-9]{16}$/', $attempt)) {
        $context['attempt'] = $attempt;
    }
    error_log('FoxReport OAuth ' . json_encode($context, JSON_THROW_ON_ERROR));
}

function oauthRequestIsCanonical(array $config, array $server): bool
{
    $parts = parse_url($config['redirect_uri']);
    $expectedHost = strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    $secure = (isset($server['HTTPS']) && $server['HTTPS'] !== '' && strtolower((string) $server['HTTPS']) !== 'off')
        || (int) ($server['SERVER_PORT'] ?? 0) === 443;
    return $secure && strtolower((string) ($server['HTTP_HOST'] ?? '')) === $expectedHost
        && ($server['SCRIPT_NAME'] ?? '') === $parts['path'];
}

function oauthConfigurationFingerprint(array $config): string
{
    return hash('sha256', $config['client_id'] . "\n" . $config['redirect_uri']);
}

function newOAuthAttempt(array $config, int $now): array
{
    return [
        'state' => bin2hex(random_bytes(32)), 'verifier' => bin2hex(random_bytes(32)),
        'created' => $now, 'attempt' => bin2hex(random_bytes(8)),
        'configuration' => oauthConfigurationFingerprint($config),
    ];
}

function oauthCallbackFailure(?array $pending, array $query, array $config, int $now): ?string
{
    if ($pending === null) { return 'pending_session_missing'; }
    if (!is_int($pending['created'] ?? null) || !is_string($pending['state'] ?? null)
        || !is_string($pending['verifier'] ?? null) || strlen($pending['verifier']) < 43) {
        return 'pending_session_invalid';
    }
    if ($now - $pending['created'] > 600 || $now < $pending['created']) { return 'attempt_expired'; }
    $state = $query['state'] ?? null;
    if (!is_string($state) || $state === '') { return 'callback_state_missing'; }
    if (!hash_equals($pending['state'], $state)) { return 'callback_state_mismatch'; }
    if (($pending['configuration'] ?? '') !== oauthConfigurationFingerprint($config)) {
        return 'configuration_changed';
    }
    if (isset($query['error'])) { return 'google_authorization_denied'; }
    if (!is_string($query['code'] ?? null) || $query['code'] === '') { return 'callback_code_missing'; }
    return null;
}

function oauthFailureMessage(string $reason): string
{
    return match ($reason) {
        'pending_session_missing' => 'Session de connexion introuvable. Vérifiez les cookies et recommencez sur l’adresse HTTPS de FoxReport.',
        'attempt_expired' => 'La connexion Google a dépassé dix minutes. Recommencez la connexion.',
        'callback_state_missing' => 'Le retour Google ne contient pas le state attendu. Recommencez la connexion.',
        'callback_state_mismatch' => 'Le state du retour Google ne correspond à aucune tentative en cours. Recommencez la connexion.',
        'callback_code_missing' => 'Le retour Google ne contient pas de code de connexion. Recommencez la connexion.',
        'google_authorization_denied' => 'La connexion Google a été annulée ou refusée. Recommencez si nécessaire.',
        'configuration_changed' => 'La configuration OAuth a changé pendant la connexion. Recommencez la connexion.',
        'attempt_already_consumed_or_expired' => 'Cette tentative de connexion a déjà été utilisée ou a expiré. Recommencez la connexion.',
        default => 'La session OAuth est invalide. Recommencez la connexion.',
    };
}

function oauthConfig(): array
{
    $path = dirname(__DIR__) . '/storage/private/oauth.php';
    if (!is_file($path)) {
        throw new RuntimeException('Configurez Google OAuth dans storage/private/oauth.php avant utilisation.');
    }
    $config = require $path;
    if (!is_array($config)) {
        throw new RuntimeException('Configuration OAuth invalide.');
    }
    foreach (['client_id', 'client_secret', 'redirect_uri'] as $key) {
        if (!isset($config[$key]) || !is_string($config[$key]) || trim($config[$key]) === '') {
            throw new RuntimeException('Configuration OAuth incomplète.');
        }
    }
    if (!filter_var($config['redirect_uri'], FILTER_VALIDATE_URL) || parse_url($config['redirect_uri'], PHP_URL_SCHEME) !== 'https') {
        throw new RuntimeException('Google OAuth nécessite une URL de retour HTTPS explicite.');
    }
    $uri = parse_url($config['redirect_uri']);
    parse_str($uri['query'] ?? '', $callbackQuery);
    if (isset($uri['user']) || isset($uri['pass']) || isset($uri['fragment'])
        || basename($uri['path'] ?? '') !== 'auth.php' || $callbackQuery !== ['action' => 'callback']) {
        throw new RuntimeException('L’URI OAuth doit pointer exactement vers https://VOTRE-DOMAINE/auth.php?action=callback (avec le sous-dossier éventuel).');
    }
    if (!isset($config['allowed_emails']) || !is_array($config['allowed_emails']) || $config['allowed_emails'] === []) {
        throw new RuntimeException('Configurez au moins une adresse Google autorisée.');
    }
    foreach ($config['allowed_emails'] as $email) {
        if (!is_string($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Une adresse autorisée est invalide.');
        }
    }
    return $config;
}

function googleIdentityAllowed(array $identity, array $config): bool
{
    return is_string($identity['sub'] ?? null) && $identity['sub'] !== ''
        && is_string($identity['email'] ?? null)
        && ($identity['email_verified'] ?? false) === true
        && in_array(strtolower($identity['email']), array_map('strtolower', $config['allowed_emails']), true);
}

function requireFoxAuth(bool $json = false): array
{
    startFoxSession();
    try {
        $config = oauthConfig();
    } catch (RuntimeException $exception) {
        http_response_code(503);
        if ($json) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['error' => $exception->getMessage()], JSON_THROW_ON_ERROR);
        } else {
            header('Content-Type: text/plain; charset=utf-8');
            echo $exception->getMessage();
        }
        exit;
    }
    $identity = $_SESSION['foxreport_user'] ?? [];
    $authenticatedAt = $_SESSION['foxreport_authenticated_at'] ?? 0;
    if (!is_array($identity) || !googleIdentityAllowed($identity, $config) || time() - (int) $authenticatedAt > 43200) {
        unset($_SESSION['foxreport_user'], $_SESSION['foxreport_authenticated_at']);
        if ($json) {
            http_response_code(401);
            header('Content-Type: application/json; charset=utf-8');
            echo '{"error":"Connexion Google requise.","login":"auth.php?action=login"}';
        } else {
            header('Location: auth.php', true, 303);
        }
        exit;
    }
    return $identity;
}

function googleRequest(string $url, ?array $form = null, ?string $token = null): array
{
    if (!extension_loaded('curl')) {
        throw new RuntimeException('Activez PHP cURL pour Google OAuth.');
    }
    $handle = curl_init($url);
    if ($handle === false) {
        throw new RuntimeException('Impossible de préparer la connexion Google.');
    }
    $headers = ['Accept: application/json'];
    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($form !== null) {
        curl_setopt($handle, CURLOPT_POST, true);
        curl_setopt($handle, CURLOPT_POSTFIELDS, http_build_query($form));
    }
    $response = curl_exec($handle);
    $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    if (!is_string($response) || $status !== 200) {
        oauthDiagnostic($form !== null ? 'google_token_exchange_failed' : 'google_userinfo_failed');
        error_log('FoxReport Google request failed; HTTP ' . (int) $status);
        throw new RuntimeException('Google n’a pas validé la connexion. Réessayez.');
    }
    $data = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($data)) {
        throw new RuntimeException('Réponse Google invalide.');
    }
    return $data;
}
