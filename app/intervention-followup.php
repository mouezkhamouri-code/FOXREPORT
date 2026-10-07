<?php
declare(strict_types=1);

function interventionFollowup(mixed $value): array
{
    if ($value === null || $value === '') return [];
    if (!is_string($value) || strlen($value) > 60000) throw new RuntimeException('Le suivi intervention est trop volumineux ou invalide.');
    if (!str_starts_with(ltrim($value), '[')) throw new RuntimeException('Le suivi intervention doit être une liste de lignes.');
    try { $rows = json_decode($value, true, 8, JSON_THROW_ON_ERROR); }
    catch (JsonException) { throw new RuntimeException('Le suivi intervention est illisible.'); }
    if (!is_array($rows) || !array_is_list($rows) || count($rows) > 100) throw new RuntimeException('Le suivi intervention accepte au maximum 100 lignes.');
    $result = [];
    foreach ($rows as $row) {
        if (!is_array($row) || !is_string($row['date'] ?? null) || !is_string($row['comment'] ?? null)) throw new RuntimeException('Une ligne du suivi intervention est invalide.');
        $date = $row['date'];
        $comment = trim($row['comment']);
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if (!$parsed || $parsed->format('Y-m-d') !== $date || $comment === '' || strlen($comment) > 4000) throw new RuntimeException('Chaque ligne du suivi nécessite une date valide et un commentaire (4 000 octets maximum).');
        $result[] = ['date'=>$date, 'comment'=>$comment];
    }
    return $result;
}
