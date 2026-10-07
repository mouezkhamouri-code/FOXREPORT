<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Les tests FoxReport doivent être exécutés en ligne de commande.');
}
require_once dirname(__DIR__) . '/app/completion.php';

function checkCompletion(bool $condition, string $label): void
{
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $label);
    }
    echo 'PASS: ' . $label . PHP_EOL;
}

$empty = reportCompletion([]);
checkCompletion($empty === ['filled' => 0, 'total' => 41, 'percent' => 0], 'Empty report is 0% across 41 fields');
checkCompletion(reportCompletion(['training_topics' => '[]'])['filled'] === 0, 'Empty checklist is not filled');
checkCompletion(reportCompletion(['establishment' => '  ', 'nuc_installed' => null])['filled'] === 0, 'Whitespace and null are not filled');
$partial = reportCompletion(['establishment' => 'TEST', 'nuc_installed' => 0, 'training_participants' => '0', 'training_topics' => '["orders_service"]']);
checkCompletion($partial === ['filled' => 4, 'total' => 41, 'percent' => 10], 'Text, No, zero and checklist count; percentage rounded');
checkCompletion(reportCompletion(['training_topics' => ['orders_service', 'payments_refunds']])['filled'] === 1, 'Checklist counts as one field');
checkCompletion(reportCompletion(['status' => 'finalized', 'id' => 1, 'devices' => [['category' => 'ipad']], 'photos' => ['TEST']])['filled'] === 0, 'Status, metadata, photos and devices excluded');
$full = array_fill_keys(FOXREPORT_COMPLETION_FIELDS, 'TEST');
$full['training_topics'] = '["orders_service"]';
checkCompletion(reportCompletion($full) === ['filled' => 41, 'total' => 41, 'percent' => 100], 'All fields filled gives 100%');
try {
    reportCompletion(['training_topics' => 'not-json']);
    throw new RuntimeException('Invalid JSON not rejected');
} catch (JsonException) {
    checkCompletion(true, 'Invalid stored checklist explicitly rejected');
}
