<?php
declare(strict_types=1);

require_once __DIR__ . '/completion.php';

function reportListEscape(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function loadReportList(PDO $pdo): array
{
    $columns = array_merge(['id', 'revision', 'report_type', 'status', 'updated_at'], FOXREPORT_COMPLETION_FIELDS);
    $available = $pdo->query('SHOW COLUMNS FROM foxreport_reports')->fetchAll(PDO::FETCH_COLUMN);
    $missing = array_values(array_diff($columns, $available));
    if ($missing !== []) {
        error_log('FoxReport report list schema missing columns: ' . implode(', ', $missing));
        $location = array_intersect($missing, ['latitude', 'longitude', 'map_zoom']);
        throw new RuntimeException(
            'Schéma FoxReport incomplet : ' . implode(', ', $missing) . '. '
            . ($location !== [] ? 'Exécutez explicitement database/migrations/003-location.sql dans la base FoxReport si cette migration n’a pas encore été appliquée. ' : '')
            . 'Pour les autres colonnes, vérifiez les migrations et le schéma avant modification. Aucune migration n’est exécutée automatiquement.'
        );
    }
    $rows = $pdo->query('SELECT ' . implode(', ', $columns) . ' FROM foxreport_reports ORDER BY updated_at DESC, id DESC')->fetchAll(PDO::FETCH_ASSOC);
    $reports = [];
    foreach ($rows as $row) {
        $report = array_intersect_key($row, array_flip(['id', 'revision', 'establishment', 'report_date', 'report_type', 'status']));
        try {
            $report['completion'] = reportCompletion($row);
        } catch (JsonException | RuntimeException $exception) {
            // A broken checklist must not make every other report disappear.
            error_log('FoxReport invalid completion data for report ' . (int) $row['id']);
            $report['completion'] = null;
        }
        $reports[] = $report;
    }
    return $reports;
}

function reportListFilter(mixed $filter): string
{
    if (!is_string($filter) || !in_array($filter, ['open', 'closed', 'all'], true)) {
        throw new RuntimeException('Filtre de rapports invalide. Choisissez Ouverts, Clôturés ou Tous.');
    }
    return $filter;
}

function renderReportList(array $reports, string $csrfToken = '', string $filter = 'all'): string
{
    reportListFilter($filter);
    $reports = array_values(array_filter($reports, static fn(array $report): bool =>
        $filter === 'all' || ($filter === 'closed' ? $report['status'] === 'finalized' : $report['status'] === 'draft')));
    ob_start();
    ?>
    <?php if ($reports === []): ?>
        <div class="empty-state"><div class="empty-icon">＋</div><h3><?= $filter === 'all' ? 'Tout commence ici' : 'Aucun rapport ' . ($filter === 'open' ? 'ouvert' : 'clôturé') ?></h3><p>Changez de filtre ou créez un nouveau rapport.</p></div>
    <?php else: ?>
        <div class="report-cards">
            <?php foreach ($reports as $row): ?>
                <?php
                $name = $row['establishment'] !== '' ? $row['establishment'] : 'Établissement à renseigner';
                $percent = $row['completion']['percent'] ?? null;
                $tone = $percent === null ? 'invalid' : ($percent === 100 ? 'complete' : ($percent >= 50 ? 'progress' : 'started'));
                $dialogId = 'report-actions-' . (int) $row['id'];
                ?>
                <article class="report-card report-card-<?= $tone ?>">
                    <a class="report-card-open" href="index.php?id=<?= (int) $row['id'] ?>" aria-label="Ouvrir le rapport : <?= reportListEscape($name) ?>"><span class="sr-only">Ouvrir</span></a>
                    <h3 class="report-card-name" title="<?= reportListEscape($name) ?>"><?= reportListEscape($name) ?></h3>
                    <div class="report-card-completion">
                        <?php if ($row['completion'] === null): ?>
                            <strong role="alert" title="Remplissage indisponible : checklist invalide, à corriger dans ce rapport.">Remplissage indisponible</strong>
                        <?php else: ?>
                            <strong><?= $percent ?> % <span>rempli</span></strong>
                        <?php endif; ?>
                        <span><?= $row['status'] === 'finalized' ? 'Clôturé' : 'Ouvert' ?></span>
                    </div>
                    <div class="report-card-footer">
                        <span><?= reportListEscape($row['report_date'] ?: 'Date à renseigner') ?></span>
                        <button type="button" class="button button-secondary report-actions-open" data-dialog="<?= $dialogId ?>" aria-haspopup="dialog" aria-controls="<?= $dialogId ?>" aria-label="Actions du rapport : <?= reportListEscape($name) ?>">Actions</button>
                    </div>
                    <dialog id="<?= $dialogId ?>" class="report-actions-dialog" aria-labelledby="<?= $dialogId ?>-title">
                        <h2 id="<?= $dialogId ?>-title"><?= reportListEscape($name) ?></h2>
                        <p>Actions du rapport #<?= (int) $row['id'] ?></p>
                        <?php if ($row['completion'] === null): ?><p role="alert">Remplissage indisponible : checklist invalide, à corriger dans ce rapport.</p><?php endif; ?>
                        <a class="button button-primary" href="rapport.php?id=<?= (int) $row['id'] ?>" target="_blank" rel="noopener">Prévisualiser</a>
                        <form method="post" action="index.php" class="delete-report-form">
                            <input type="hidden" name="csrf_token" value="<?= reportListEscape($csrfToken) ?>">
                            <input type="hidden" name="report_id" value="<?= (int) $row['id'] ?>">
                            <input type="hidden" name="revision" value="<?= (int) $row['revision'] ?>">
                            <input type="hidden" name="action" value="delete">
                            <label><input type="checkbox" name="confirm_delete" value="1" required> Je confirme la suppression du rapport et de ses photos pour toute l’équipe.</label>
                            <button class="button report-delete-button" type="submit" aria-label="Supprimer le rapport <?= (int) $row['id'] ?>">Supprimer</button>
                        </form>
                        <button type="button" class="button button-secondary report-actions-close">Fermer</button>
                    </dialog>
                </article>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
    <?php
    return (string) ob_get_clean();
}
