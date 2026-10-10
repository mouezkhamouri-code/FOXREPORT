<?php
declare(strict_types=1);

require_once __DIR__ . '/report-definition.php';

/**
 * Loads the shared training template used by every report (new and existing).
 * The table is seeded from FOXREPORT_TRAINING_CHECKLIST the first time it is empty.
 */
function loadTrainingChecklist(PDO $pdo): array
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM foxreport_training_items')->fetchColumn();
    if ($count === 0) seedTrainingChecklist($pdo);
    $themes = [];
    foreach (FOXREPORT_TRAINING_CHECKLIST as $theme => $definition) {
        $themes[$theme] = ['title' => $definition['title'], 'items' => []];
    }
    $rows = $pdo->query('SELECT item_key, theme_key, label FROM foxreport_training_items WHERE deleted_at IS NULL ORDER BY sort_order, item_key')
        ->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as $row) {
        if (isset($themes[$row['theme_key']])) $themes[$row['theme_key']]['items'][(string) $row['item_key']] = (string) $row['label'];
    }
    $GLOBALS['foxTrainingChecklist'] = $themes;
    return $themes;
}

function seedTrainingChecklist(PDO $pdo): void
{
    $insert = $pdo->prepare('INSERT INTO foxreport_training_items (item_key, theme_key, label, sort_order) VALUES (?, ?, ?, ?)');
    foreach (defaultTrainingChecklist() as $theme => $definition) {
        $order = 0;
        foreach ($definition['items'] as $key => $label) {
            try { $insert->execute([$key, $theme, $label, ++$order * 10]); }
            catch (PDOException $exception) {
                // Another request seeded the same row concurrently.
                if ($exception->getCode() !== '23000') throw $exception;
            }
        }
    }
}

function trainingChecklistLabel(mixed $label): string
{
    if (!is_string($label) || !mb_check_encoding($label, 'UTF-8')) throw new RuntimeException('Le libellé est invalide.');
    $label = trim((string) preg_replace('/\s+/u', ' ', $label));
    if ($label === '') throw new RuntimeException('Saisissez le texte de la ligne.');
    if (mb_strlen($label, 'UTF-8') > 300) throw new RuntimeException('Le texte de la ligne dépasse 300 caractères.');
    return $label;
}

/** Applies one change from the "Configurer" modal; returns the updated template. */
function changeTrainingChecklist(PDO $pdo, array $input): array
{
    $action = $input['action'] ?? '';
    $theme = $input['theme'] ?? '';
    if (!is_string($theme) || !isset(FOXREPORT_TRAINING_CHECKLIST[$theme])) throw new RuntimeException('Choisissez un thème valide.');
    if ($action === 'add') {
        $label = trainingChecklistLabel($input['label'] ?? null);
        $order = $pdo->prepare('SELECT COALESCE(MAX(sort_order), 0) FROM foxreport_training_items WHERE theme_key = ?');
        $order->execute([$theme]);
        $pdo->prepare('INSERT INTO foxreport_training_items (item_key, theme_key, label, sort_order) VALUES (?, ?, ?, ?)')
            ->execute([$theme . '_c' . bin2hex(random_bytes(6)), $theme, $label, (int) $order->fetchColumn() + 10]);
    } elseif ($action === 'edit' || $action === 'delete') {
        $item = $input['item'] ?? '';
        if (!is_string($item) || !preg_match(FOXREPORT_TRAINING_ITEM_KEY, $item)) throw new RuntimeException('Choisissez une ligne valide.');
        $statement = $action === 'edit'
            ? $pdo->prepare('UPDATE foxreport_training_items SET label = ? WHERE item_key = ? AND theme_key = ? AND deleted_at IS NULL')
            : $pdo->prepare('UPDATE foxreport_training_items SET deleted_at = ? WHERE item_key = ? AND theme_key = ? AND deleted_at IS NULL');
        $statement->execute([$action === 'edit' ? trainingChecklistLabel($input['label'] ?? null) : date('Y-m-d H:i:s'), $item, $theme]);
        $check = $pdo->prepare('SELECT COUNT(*) FROM foxreport_training_items WHERE item_key = ? AND theme_key = ?' . ($action === 'edit' ? ' AND deleted_at IS NULL' : ''));
        $check->execute([$item, $theme]);
        if ((int) $check->fetchColumn() === 0) throw new RuntimeException('Cette ligne n’existe plus. Rechargez la configuration.');
    } else {
        throw new RuntimeException('Action de configuration inconnue.');
    }
    return loadTrainingChecklist($pdo);
}

/** JSON shape shared with assets/training-checklist.js. */
function trainingChecklistPayload(array $themes): array
{
    $payload = [];
    foreach ($themes as $key => $theme) {
        $items = [];
        foreach ($theme['items'] as $itemKey => $label) $items[] = ['key' => (string) $itemKey, 'label' => $label];
        $payload[] = ['key' => $key, 'title' => $theme['title'], 'items' => $items];
    }
    return ['themes' => $payload];
}
