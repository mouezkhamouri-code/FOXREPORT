<?php
declare(strict_types=1);

require_once __DIR__ . '/completion.php';

function reportListEscape(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function reportListIcon(string $name): string
{
    $paths = [
        'pin' => '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
        'phone' => '<path d="m6 3 3 4-2 3a15 15 0 0 0 7 7l3-2 4 3c-1 4-4 4-6 3A23 23 0 0 1 3 9C2 6 3 3 6 3Z"/>',
        'more' => '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    ];
    return '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' . $paths[$name] . '</svg>';
}

function reportListDate(string $date): string
{
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$parsed || $parsed->format('Y-m-d') !== $date) {
        return $date ?: 'Date à renseigner';
    }
    $months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return $parsed->format('j') . ' ' . $months[(int) $parsed->format('n') - 1] . ' ' . $parsed->format('Y');
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
        $report = array_intersect_key($row, array_flip(['id', 'revision', 'establishment', 'report_date', 'report_type', 'status', 'address', 'contact_name', 'contact_phone']));
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
                    <div class="report-card-heading">
                        <h3 class="report-card-name" title="<?= reportListEscape($name) ?>"><?= reportListEscape($name) ?></h3>
                        <span class="report-card-status <?= $row['status'] === 'finalized' ? 'is-closed' : '' ?>"><?= $row['status'] === 'finalized' ? 'Clôturé' : 'Ouvert' ?></span>
                    </div>
                    <?php
                    $address = trim((string) ($row['address'] ?? ''));
                    $contact = trim((string) ($row['contact_name'] ?? ''));
                    $phone = trim((string) ($row['contact_phone'] ?? ''));
                    $dialSource = str_starts_with($phone, '+') ? str_replace('(0)', '', $phone) : $phone;
                    $dial = preg_replace('/[\s().-]+/', '', $dialSource);
                    $callable = $dial !== null && preg_match('/^\+?[0-9]{3,15}$/', $dial) === 1;
                    ?>
                    <?php if ($address !== ''): ?>
                        <div class="report-card-address">
                            <?= reportListIcon('pin') ?>
                            <a href="https://www.google.com/maps/search/?api=1&amp;query=<?= rawurlencode($address) ?>" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir Maps : <?= reportListEscape($address) ?>"><?= reportListEscape($address) ?></a>
                            <a class="report-card-waze" href="https://www.waze.com/ul?q=<?= rawurlencode($address) ?>&amp;navigate=yes" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir Waze : <?= reportListEscape($address) ?>">Waze</a>
                        </div>
                    <?php endif; ?>
                    <?php if ($contact !== '' || $phone !== ''): ?>
                        <div class="report-card-contact">
                            <?= reportListIcon('phone') ?>
                            <div class="report-card-contact-details">
                            <?php if ($contact !== ''): ?><strong><?= reportListEscape($contact) ?></strong><?php endif; ?>
                            <?php if ($phone !== ''): ?>
                                <?php if ($callable): ?><a href="tel:<?= reportListEscape($dial) ?>" aria-label="Appeler <?= reportListEscape($contact !== '' ? $contact : $phone) ?>"><?= reportListEscape($phone) ?></a>
                                <?php else: ?><span><?= reportListEscape($phone) ?></span><?php endif; ?>
                            <?php endif; ?>
                            </div>
                        </div>
                    <?php endif; ?>
                    <div class="report-card-completion">
                        <?php if ($row['completion'] === null): ?>
                            <strong role="alert" title="Remplissage indisponible : checklist invalide, à corriger dans ce rapport.">Remplissage indisponible</strong>
                        <?php else: ?>
                            <strong><?= $percent ?> % <span>rempli</span></strong>
                            <progress class="report-card-progress-bar" value="<?= (int) $percent ?>" max="100" aria-label="Remplissage du rapport : <?= reportListEscape($name) ?>"><?= $percent ?> %</progress>
                        <?php endif; ?>
                        <time class="report-card-date" datetime="<?= reportListEscape($row['report_date'] ?? '') ?>"><?= reportListEscape(reportListDate($row['report_date'] ?? '')) ?></time>
                    </div>
                    <div class="report-card-footer">
                        <a class="button button-primary report-card-open" href="index.php?id=<?= (int) $row['id'] ?>" aria-label="Ouvrir le rapport : <?= reportListEscape($name) ?>">Ouvrir</a>
                        <button type="button" class="button button-secondary report-actions-open" data-dialog="<?= $dialogId ?>" aria-haspopup="dialog" aria-controls="<?= $dialogId ?>" aria-label="Actions du rapport : <?= reportListEscape($name) ?>"><?= reportListIcon('more') ?>Actions</button>
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
