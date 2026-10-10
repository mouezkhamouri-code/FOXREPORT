<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/training-catalogue.php';

function checkTrainingCatalogue(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: $message\n");
        exit(1);
    }
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    echo "Training catalogue tests skipped: pdo_sqlite unavailable.\n";
    return;
}
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE foxreport_training_items (item_key TEXT PRIMARY KEY, theme_key TEXT NOT NULL, label TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT DEFAULT NULL)');
$themes = loadTrainingChecklist($pdo);
checkTrainingCatalogue($themes === defaultTrainingChecklist(), 'Empty table is seeded with the default checklist');
loadTrainingChecklist($pdo);
checkTrainingCatalogue((int) $pdo->query('SELECT COUNT(*) FROM foxreport_training_items')->fetchColumn() === 56, 'Seeding happens once');
$themes = changeTrainingChecklist($pdo, ['action' => 'add', 'theme' => 'basics', 'label' => "  Ligne   <synthétique> \n "]);
$added = array_key_last($themes['basics']['items']);
checkTrainingCatalogue(preg_match('/^basics_c[0-9a-f]{12}$/', (string) $added) === 1 && $themes['basics']['items'][$added] === 'Ligne <synthétique>', 'Added line is appended with a stable key');
$themes = changeTrainingChecklist($pdo, ['action' => 'edit', 'theme' => 'basics', 'item' => 'basics_1', 'label' => 'Connexion modifiée']);
checkTrainingCatalogue($themes['basics']['items']['basics_1'] === 'Connexion modifiée' && array_key_first($themes['basics']['items']) === 'basics_1', 'Edited line keeps its key and position');
$themes = changeTrainingChecklist($pdo, ['action' => 'delete', 'theme' => 'basics', 'item' => 'basics_2']);
checkTrainingCatalogue(!isset($themes['basics']['items']['basics_2']) && trainingChecklist() === $themes, 'Deleted line disappears from the shared template');
foreach ([
    ['action' => 'add', 'theme' => 'unknown', 'label' => 'x'],
    ['action' => 'add', 'theme' => 'basics', 'label' => '   '],
    ['action' => 'add', 'theme' => 'basics', 'label' => str_repeat('é', 301)],
    ['action' => 'edit', 'theme' => 'basics', 'item' => 'basics_999', 'label' => 'x'],
    ['action' => 'edit', 'theme' => 'order', 'item' => 'basics_1', 'label' => 'x'],
    ['action' => 'rename', 'theme' => 'basics'],
] as $invalid) {
    try {
        changeTrainingChecklist($pdo, $invalid);
        checkTrainingCatalogue(false, 'Invalid configuration rejected: ' . json_encode($invalid));
    } catch (RuntimeException) {
    }
}
unset($GLOBALS['foxTrainingChecklist']);
echo "Training catalogue tests passed.\n";
