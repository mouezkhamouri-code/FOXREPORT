<?php
declare(strict_types=1);

function photoKey(array $photo): string
{
    return $photo['client_uid'] ?: 'photo.php?id=' . (int) $photo['id'];
}

function photoStateInput(array $input): array
{
    $state = [];
    foreach (['photo_order', 'photo_deleted'] as $name) {
        $value = $input[$name] ?? '[]';
        if (!is_string($value) || strlen($value) > 30000) throw new RuntimeException('Organisation des photos invalide.');
        try {
            $keys = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new RuntimeException('Organisation des photos illisible.');
        }
        if (!is_array($keys) || !array_is_list($keys) || count($keys) > 500) throw new RuntimeException('Organisation des photos invalide.');
        foreach ($keys as $key) {
            if (!is_string($key) || !preg_match('/^(?:photo\.php\?id=[1-9][0-9]*|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/', $key)) {
                throw new RuntimeException('Référence de photo invalide.');
            }
        }
        if (count(array_unique($keys)) !== count($keys)) throw new RuntimeException('Une photo apparaît plusieurs fois dans l’organisation.');
        $state[$name] = $keys;
    }
    $value = $input['photo_captions'] ?? '{}';
    if (!is_string($value) || strlen($value) > 200000) throw new RuntimeException('Légendes des photos invalides.');
    try {
        $captions = json_decode($value === '' ? '{}' : $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RuntimeException('Légendes des photos illisibles.');
    }
    if (!is_array($captions) || ($captions !== [] && array_is_list($captions)) || count($captions) > 500) throw new RuntimeException('Légendes des photos invalides.');
    $state['photo_captions'] = [];
    foreach ($captions as $key => $caption) {
        if (!is_string($key) || !preg_match('/^(?:photo\.php\?id=[1-9][0-9]*|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/', $key)) {
            throw new RuntimeException('Référence de photo invalide.');
        }
        if (!is_string($caption) || strlen(trim($caption)) > 500) throw new RuntimeException('Une légende de photo dépasse la longueur autorisée.');
        $state['photo_captions'][$key] = trim($caption);
    }
    return $state;
}

function savePhotoState(PDO $pdo, int $reportId, array $state): void
{
    $query = $pdo->prepare('SELECT id, client_uid, section_number, deleted_at FROM foxreport_photos WHERE report_id = ? ORDER BY sort_order, id');
    $query->execute([$reportId]);
    $photos = [];
    foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $photo) $photos[photoKey($photo)] = $photo;
    foreach (array_unique(array_merge($state['photo_order'], $state['photo_deleted'])) as $key) {
        if (isset($photos[$key])) continue;
        if (in_array($key, $state['photo_deleted'], true) && !str_starts_with($key, 'photo.php')) {
            $owner = $pdo->prepare('SELECT report_id FROM foxreport_photos WHERE client_uid = ?');
            $owner->execute([$key]);
            if ($owner->fetchColumn() === false) continue;
        }
        throw new RuntimeException('Une photo référencée n’appartient pas à ce rapport. Rechargez les photos.');
    }
    $delete = $pdo->prepare('UPDATE foxreport_photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND report_id = ? AND deleted_at IS NULL');
    foreach ($state['photo_deleted'] as $key) {
        if (!isset($photos[$key])) continue;
        $delete->execute([(int) $photos[$key]['id'], $reportId]);
        unset($photos[$key]);
    }
    // Caption edits of already saved photos; photos deleted meanwhile are ignored.
    $caption = $pdo->prepare('UPDATE foxreport_photos SET caption = ? WHERE id = ? AND report_id = ? AND deleted_at IS NULL');
    foreach ($state['photo_captions'] ?? [] as $key => $text) {
        if (isset($photos[$key]) && $photos[$key]['deleted_at'] === null) $caption->execute([$text, (int) $photos[$key]['id'], $reportId]);
    }
    $order = array_unique(array_merge($state['photo_order'], array_keys($photos)));
    $positions = [];
    $update = $pdo->prepare('UPDATE foxreport_photos SET sort_order = ? WHERE id = ? AND report_id = ?');
    foreach ($order as $key) {
        $photo = $photos[$key] ?? null;
        if (!$photo || $photo['deleted_at'] !== null) continue;
        $section = (int) $photo['section_number'];
        $positions[$section] = ($positions[$section] ?? 0) + 1;
        $update->execute([$positions[$section], (int) $photo['id'], $reportId]);
    }
}
