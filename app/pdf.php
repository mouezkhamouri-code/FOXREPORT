<?php
declare(strict_types=1);

require_once __DIR__ . '/report-definition.php';
require_once __DIR__ . '/images.php';
require_once __DIR__ . '/maps.php';
require_once __DIR__ . '/intervention-followup.php';
require_once __DIR__ . '/report-branding.php';

function pdfEscape(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function reportPdfHtml(array $report, array $devices, array $photos, ?string $mapImage = null, string $mapNotice = '', ?string $logo = null): string
{
    global $sections, $deviceCategories, $trainingTopics;
    $fields = [
        12 => ['gallery_url'=>'Lien galerie photo'],
        13 => ['order_date'=>'Date de commande', 'report_date'=>'Date de l’intervention', 'intervention_id'=>'Identifiant intervention', 'author'=>'Rédacteur'],
        1 => [
            'establishment' => 'Établissement', 'address' => 'Adresse',
            'postal_code'=>'Code postal', 'city'=>'Ville',
            'contact_name' => 'Contact', 'contact_phone' => 'Téléphone', 'contact_email' => 'E-mail',
            'sales_rep' => 'Commercial', 'customer_id' => 'Customer ID', 'order_reference' => 'Référence de commande',
            'order_date' => 'Date de commande',
        ],
        2 => [
            'evaluation_minutes' => 'Temps d’intervention (minutes)', 'network_status' => 'Réseau',
            'hardware_installation' => 'Installation matériel', 'skills_transfer' => 'Transfert de compétences',
        ],
        3 => ['all_material_installed' => 'Tout le matériel est installé'],
        4 => ['context_start_time' => 'Heure de début', 'context_end_time' => 'Heure de fin', 'context_notes' => 'Contexte et déroulement'],
        5 => ['nuc_installed' => 'NUC installé', 'internet_present' => 'Internet présent', 'router_switch_present' => 'Routeur / switch présent', 'infrastructure_notes' => 'Infrastructure'],
        6 => ['wifi_comment' => 'Commentaire Wi-Fi'],
        7 => ['printer_comment' => 'Affectation, configuration et commentaire'],
        8 => ['payment_tpe_status' => 'TPE', 'payment_tap_to_pay_status' => 'Tap to Pay', 'payment_comment' => 'Commentaire paiement'],
        9 => ['apple_account_status' => 'Compte Apple', 'lightspeed_activation_status' => 'Activation Lightspeed', 'apple_comment' => 'Commentaire iPad / iPhone'],
        10 => ['training_delivered' => 'Formation dispensée', 'training_participants' => 'Nombre de participants', 'training_comment' => 'Commentaire formation'],
        11 => ['conclusion' => 'Conclusion'],
    ];
    $booleanFields = ['all_material_installed', 'nuc_installed', 'internet_present', 'router_switch_present', 'training_delivered'];
    $statuses = [
        'good' => 'Bon', 'limited' => 'Limité', 'issue' => 'À résoudre', 'not_applicable' => 'Non applicable',
        'complete' => 'Effectué / complet', 'partial' => 'Partiel', 'not_done' => 'Non réalisé',
        'ready' => 'Prêt', 'activated' => 'Activée', 'not_activated' => 'Non activée',
    ];
    $deviceSections = [
        3 => array_keys($deviceCategories), 5 => ['router', 'switch_poe'],
        6 => ['wifi_ap'], 7 => ['printer_wired', 'printer_wifi', 'printer_portable'],
        8 => ['payment_terminal', 'nyc_mobile_tap'], 9 => ['ipad_pro', 'ipad', 'ipad_mini', 'iphone'],
    ];
    $topics = $report['training_topics'] ?? [];
    if (is_string($topics)) {
        $topics = json_decode($topics, true, 512, JSON_THROW_ON_ERROR);
    }
    if (!is_array($topics)) {
        throw new RuntimeException('La checklist de formation enregistrée est invalide.');
    }
    $name = trim((string) ($report['establishment'] ?? ''));
    $locality = trim((string) ($report['postal_code'] ?? '') . ' ' . (string) ($report['city'] ?? ''));
    $date = (string) ($report['report_date'] ?? '');
    if ($date !== '') {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if (!$parsed || $parsed->format('Y-m-d') !== $date) throw new RuntimeException('Date d’intervention invalide pour l’en-tête du rapport.');
        $date = $parsed->format('d/m/Y');
    }
    $nameLines = max(1, count(explode("\n", wordwrap($name, 42, "\n", true))));
    $localityLines = max(1, count(explode("\n", wordwrap($locality, 55, "\n", true))));
    $headerHeight = max(25, 12 + $nameLines * 6 + $localityLines * 6);
    $topMargin = $headerHeight + 12;
    $html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
        @page { margin: ' . $topMargin . 'mm 17mm 20mm; }
        body { font-family: "DejaVu Sans", sans-serif; font-size: 9pt; color: #172033; }
        header { position: fixed; top: -' . ($headerHeight + 5) . 'mm; left: 0; right: 0; height: ' . $headerHeight . 'mm; color: #111827; }
        .report-header-logo { position: absolute; top: 0; left: 0; max-width: 40mm; max-height: 25mm; }
        .report-header-text { position: absolute; top: 0; left: 46mm; right: 0; }
        .report-header-text.no-logo { left: 0; }
        .report-header-title { font-size: 11.5pt; line-height: 1.15; margin-bottom: .8mm; }
        .report-header-name { font-size: 13.5pt; line-height: 1.15; font-weight: bold; margin-bottom: .8mm; word-wrap: break-word; }
        .report-header-locality { font-size: 12pt; line-height: 1.15; word-wrap: break-word; }
        .section { page-break-before: always; }
        .section.first { page-break-before: auto; }
        h1 { font-size: 20pt; margin: 0 0 4mm; color: #176B75; }
        h2 { font-size: 15pt; margin: 0 0 6mm; }
        h3 { font-size: 10pt; margin: 5mm 0 2mm; page-break-after: avoid; }
        p { line-height: 1.5; overflow-wrap: anywhere; }
        .subtitle { color: #596579; font-size: 9pt; margin: 0 0 8mm; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { padding: 3mm; border: 1px solid #DCE5E7; vertical-align: top; word-wrap: break-word; }
        th { background: #E5F1F2; text-align: left; font-weight: normal; }
        .fields th { width: 34%; }
        .quantities th, .quantities td { padding: 2mm 3mm; }
        tr { page-break-inside: avoid; }
        .devices { font-size: 7pt; margin-bottom: 4mm; }
        .devices th, .devices td { padding: 2mm; }
        .notes { border: 1px solid #DCE5E7; min-height: 26mm; padding: 3mm; margin-bottom: 4mm; white-space: pre-wrap; word-wrap: break-word; }
        .placeholder { color: #8893a4; }
        .photo { page-break-inside: avoid; margin: 4mm 0; padding: 3mm; border: 1px solid #DCE5E7; text-align: center; }
        .photo img { max-width: 165mm; max-height: 70mm; }
        .photo.widescreen img { width: 165mm; height: auto; max-height: none; }
        .caption { margin: 2mm 0 0; font-size: 8pt; word-wrap: break-word; }
        .location { page-break-inside: avoid; margin: 4mm 0; }
        .location img { width: 176mm; height: 99mm; }
        .check { padding: 2mm 0; }
    </style></head><body><header>'
        . ($logo !== null ? '<img class="report-header-logo" src="' . pdfEscape($logo) . '" alt="Logo du rapport">' : '')
        . '<div class="report-header-text' . ($logo === null ? ' no-logo' : '') . '"><div class="report-header-title">COMPTE RENDU INSTALLATION FORMATION</div>'
        . '<div class="report-header-name">' . pdfEscape($name !== '' ? $name : 'Établissement à renseigner') . '</div>'
        . '<div class="report-header-locality">' . pdfEscape($locality) . ($date !== '' ? ($locality !== '' ? ' &nbsp; ' : '') . 'le ' . pdfEscape($date) : '') . '</div>'
        . '</div></header>';
    foreach ($sections as $number => $label) {
        $html .= '<section class="section' . ($number === 1 ? ' first' : '') . '">';
        if ($number === 1) {
            $html .= '<p class="subtitle">'
                . ($report === [] ? 'MODÈLE VIDE · Prévisualisation de la mise en page' : (($report['status'] ?? 'draft') === 'finalized' ? 'FINALISÉ' : 'BROUILLON'))
                . '</p>';
        }
        $position = array_search($number, array_keys($sections), true) + 1;
        $html .= '<h2>' . sprintf('%02d', $position) . ' · ' . pdfEscape($label) . '</h2><table class="fields">';
        foreach ($fields[$number] as $key => $fieldLabel) {
            if (str_ends_with($key, '_notes') || str_ends_with($key, '_comment') || $key === 'conclusion') {
                continue;
            }
            $value = $report[$key] ?? '';
            if (in_array($key, $booleanFields, true)) {
                $value = $value === '' || $value === null ? '' : ((int) $value === 1 ? 'Oui' : 'Non');
            } elseif (str_ends_with($key, '_status') || in_array($key, ['hardware_installation', 'skills_transfer'], true)) {
                $value = $statuses[$value] ?? $value;
            }
            $html .= '<tr><th>' . pdfEscape($fieldLabel) . '</th><td>'
                . ((string) $value !== '' ? nl2br(pdfEscape((string) $value)) : '<span class="placeholder">À renseigner</span>') . '</td></tr>';
        }
        $html .= '</table>';
        if ($number === 13) {
            $html .= '<h3>Suivi intervention</h3>';
            $followup = interventionFollowup($report['intervention_followup'] ?? null);
            if ($followup === []) $html .= '<p class="placeholder">Aucun suivi enregistré.</p>';
            foreach ($followup as $row) {
                $html .= '<h3>' . pdfEscape($row['date']) . '</h3><div class="notes">' . pdfEscape($row['comment']) . '</div>';
            }
        }
        if ($number === 12 && ($report['latitude'] ?? null) !== null && ($report['longitude'] ?? null) !== null) {
            $html .= '<div class="location"><h3>Localisation de l’intervention</h3><p>'
                . pdfEscape((string) $report['latitude']) . ', ' . pdfEscape((string) $report['longitude'])
                . ' · Zoom ' . pdfEscape((string) ($report['map_zoom'] ?? 15)) . '</p>';
            if ($mapImage !== null) {
                $html .= '<img src="data:image/png;base64,' . base64_encode($mapImage) . '" alt="Localisation Google Maps">';
            } else {
                $html .= '<p class="placeholder">' . pdfEscape($mapNotice ?: 'Carte non disponible ; coordonnées conservées.') . '</p>';
            }
            $html .= '</div>';
        }
        if ($number === 3) {
            $counts = array_fill_keys(array_keys($deviceCategories), 0);
            foreach ($devices as $device) {
                if (isset($counts[$device['category']])) {
                    $counts[$device['category']]++;
                }
            }
            $html .= '<h3>Quantités de matériel</h3><table class="fields quantities">';
            foreach ($deviceCategories as $category => $name) {
                $html .= '<tr><th>' . pdfEscape($name) . '</th><td>' . $counts[$category] . '</td></tr>';
            }
            $html .= '</table>';
        }
        if (isset($deviceSections[$number])) {
            $html .= '<h3>Appareils détaillés</h3>';
            $matching = array_filter($devices, static fn(array $device): bool => in_array($device['category'], $deviceSections[$number], true));
            if ($matching === []) {
                $html .= '<p class="placeholder">Aucun appareil renseigné.</p>';
            }
            foreach ($matching as $device) {
                $html .= '<table class="devices"><tr><th>Catégorie / marque / modèle</th><th>Numéro de série / MAC</th><th>Emplacement / état</th></tr><tr><td>'
                    . pdfEscape($deviceCategories[$device['category']] ?? $device['category']) . '<br>'
                    . pdfEscape(trim(($device['brand'] ?? '') . ' ' . ($device['model'] ?? ''))) . '</td><td>'
                    . pdfEscape((string) ($device['serial_number'] ?? '')) . '<br>'
                    . pdfEscape((string) ($device['mac_address'] ?? '')) . '</td><td>'
                    . pdfEscape((string) ($device['location'] ?? '')) . '<br>'
                    . pdfEscape(['installed' => 'Installé', 'configured' => 'Configuré', 'already_present' => 'Déjà présent'][$device['state']] ?? '') . '</td></tr>'
                    . '<tr><td colspan="3">' . nl2br(pdfEscape((string) ($device['comment'] ?? ''))) . '</td></tr></table>';
            }
        }
        if ($number === 10) {
            $html .= '<h3>Thèmes de formation</h3>';
            foreach ($trainingTopics as $topic => $topicLabel) {
                $html .= '<div class="check">' . (in_array($topic, $topics, true) ? '☑' : '☐') . ' ' . pdfEscape($topicLabel) . '</div>';
            }
        }
        foreach ($fields[$number] as $key => $fieldLabel) {
            if (!str_ends_with($key, '_notes') && !str_ends_with($key, '_comment') && $key !== 'conclusion') {
                continue;
            }
            $text = (string) ($report[$key] ?? '');
            $html .= '<h3>' . pdfEscape($fieldLabel) . '</h3><div class="notes">'
                . ($text !== '' ? pdfEscape($text) : '<span class="placeholder">À compléter</span>') . '</div>';
        }
        if (!in_array($number, [1,13], true)) $html .= '<h3>Photos et légendes</h3>';
        $matchingPhotos = in_array($number, [1,13], true) ? [] : array_filter($photos, static fn(array $photo): bool => (int) $photo['section_number'] === ($number === 12 ? 1 : $number));
        if (!in_array($number, [1,13], true) && $matchingPhotos === []) {
            $html .= '<div class="notes placeholder">Aucune photo ajoutée à cette section.</div>';
        }
        foreach ($matchingPhotos as $photo) {
            $path = storedPhotoPath($photo);
            $bytes = file_get_contents($path);
            if ($bytes === false) {
                throw new RuntimeException('Impossible de lire une photo pour le PDF.');
            }
            $dimensions = imageOperation(static fn() => getimagesize($path));
            if ($dimensions === false) throw new RuntimeException('Dimensions de photo illisibles pour le PDF.');
            $widescreen = $dimensions[0] > $dimensions[1] && abs($dimensions[0] - $dimensions[1] * 16 / 9) <= 2;
            $html .= '<div class="photo' . ($widescreen ? ' widescreen' : '') . '"><img src="data:' . pdfEscape($photo['mime_type']) . ';base64,' . base64_encode($bytes)
                . '"><p class="caption">' . pdfEscape($photo['caption'] ?: 'Sans légende') . '</p></div>';
        }
        $html .= '</section>';
    }
    return $html . '</body></html>';
}

function renderReportPdf(array $report, array $devices, array $photos, ?string $logo = null): Dompdf\Dompdf
{
    foreach (['dom', 'mbstring', 'gd'] as $extension) {
        if (!extension_loaded($extension)) {
            throw new RuntimeException('Activez l’extension PHP ' . $extension . ' pour générer le PDF.');
        }
    }
    $root = dirname(__DIR__);
    $autoload = $root . '/vendor/autoload.php';
    if (!is_file($autoload)) {
        throw new RuntimeException('Installez les dépendances PDF avec composer install avant de prévisualiser un rapport.');
    }
    require_once $autoload;
    $cache = $root . '/storage/pdf-cache';
    if (!is_dir($cache) || !is_writable($cache)) {
        throw new RuntimeException('Le dossier storage/pdf-cache doit être présent et accessible en écriture.');
    }
    $options = new Dompdf\Options([
        'isRemoteEnabled' => false,
        'isPhpEnabled' => false,
        'isJavascriptEnabled' => false,
        'allowedProtocols' => ['data://' => ['rules' => []]],
        'chroot' => [$cache],
        'tempDir' => $cache,
        'fontCache' => $cache,
        'defaultFont' => 'DejaVu Sans',
    ]);
    $pdf = new Dompdf\Dompdf($options);
    $pdf->setPaper('A4', 'portrait');
    $mapImage = null;
    $mapNotice = '';
    if (($report['latitude'] ?? null) !== null && ($report['longitude'] ?? null) !== null) {
        try {
            $config = mapsConfig();
            if (($config['pdf_allowed'] ?? false) !== true) {
                throw new RuntimeException('Carte omise du PDF : autorisation contractuelle Google pour cet usage non confirmée.');
            }
            $mapImage = googleStaticImage(locationFields($report), $config);
        } catch (RuntimeException $exception) {
            error_log('FoxReport PDF map unavailable: ' . $exception->getMessage());
            $mapNotice = $exception->getMessage();
        }
    }
    $pdf->loadHtml(reportPdfHtml($report, $devices, $photos, $mapImage, $mapNotice, $logo ?? reportLogoData()), 'UTF-8');
    $pdf->render();
    $pdf->getCanvas()->page_text(48, 810, 'FoxReport · {PAGE_NUM} / {PAGE_COUNT}', $pdf->getFontMetrics()->getFont('DejaVu Sans'), 8, [0.4, 0.45, 0.55]);
    return $pdf;
}
