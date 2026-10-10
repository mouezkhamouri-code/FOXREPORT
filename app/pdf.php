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

function pdfPhotoHtml(array $photo, bool $cover = false, bool $square = false): string
{
    $path = storedPhotoPath($photo);
    $bytes = file_get_contents($path);
    if ($bytes === false) throw new RuntimeException('Impossible de lire une photo pour le PDF.');
    $dimensions = imageOperation(static fn() => getimagesize($path));
    if ($dimensions === false) throw new RuntimeException('Dimensions de photo illisibles pour le PDF.');
    $mime = $photo['mime_type'];
    $ratio = $cover ? 2.6 : ($square ? 1.0 : null);
    if ($ratio !== null && abs($dimensions[0] - $dimensions[1] * $ratio) > 2) {
        validatePhotoSource($path);
        $bytes = imageOperation(static function () use ($bytes, $dimensions, $ratio): string {
            $source = imagecreatefromstring($bytes);
            if ($source === false) throw new RuntimeException('Photo illisible pour le recadrage PDF.');
            $cropWidth = min($dimensions[0], $dimensions[1] * $ratio);
            $cropHeight = $cropWidth / $ratio;
            $width = min($ratio === 1.0 ? 1200 : 1600, (int) $cropWidth);
            $height = max(1, (int) round($width / $ratio));
            $output = imagecreatetruecolor($width, $height);
            if ($output === false) throw new RuntimeException('Recadrage PDF indisponible.');
            imagefill($output, 0, 0, imagecolorallocate($output, 255, 255, 255));
            if (!imagecopyresampled($output, $source, 0, 0, (int) (($dimensions[0] - $cropWidth) / 2),
                (int) (($dimensions[1] - $cropHeight) / 2), $width, $height, (int) $cropWidth, (int) $cropHeight)) {
                throw new RuntimeException('Recadrage PDF impossible.');
            }
            ob_start();
            try {
                if (!imagejpeg($output, null, 90)) throw new RuntimeException('Compression de la photo PDF impossible.');
                return (string) ob_get_contents();
            } finally { ob_end_clean(); }
        });
        $mime = 'image/jpeg';
    }
    $wide = $dimensions[0] > $dimensions[1] && (abs($dimensions[0] - $dimensions[1] * 16 / 9) <= 2
        || abs($dimensions[0] - $dimensions[1] * 3.2) <= 2 || abs($dimensions[0] - $dimensions[1] * 2.6) <= 2);
    $captionText = trim((string) ($photo['caption'] ?? ''));
    $caption = (int) $photo['section_number'] === 1 || $captionText === '' ? '' : '<p class="caption">' . pdfEscape($captionText) . '</p>';
    return '<div class="photo' . ($cover ? ' cover-photo' : ($square ? ' square-photo' : ($wide ? ' widescreen' : ''))) . '"><img src="data:'
        . pdfEscape($mime) . ';base64,' . base64_encode($bytes) . '">' . $caption . '</div>';
}

