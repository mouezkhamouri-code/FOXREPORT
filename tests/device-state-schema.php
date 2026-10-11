<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/sync.php';
class DeviceColumnFixture extends PDOStatement
{
    public function __construct(private string $type) {}
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
    {
        return ['Field'=>'state', 'Type'=>$this->type];
    }
}
class DeviceSchemaFixture extends PDO
{
    public int $reads = 0;
    public function __construct(private string $type, private string $driver = 'mysql') {}
    public function getAttribute(int $attribute): mixed { return $this->driver; }
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        $this->reads++;
        if ($query !== "SHOW COLUMNS FROM foxreport_devices WHERE Field = 'state'") throw new RuntimeException('Unexpected SQL.');
        return new DeviceColumnFixture($this->type);
    }
}
$old = new DeviceSchemaFixture("enum('installed','configured','already_present')");
try {
    requireDeviceStateSupport($old, [['state'=>'not_installed']]);
    throw new LogicException('An old enum must block saving before device replacement.');
} catch (RuntimeException $error) {
    if (!str_contains($error->getMessage(), '014-device-not-installed.sql')) throw $error;
}
requireDeviceStateSupport($old, [['state'=>'installed']]);
if ($old->reads !== 1) throw new RuntimeException('Existing states must not require migration.');
foreach (["enum('installed','configured','already_present','not_installed')", 'varchar(30)'] as $type) {
    requireDeviceStateSupport(new DeviceSchemaFixture($type), [['state'=>'not_installed']]);
}
$sqlite = new DeviceSchemaFixture('', 'sqlite');
requireDeviceStateSupport($sqlite, [['state'=>'not_installed']]);
if ($sqlite->reads !== 0) throw new RuntimeException('SQLite fixtures must not execute MySQL introspection.');
echo "PASS: Legacy enum blocks silent state loss; migrated schemas and existing states are accepted.\n";
