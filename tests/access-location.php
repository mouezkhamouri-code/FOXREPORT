<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/auth.php';
require_once dirname(__DIR__) . '/app/maps.php';
require_once dirname(__DIR__) . '/app/sync.php';

function verify(bool $condition, string $label): void
{
    if (!$condition) { throw new RuntimeException('FAIL: ' . $label); }
    echo 'PASS: ' . $label . PHP_EOL;
}
function invalid(callable $callback, string $label): void
{
    try { $callback(); } catch (RuntimeException) { verify(true, $label); return; }
    verify(false, $label);
}
$config = ['allowed_emails' => ['TEAM@example.com']];
$identity = ['sub' => 'TEST-GOOGLE', 'email' => 'team@example.com', 'email_verified' => true];
verify(googleIdentityAllowed($identity, $config), 'Verified allowlisted email accepted case-insensitively');
verify(!googleIdentityAllowed($identity + ['other' => 'ignored'], ['allowed_emails' => ['outsider@example.com']]), 'Non-team email denied');
$identity['email_verified'] = false;
verify(!googleIdentityAllowed($identity, $config), 'Unverified email denied');
verify(locationFields([])['latitude'] === null, 'Empty location allowed');
$location = locationFields(['latitude' => '0', 'longitude' => '0', 'map_zoom' => '15']);
verify($location['latitude'] === 0.0 && $location['longitude'] === 0.0, 'Zero coordinates preserved');
invalid(static fn() => locationFields(['latitude' => '91', 'longitude' => '0']), 'Out-of-range latitude rejected');
invalid(static fn() => locationFields(['latitude' => '0', 'longitude' => '181']), 'Out-of-range longitude rejected');
invalid(static fn() => locationFields(['latitude' => '1']), 'Partial coordinate pair rejected');
invalid(static fn() => locationFields(['latitude' => '0', 'longitude' => '0', 'map_zoom' => '21']), 'Invalid zoom rejected');
invalid(static fn() => locationFields(['latitude' => '0', 'longitude' => '0', 'map_style' => 'malicious']), 'Unknown style rejected');
$parameters = staticMapParameters($location, 2);
verify($parameters['size'] === '640x360' && $parameters['scale'] === 2, 'Static map target is 1280x720');
verify(str_starts_with($parameters['markers'], 'color:0x176b75|'), 'Petroleum marker');
verify($parameters['center'] === substr($parameters['markers'], strlen('color:0x176b75|')), 'Identical center and marker');

class LockTestStatement extends PDOStatement
{
    public function __construct(private array|false $report) {}
    public function execute(?array $params = null): bool { return true; }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed { return $this->report; }
}
class LockTestPDO extends PDO
{
    public function __construct(private array|false $report) {}
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        verify(str_contains($query, 'FOR UPDATE'), 'Version check locks report row');
        return new LockTestStatement($this->report);
    }
}
verify(lockReportVersion(new LockTestPDO(['id'=>1,'revision'=>3,'status'=>'draft']),1,3)['revision']===3, 'Matching revision accepted');
invalid(static fn() => lockReportVersion(new LockTestPDO(['id'=>1,'revision'=>4,'status'=>'draft']),1,3), 'Stale revision conflicts');
invalid(static fn() => lockReportVersion(new LockTestPDO(['id'=>1,'revision'=>3,'status'=>'finalized']),1,3), 'Finalized report rejects silent editing');