function reportPdfHtml(array $report, array $devices, array $photos, ?string $mapImage = null, string $mapNotice = '', ?string $logo = null): string
{
    global $sections, $deviceCategories, $trainingTopics;
    $fields = [
        12 => [],
        13 => ['order_date'=>'Date de commande', 'report_date'=>'Date de l’intervention', 'intervention_id'=>'Identifiant intervention', 'author'=>'Rédacteur'],
        1 => [
            'establishment' => 'Établissement', 'address' => 'Adresse',
            'postal_code'=>'Code postal', 'city'=>'Ville',
            'contact_name' => 'Contact', 'contact_phone' => 'Téléphone', 'contact_email' => 'E-mail',
            'sales_rep' => 'Commercial', 'customer_id' => 'N° identification entreprise', 'establishment_id' => 'N° identification établissement', 'order_reference' => 'Référence de commande',
            'order_date' => 'Date de commande',
        ],
        3 => ['all_material_installed' => 'Tout le matériel est installé', 'equipment_comment' => 'Commentaire matériel'],
        4 => ['context_start_time' => 'Heure de début', 'context_end_time' => 'Heure de fin', 'context_notes' => 'Contexte et déroulement'],
        5 => [
            'network_type' => 'Type de réseau',
            'nebula_controller_configured' => 'Nebula / contrôleur configuré',
            'internet_present' => 'Internet présent',
            'switch_present' => 'Switch présent',
            'infrastructure_notes' => 'Infrastructure réseau',
        ],
        6 => ['wifi_comment' => 'Commentaire Wi-Fi'],
        7 => ['printer_comment' => 'Affectation, configuration et commentaire'],
        8 => ['payment_tpe_status' => 'TPE', 'payment_tap_to_pay_status' => 'Tap to Pay', 'payment_comment' => 'Commentaire paiement'],
        9 => ['apple_account_status' => 'Compte Apple', 'lightspeed_activation_status' => 'Activation Lightspeed', 'apple_comment' => 'Commentaire iPad / iPhone'],
        10 => ['training_delivered' => 'Formation dispensée', 'training_participants' => 'Nombre de participants', 'training_comment' => 'Commentaire formation'],
        11 => ['conclusion' => 'Conclusion'],
    ];
    $booleanFields = ['all_material_installed', 'nebula_controller_configured', 'internet_present', 'switch_present', 'training_delivered'];
    $statuses = [
        'medium' => 'Moyen', 'good' => 'Bon', 'bad' => 'Mauvais', 'errors' => 'Erreurs',
        'no_network' => 'Pas de réseau', 'missing_connections' => 'Manque des connexions',
        'limited' => 'Limité', 'issue' => 'À résoudre', 'not_applicable' => 'Non applicable',
        'complete' => 'Effectué / complet', 'partial' => 'Partiel', 'not_done' => 'Non réalisé', 'already_trained' => 'Client déjà formé',
        'ready' => 'Prêt', 'activated' => 'Activée', 'not_activated' => 'Non activée',
    ];
    $deviceSections = [
        3 => array_keys($deviceCategories), 5 => ['router', 'switch_poe'],
        6 => ['wifi_ap'], 7 => ['printer_wired', 'printer_wifi', 'printer_portable'],
        8 => ['payment_terminal', 'nyc_mobile_tap'], 9 => ['ipad_pro', 'ipad', 'ipad_mini', 'iphone'],
    ];
    $training = trainingChecklistState($report['training_topics'] ?? []);
    $trainingDelivered = $report['training_delivered'] ?? null;
    $noTraining = ($trainingDelivered !== null && $trainingDelivered !== '' && (int) $trainingDelivered === 0)
        || in_array($report['skills_transfer'] ?? '', ['not_done', 'already_trained'], true);
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
    $topMargin = $headerHeight + 10;
    $sitePhotos = array_values(array_filter($photos, static fn(array $photo): bool => (int) $photo['section_number'] === 1));
    $reportStatus = $report === [] ? 'MODÈLE VIDE' : (($report['status'] ?? 'draft') === 'finalized' ? 'FINALISÉ' : 'BROUILLON');
    $html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
        @page { margin: ' . $topMargin . 'mm 17mm 32mm; }
        body { font-family: "DejaVu Sans", sans-serif; font-size: 9pt; color: #172033; }
        header { position: fixed; top: -' . ($headerHeight + 3) . 'mm; left: 0; right: 0; height: ' . $headerHeight . 'mm; color: #111827; }
        .report-header-logo { position: absolute; top: 0; left: 0; max-width: 40mm; max-height: 25mm; }
        .report-header-text { position: absolute; top: 0; left: 46mm; right: 0; }
        .report-header-text.no-logo { left: 0; }
        .report-header-title { font-size: 11.5pt; line-height: 1.15; margin-bottom: .8mm; }
        .report-header-name { font-size: 13.5pt; line-height: 1.15; font-weight: bold; margin-bottom: .8mm; word-wrap: break-word; }
        .report-header-locality { font-size: 12pt; line-height: 1.15; word-wrap: break-word; }
        .section + .section { padding-top: 8mm; }
        h1 { font-size: 20pt; margin: 0 0 4mm; color: #176B75; }
        h2 { font-size: 15pt; margin: 0 0 4mm; page-break-after: avoid; }
        h3 { font-size: 10pt; margin: 5mm 0 2mm; page-break-after: avoid; }
        p { line-height: 1.5; overflow-wrap: anywhere; }
        .report-footer { position: fixed; bottom: -26mm; left: 0; right: 0; height: 22mm; border-top: 1px solid #172033; padding-top: 1mm; }
        .report-footer-brand { font-size: 9pt; font-weight: bold; margin-bottom: 2mm; }
        .report-footer-meta { font-size: 7pt; line-height: 1.3; word-wrap: break-word; padding-right: 24mm; }
        .report-footer-status { position: absolute; top: 7mm; right: 0; font-size: 7pt; color: #596579; }
        .report-footer-confidential { position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 9pt; font-weight: bold; font-style: italic; color: #D00000; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { padding: 3mm; border: 1px solid #DCE5E7; vertical-align: top; word-wrap: break-word; }
        th { background: #E5F1F2; text-align: left; font-weight: normal; }
        .fields th { width: 34%; }
        /* Rounded data tables: separate borders so the outer radius is drawn, inner lines kept as separators. */
        table.fields, table.devices { border-collapse: separate; border-spacing: 0; border: 1px solid #DCE5E7; border-radius: 2mm; margin-bottom: 3mm; }
        .fields th, .fields td, .devices th, .devices td { border: 0; border-top: 1px solid #DCE5E7; }
        .fields td, .devices th + th, .devices td + td { border-left: 1px solid #DCE5E7; }
        .fields tr:first-child th, .fields tr:first-child td, .devices thead th { border-top: 0; }
        .fields tr:first-child th { border-top-left-radius: 2mm; }
        .fields tr:first-child td { border-top-right-radius: 2mm; }
        .fields tr:last-child th { border-bottom-left-radius: 2mm; }
        .fields tr:last-child td { border-bottom-right-radius: 2mm; }
        .devices thead th:first-child { border-top-left-radius: 2mm; }
        .devices thead th:last-child { border-top-right-radius: 2mm; }
        .devices tbody tr:last-child td:first-child { border-bottom-left-radius: 2mm; }
        .devices tbody tr:last-child td:last-child { border-bottom-right-radius: 2mm; }
        .cover-content { width: 100%; margin: 0; }
        .gallery-panel { border-radius: 2mm; background: #10212F; color: #FFD43B; padding: 2mm; margin-bottom: 3mm; font-size: 10pt; line-height: 1.3; font-weight: bold; text-transform: uppercase; letter-spacing: .4mm; text-align: center; }
        .gallery-panel a { color: #FFD43B; text-decoration: none; }
        .site-panel { border: 1px solid #97C4C9; border-radius: 2mm; padding: 1mm; margin-bottom: 3mm; }
        .site-summary { font-size: 8pt; }
        .site-summary th, .site-summary td { padding: .45mm 2mm; line-height: 1.25; border: 0; }
        .site-summary tr + tr th, .site-summary tr + tr td { border-top: 1px solid #DCE5E7; }
        .site-summary th { width: 24%; background: #FFFFFF; }
        .site-summary a { color: inherit; text-decoration: none; word-wrap: break-word; }
        .cover-map { margin: 0 0 3mm; text-align: center; page-break-inside: avoid; }
        .cover-map img { width: 100%; height: auto; border-radius: 2mm; }
        .photo.cover-photo { border: 0; padding: 0; margin: 0; }
        .site-photo-continuation { margin-top: 3mm; }
        .photo.cover-photo img { width: 100%; height: auto; max-width: none; max-height: none; border-radius: 2mm; }
        .evaluation-cards { border-collapse: separate; border-spacing: 2mm 0; margin: 0 -2mm 3mm; width: 100%; page-break-inside: avoid; }
        .evaluation-cards td { width: 25%; border: 0; padding: 0; }
        .evaluation-card { border: 1px solid #97C4C9; border-radius: 2mm; background: #E5F1F2; height: 19mm; padding: 1.5mm 2mm; text-align: center; }
        .evaluation-card-title { font-size: 8pt; font-weight: bold; height: 7mm; margin: 0; line-height: 1.2; }
        .evaluation-card-value { font-size: 9pt; line-height: 1.3; margin: 2mm 0 0; word-wrap: break-word; }
        .quantities th, .quantities td { padding: 2mm 3mm; }
        .quantities .quantity-empty th, .quantities .quantity-empty td { color: #8893a4; background: #F4F6F7; }
        tr { page-break-inside: avoid; }
        .devices { font-size: 7pt; margin-bottom: 4mm; }
        .devices th, .devices td { padding: 2mm; }
        .device-comment { margin-top: 1mm; color: #596579; }
        .notes { border: 1px solid #DCE5E7; border-radius: 2mm; min-height: 26mm; padding: 3mm; margin-bottom: 4mm; white-space: pre-wrap; word-wrap: break-word; }
        .placeholder { color: #8893a4; }
        .photo { page-break-inside: avoid; margin: 4mm 0; padding: 3mm; border: 1px solid #DCE5E7; border-radius: 2mm; text-align: center; }
        .photo img { max-width: 165mm; max-height: 70mm; }
        .photo.widescreen img { width: 165mm; height: auto; max-height: none; }
        .caption { margin: 2mm 0 0; font-size: 8pt; word-wrap: break-word; }
        .square-photos { width: 100%; border-collapse: separate; border-spacing: 3mm 0; margin: 2mm -3mm; table-layout: fixed; }
        .square-photos tr { page-break-inside: avoid; }
        .square-photos td { width: 50%; padding: 0; border: 0; vertical-align: top; }
        .photo.square-photo { margin: 0 0 3mm; padding: 2mm; border-radius: 2mm; }
        .photo.square-photo img { width: 76mm; height: 76mm; max-width: none; max-height: none; }
        .location { page-break-inside: avoid; margin: 4mm 0; }
        .location img { width: 176mm; height: 99mm; }
        .check { padding: 2mm 0; }
        .training-theme-title { margin-top: 3mm; font-weight: bold; }
        .training-count { font-weight: normal; color: #555; }
        .training-na { color: #999; }
        .training-line { padding: 0.6mm 0 0.6mm 4mm; font-size: 9pt; }
    </style></head><body><header>'
        . ($logo !== null ? '<img class="report-header-logo" src="' . pdfEscape($logo) . '" alt="Logo du rapport">' : '')
        . '<div class="report-header-text' . ($logo === null ? ' no-logo' : '') . '"><div class="report-header-title">COMPTE RENDU INSTALLATION FORMATION</div>'
        . '<div class="report-header-name">' . pdfEscape($name !== '' ? $name : 'Établissement à renseigner') . '</div>'
        . '<div class="report-header-locality">' . pdfEscape($locality) . ($date !== '' ? ($locality !== '' ? ' &nbsp; ' : '') . 'le ' . pdfEscape($date) : '') . '</div>'
        . '</div></header><footer class="report-footer">'
        . '<div class="report-footer-brand">WHITEFOX IS - LIGHTSPEED</div>'
        . '<div class="report-footer-meta"><em>Rédacteur du rapport :</em> <strong>'
        . pdfEscape(trim((string) ($report['author'] ?? '')) ?: 'À renseigner')
        . '</strong> &nbsp; Id Intervention : <strong>'
        . pdfEscape(trim((string) ($report['intervention_id'] ?? '')) ?: 'À renseigner')
        . '</strong></div><div class="report-footer-status">' . pdfEscape($reportStatus)
        . '</div><div class="report-footer-confidential">Document confidentiel - NE PAS TRANSMETTRE</div></footer>';
    $pdfSections = [1 => $sections[1], 3 => 'Liste Matériel']
        + array_diff_key($sections, [1 => true, 2 => true, 3 => true, 12 => true]);
    foreach ($pdfSections as $number => $label) {
        $html .= '<section class="section' . ($number === 1 ? ' first' : '') . '">';
        if ($number === 1) {
            $evaluation = [
                'evaluation_minutes' => 'Temps d’intervention',
                'network_status' => 'État réseau',
                'hardware_installation' => 'Installation matériel',
                'skills_transfer' => 'Formation',
            ];
            $html .= '<table class="evaluation-cards"><tr>';
            $computedMinutes = interventionMinutes($report['context_start_time'] ?? null, $report['context_end_time'] ?? null);
            foreach ($evaluation as $key => $title) {
                $value = (string) ($report[$key] ?? '');
                if ($key === 'evaluation_minutes') {
                    $value = $computedMinutes !== null ? formatInterventionDuration($computedMinutes) : '';
                } elseif ($value !== '') {
                    $value = $statuses[$value] ?? $value;
                }
                $html .= '<td><div class="evaluation-card"><div class="evaluation-card-title">' . pdfEscape($title)
                    . '</div><div class="evaluation-card-value">'
                    . ($value !== '' ? pdfEscape($value) : '<span class="placeholder">À renseigner</span>')
                    . '</div></div></td>';
            }
            $html .= '</tr></table>';
            $gallery = trim((string) ($report['gallery_url'] ?? ''));
            // The URL itself is never printed: the whole banner is the link when the address is valid.
            $galleryContent = 'Galerie photo';
            if (preg_match('~^https?://~i', $gallery) && filter_var($gallery, FILTER_VALIDATE_URL)) {
                $galleryContent = '<a href="' . pdfEscape($gallery) . '">' . $galleryContent . '</a>';
            }
            $html .= '<div class="cover-content"><div class="gallery-panel">' . $galleryContent . '</div>';
            $summary = [
                'Contact' => trim((string) ($report['contact_name'] ?? '') . ' ' . (string) ($report['contact_phone'] ?? '')),
                'Email contact' => (string) ($report['contact_email'] ?? ''),
                'Adresse restaurant' => trim((string) ($report['address'] ?? '') . ' ' . $locality),
                'Commercial' => (string) ($report['sales_rep'] ?? ''),
                'N° entreprise' => (string) ($report['customer_id'] ?? ''),
                'N° établissement' => (string) ($report['establishment_id'] ?? ''),
                'Mail de commande' => (string) ($report['order_reference'] ?? ''),
            ];
            $html .= '<div class="site-panel"><table class="site-summary">';
            foreach ($summary as $title => $text) {
                $content = trim($text) !== '' ? pdfEscape($text) : '<span class="placeholder">À renseigner</span>';
                $html .= '<tr><th>' . pdfEscape($title) . '</th><td>' . $content . '</td></tr>';
            }
            $html .= '</table></div>';
            if (($report['latitude'] ?? null) !== null && ($report['longitude'] ?? null) !== null) {
                $html .= '<div class="cover-map">';
                if ($mapImage !== null) $html .= '<img src="data:image/png;base64,' . base64_encode($mapImage) . '" alt="Localisation Google Maps">';
                else $html .= '<p class="placeholder">' . pdfEscape($mapNotice ?: 'Carte non disponible ; coordonnées conservées.')
                    . ' (' . pdfEscape((string) $report['latitude']) . ', ' . pdfEscape((string) $report['longitude']) . ')</p>';
                $html .= '</div>';
            }
            foreach ($sitePhotos as $index => $photo) {
                $html .= ($index > 0 ? '<div class="site-photo-continuation">' : '')
                    . pdfPhotoHtml($photo, true) . ($index > 0 ? '</div>' : '');
            }
            $html .= '</div></section>';
            continue;
        }
        $position = array_search($number, array_keys($pdfSections), true) + 1;
        $html .= '<h2>' . sprintf('%02d', $position) . ' · ' . pdfEscape($label) . '</h2>';
        $rows = '';
        foreach ($fields[$number] as $key => $fieldLabel) {
            if (str_ends_with($key, '_notes') || str_ends_with($key, '_comment') || $key === 'conclusion') {
                continue;
            }
            if ($noTraining && $key === 'training_participants') {
                continue;
            }
            $value = $report[$key] ?? '';
            if (in_array($key, $booleanFields, true)) {
                $value = $value === '' || $value === null ? '' : ((int) $value === 1 ? 'Oui' : 'Non');
            } elseif (str_ends_with($key, '_status') || in_array($key, ['hardware_installation', 'skills_transfer'], true)) {
                $value = $statuses[$value] ?? $value;
            }
            $rows .= '<tr><th>' . pdfEscape($fieldLabel) . '</th><td>'
                . ((string) $value !== '' ? nl2br(pdfEscape((string) $value)) : '<span class="placeholder">À renseigner</span>') . '</td></tr>';
        }
        if ($rows !== '') $html .= '<table class="fields">' . $rows . '</table>';
        if ($number === 13) {
            $html .= '<h3>Suivi intervention</h3>';
            $followup = interventionFollowup($report['intervention_followup'] ?? null);
            if ($followup === []) $html .= '<p class="placeholder">Aucun suivi enregistré.</p>';
            foreach ($followup as $row) {
                $html .= '<h3>' . pdfEscape($row['date']) . '</h3><div class="notes">' . pdfEscape($row['comment']) . '</div>';
            }
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
                $count = $counts[$category];
                $html .= '<tr' . ($count === 0 ? ' class="quantity-empty"' : '') . '><th>'
                    . pdfEscape($name) . '</th><td>' . ($count > 0 ? (string) $count : '') . '</td></tr>';
            }
            $html .= '</table>';
        }
        if (isset($deviceSections[$number])) {
            $html .= '<h3>Appareils détaillés</h3>';
            $matching = array_filter($devices, static fn(array $device): bool => in_array($device['category'], $deviceSections[$number], true));
            if ($matching === []) {
                $html .= '<p class="placeholder">Aucun appareil renseigné.</p>';
            } else {
                $html .= '<table class="devices"><thead><tr><th>Catégorie / marque / modèle</th><th>Numéro de série / MAC</th><th>Emplacement / état</th></tr></thead><tbody>';
            }
            foreach ($matching as $device) {
                $comment = (string) ($device['comment'] ?? '');
                $html .= '<tr><td>'
                    . pdfEscape($deviceCategories[$device['category']] ?? $device['category']) . '<br>'
                    . pdfEscape(trim(($device['brand'] ?? '') . ' ' . ($device['model'] ?? ''))) . '</td><td>'
                    . pdfEscape((string) ($device['serial_number'] ?? '')) . '<br>'
                    . pdfEscape((string) ($device['mac_address'] ?? '')) . '</td><td>'
                    . pdfEscape((string) ($device['location'] ?? '')) . '<br>'
                    . pdfEscape(['installed' => 'Installé', 'configured' => 'Configuré', 'already_present' => 'Déjà présent'][$device['state']] ?? '')
                    . (trim($comment) !== '' ? '<div class="device-comment">' . nl2br(pdfEscape($comment)) . '</div>' : '')
                    . '</td></tr>';
            }
            if ($matching !== []) $html .= '</tbody></table>';
        }
        if ($number === 10 && !$noTraining) {
            $html .= '<h3>Checklist de formation</h3>';
            $position = 0;
            foreach (trainingChecklist() as $theme) {
                $position++;
                if ($theme['items'] === []) continue;
                $states = array_map(static fn(string $key): string => $training['items'][$key] ?? '', array_keys($theme['items']));
                $done = count(array_filter($states, static fn(string $state): bool => $state === 'done'));
                $html .= '<div class="training-theme-title">' . $position . '. ' . pdfEscape($theme['title']);
                if (!in_array('', $states, true) && !in_array('done', $states, true)) {
                    $html .= ' <span class="training-na">— Non concerné</span></div>';
                    continue;
                }
                $html .= ' <span class="training-count">(' . $done . ' / ' . count($theme['items']) . ')</span></div>';
                foreach ($theme['items'] as $key => $itemLabel) {
                    $state = $training['items'][$key] ?? '';
                    $html .= $state === 'na'
                        ? '<div class="training-line training-na">– ' . pdfEscape($itemLabel) . ' (non concerné)</div>'
                        : '<div class="training-line">' . ($state === 'done' ? '☑' : '☐') . ' ' . pdfEscape($itemLabel) . '</div>';
                }
            }
            foreach ($training['legacy'] as $topic) {
                $html .= '<div class="check">☑ ' . pdfEscape($trainingTopics[$topic]) . '</div>';
            }
        }
        foreach ($fields[$number] as $key => $fieldLabel) {
            if (!str_ends_with($key, '_notes') && !str_ends_with($key, '_comment') && $key !== 'conclusion') {
                continue;
            }
            $text = (string) ($report[$key] ?? '');
            if ($key !== 'conclusion' && trim($text) === '') {
                continue;
            }
            $html .= '<h3>' . pdfEscape($fieldLabel) . '</h3><div class="notes">'
                . ($text !== '' ? pdfEscape($text) : '<span class="placeholder">À compléter</span>') . '</div>';
        }
        if (!in_array($number, [1,13], true)) $html .= '<h3>Photos et légendes</h3>';
        $matchingPhotos = in_array($number, [1,13], true) ? [] : array_filter($photos, static fn(array $photo): bool => (int) $photo['section_number'] === $number);
        if (!in_array($number, [1,13], true) && $matchingPhotos === []) {
            $html .= '<div class="notes placeholder">Aucune photo ajoutée à cette section.</div>';
        }
        $squarePhotos = in_array($number, FOXREPORT_SQUARE_PHOTO_SECTIONS, true);
        if ($squarePhotos && $matchingPhotos !== []) {
            $html .= '<table class="square-photos">';
            foreach (array_chunk(array_values($matchingPhotos), 2) as $pair) {
                $html .= '<tr>';
                foreach ([0, 1] as $cell) {
                    $html .= '<td>' . (isset($pair[$cell]) ? pdfPhotoHtml($pair[$cell], false, true) : '') . '</td>';
                }
                $html .= '</tr>';
            }
            $html .= '</table>';
        }
        foreach ($squarePhotos ? [] : $matchingPhotos as $photo) {
            $html .= pdfPhotoHtml($photo);
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
            $mapImage = googleStaticImage(locationFields($report), $config, true);
        } catch (RuntimeException $exception) {
            error_log('FoxReport PDF map unavailable: ' . $exception->getMessage());
            $mapNotice = $exception->getMessage();
        }
    }
    $pdf->loadHtml(reportPdfHtml($report, $devices, $photos, $mapImage, $mapNotice, $logo ?? reportLogoData()), 'UTF-8');
    $pdf->render();
    $pdf->getCanvas()->page_script(static function (int $pageNumber, int $pageCount, $canvas, $fontMetrics): void {
        $font = $fontMetrics->getFont('DejaVu Sans', 'bold');
        $text = $pageNumber . ' / ' . $pageCount;
        $width = $fontMetrics->getTextWidth($text, $font, 9);
        $canvas->text($canvas->get_width() - 17 * 72 / 25.4 - $width, $canvas->get_height() - 25 * 72 / 25.4, $text, $font, 9, [0.09, 0.13, 0.2]);
    });
    return $pdf;
}
