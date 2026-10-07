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
    <div class="panel-heading"><div><p class="eyebrow">ARCHIVE</p><h2>Interventions récentes</h2></div><span class="count-pill"><?= count($reports) ?> rapport<?= count($reports) > 1 ? 's' : '' ?></span></div>
    <?php if ($reports === []): ?>
        <div class="empty-state"><div class="empty-icon">＋</div><h3><?= $filter === 'all' ? 'Tout commence ici' : 'Aucun rapport ' . ($filter === 'open' ? 'ouvert' : 'clôturé') ?></h3><p>Changez de filtre ou créez un nouveau rapport.</p></div>
    <?php else: ?>
        <div class="table-wrap"><table class="report-table">
            <thead><tr><th>Établissement</th><th>Date</th><th>Type</th><th>Statut</th><th>Remplissage</th><th><span class="sr-only">Ouvrir</span></th><th>Suppression</th></tr></thead>
            <tbody>
            <?php foreach ($reports as $row): ?>
                <tr>
                    <td data-label="Établissement"><strong><?= reportListEscape($row['establishment'] !== '' ? $row['establishment'] : 'Établissement à renseigner') ?></strong></td>
                    <td data-label="Date"><?= reportListEscape($row['report_date'] ?: '—') ?></td>
                    <td data-label="Type"><?= reportListEscape($row['report_type']) ?></td>
                    <td data-label="Statut"><span class="status-badge <?= $row['status'] === 'finalized' ? 'status-final' : 'status-draft' ?>"><span></span><?= $row['status'] === 'finalized' ? 'Clôturé' : 'Ouvert' ?></span></td>
                    <td data-label="Remplissage">
                        <?php if ($row['completion'] === null): ?>
                            <span role="alert">Remplissage indisponible : checklist invalide, à corriger dans ce rapport.</span>
                        <?php else: ?>
                            <div class="report-completion">
                                <span class="completion-label"><?= $row['completion']['percent'] ?> % <small><?= $row['completion']['filled'] ?>/<?= $row['completion']['total'] ?> champs</small></span>
                                <progress value="<?= $row['completion']['filled'] ?>" max="<?= $row['completion']['total'] ?>" aria-label="Remplissage du rapport : <?= $row['completion']['percent'] ?> %"><?= $row['completion']['percent'] ?> %</progress>
                            </div>
                        <?php endif; ?>
                    </td>
                    <td class="table-action"><a class="button button-secondary button-small" href="index.php?id=<?= (int) $row['id'] ?>">Ouvrir <span aria-hidden="true">→</span></a></td>
                    <td>
                        <details class="actions-menu"><summary class="button button-secondary button-small">Actions</summary><div class="actions-content">
                        <a class="button button-secondary" href="rapport.php?id=<?= (int) $row['id'] ?>" target="_blank" rel="noopener">Prévisualiser le PDF</a>
                        <form method="post" action="index.php" class="delete-report-form">
                            <input type="hidden" name="csrf_token" value="<?= reportListEscape($csrfToken) ?>">
                            <input type="hidden" name="report_id" value="<?= (int) $row['id'] ?>">
                            <input type="hidden" name="revision" value="<?= (int) $row['revision'] ?>">
                            <input type="hidden" name="action" value="delete">
                            <label><input type="checkbox" name="confirm_delete" value="1" required> Confirmer</label>
                            <button class="button button-secondary button-small" type="submit" aria-label="Supprimer le rapport <?= (int) $row['id'] ?>">Supprimer</button>
                        </form>
                        </div></details>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table></div>
    <?php endif; ?>
    <?php
    return (string) ob_get_clean();
}
