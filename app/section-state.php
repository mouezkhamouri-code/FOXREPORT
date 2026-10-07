<?php
declare(strict_types=1);

function completedSections(mixed $value): array
{
    if ($value === null || $value === '') { return []; }
    if (!is_string($value) || strlen($value) > 100) {
        throw new RuntimeException('Les états des sections sont invalides.');
    }
    try {
        $sections = json_decode($value, false, 8, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        throw new RuntimeException('Les états des sections sont illisibles.', 0, $exception);
    }
    if (!is_array($sections) || !array_is_list($sections) || count($sections) > 13) {
        throw new RuntimeException('Les états des sections sont invalides.');
    }
    foreach ($sections as $number) {
        if (!is_int($number) || $number < 1 || $number > 13) {
            throw new RuntimeException('Une section terminée est invalide.');
        }
    }
    $sections = array_values(array_unique($sections));
    sort($sections);
    return $sections;
}
