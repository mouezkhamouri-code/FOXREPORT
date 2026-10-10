<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/pdf.php';
foreach ([0, '0'] as $answer) {
    $html = reportPdfHtml(['training_delivered' => $answer, 'training_participants' => 5, 'training_topics' => 'invalid-legacy-checklist', 'training_comment' => 'Client déjà compétent'], [], []);
    if (str_contains($html, 'Checklist de formation') || str_contains($html, 'Nombre de participants') || !str_contains($html, 'Client déjà compétent')) {
        throw new RuntimeException('A training marked No must omit its programme and participants while keeping its comment.');
    }
}
$html = reportPdfHtml(['training_delivered' => 1, 'training_topics' => '[]'], [], []);
if (!str_contains($html, 'Checklist de formation')) throw new RuntimeException('Training marked Yes must keep its programme.');
echo "PASS: PDF training programme follows the recorded answer, including legacy checklist data.\n";

if (str_contains($html, 'Photos et légendes') || str_contains($html, 'Aucune photo ajoutée à cette section')) {
    throw new RuntimeException('Sections without photos must not print an empty photo heading or placeholder.');
}
echo "PASS: Empty photo blocks are omitted from the PDF.\n";
