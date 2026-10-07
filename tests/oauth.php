<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/auth.php';

function oauthCheck(bool $result, string $label): void
{
    if (!$result) { throw new RuntimeException('FAIL: ' . $label); }
    echo 'PASS: ' . $label . PHP_EOL;
}

$config = ['client_id' => 'TEST.apps.googleusercontent.com', 'redirect_uri' => 'https://fox.example/auth.php?action=callback'];
$attempt = newOAuthAttempt($config, 1000);
$query = ['state' => $attempt['state'], 'code' => 'SYNTHETIC'];
oauthCheck(oauthCallbackFailure($attempt, $query, $config, 1100) === null, 'Matching state and unexpired attempt accepted');
oauthCheck(oauthCallbackFailure(null, $query, $config, 1100) === 'pending_session_missing', 'Missing server session distinguished');
oauthCheck(oauthCallbackFailure($attempt, $query, $config, 1601) === 'attempt_expired', 'Ten-minute timeout enforced');
oauthCheck(oauthCallbackFailure($attempt, $query, $config, 900) === 'attempt_expired', 'Invalid future creation time rejected');
oauthCheck(oauthCallbackFailure($attempt, ['code'=>'TEST'], $config, 1100) === 'callback_state_missing', 'Missing state distinguished');
oauthCheck(oauthCallbackFailure($attempt, ['state'=>'WRONG', 'code'=>'TEST'], $config, 1100) === 'callback_state_mismatch', 'State mismatch rejected');
oauthCheck(oauthCallbackFailure($attempt, ['state'=>$attempt['state']], $config, 1100) === 'callback_code_missing', 'Missing code distinguished');
oauthCheck(oauthCallbackFailure($attempt, ['state'=>$attempt['state'], 'error'=>'access_denied'], $config, 1100) === 'google_authorization_denied', 'Google cancellation distinguished');
$changed = array_replace($config, ['client_id'=>'CHANGED.apps.googleusercontent.com']);
oauthCheck(oauthCallbackFailure($attempt, $query, $changed, 1100) === 'configuration_changed', 'Client changed mid-flow rejected');
oauthCheck(oauthCallbackFailure(['created'=>1000], $query, $config, 1100) === 'pending_session_invalid', 'Malformed session rejected safely');
$server = ['HTTPS'=>'on','HTTP_HOST'=>'fox.example','SCRIPT_NAME'=>'/auth.php'];
oauthCheck(oauthRequestIsCanonical($config, $server), 'HTTPS callback origin and path match');
oauthCheck(!oauthRequestIsCanonical($config, array_replace($server,['HTTPS'=>'off'])), 'HTTP start is noncanonical');
oauthCheck(!oauthRequestIsCanonical($config, array_replace($server,['HTTP_HOST'=>'www.fox.example'])), 'Changed domain is noncanonical');
oauthCheck(!oauthRequestIsCanonical($config, array_replace($server,['SCRIPT_NAME'=>'/other/auth.php'])), 'Wrong callback subfolder rejected');
oauthCheck(oauthRequestIsCanonical($config, array_replace($server,['HTTPS'=>'off','SERVER_PORT'=>443])), 'Server TLS port recognized without trusting proxy headers');
oauthCheck(!oauthRequestIsCanonical($config, array_replace($server,['HTTPS'=>'off','HTTP_X_FORWARDED_PROTO'=>'https'])), 'Untrusted proxy header cannot fake HTTPS');
