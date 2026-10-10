<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/pdf.php';
$html = reportPdfHtml(['report_date'=>'2026-10-08', 'intervention_id'=>'008', 'author'=>'Synthetic', 'intervention_followup'=>json_encode([
    ['date'=>'2026-10-07','comment'=>'Contact initial <client>'],
    ['date'=>'2026-10-08','comment'=>"Confirmation\nHoraire convenu"],
])], [], []);
preg_match('/<h2>03 · Organisation[^<]*<\/h2>(.*?)<\/section>/s', $html, $matches);
$section = $matches[1] ?? '';
if (!str_contains($section, 'Voici l’historique de la prise de contact avec le client pour organiser l’intervention.')
    || !str_contains($section, '<li><strong>07/10/2026</strong> — Contact initial &lt;client&gt;</li>')
    || substr_count($section, '<li>') !== 2 || !str_contains($section, '<br')
    || str_contains($section, '<table') || str_contains($section, 'class="notes"') || str_contains($section, 'Suivi intervention')) {
    throw new RuntimeException('Organisation must contain only the introduction and safe dated history bullets.');
}
echo "PASS: Organisation PDF shows dated exchange bullets without a table or boxes.\n";
