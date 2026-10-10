<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Les tests FoxReport doivent être exécutés en ligne de commande.');
}

require_once dirname(__DIR__) . '/app/pdf.php';
require_once __DIR__ . '/completion.php';
require_once __DIR__ . '/access-location.php';
require_once __DIR__ . '/oauth.php';
require_once __DIR__ . '/report-list.php';
require_once __DIR__ . '/section-state.php';
require_once __DIR__ . '/training-catalogue.php';
require_once dirname(__DIR__) . '/app/training-catalogue.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $message);
    }
    echo 'PASS: ' . $message . PHP_EOL;
}

function rejects(callable $operation, string $message): void
{
    try {
        $operation();
    } catch (RuntimeException) {
        check(true, $message);
        return;
    }
    check(false, $message);
}

if (!extension_loaded('gd') || !extension_loaded('exif') || !extension_loaded('mbstring')) {
    fwrite(STDERR, "Tests require GD, EXIF and Mbstring.\n");
    exit(1);
}

$directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'foxreport-test-' . bin2hex(random_bytes(8));
$photoDirectory = null;
mkdir($directory, 0700);
try {
    $source = $directory . DIRECTORY_SEPARATOR . 'source.png';
    $normalized = $directory . DIRECTORY_SEPARATOR . 'normalized.jpg';
    $image = imagecreatetruecolor(2400, 1200);
    imagefill($image, 0, 0, imagecolorallocate($image, 32, 90, 190));
    imagepng($image, $source);
    unset($image);
    normalizePhoto($source, $normalized);
    $info = getimagesize($normalized);
    check($info[2] === IMAGETYPE_JPEG, 'PNG converted to JPEG');
    check($info[0] === 1600 && $info[1] === 800, '1600px bound and aspect ratio preserved');
    check(filesize($normalized) <= FOXREPORT_PHOTO_BYTES, 'Output at most 1 MiB');
    $squareNormalized = $directory . DIRECTORY_SEPARATOR . 'square.jpg';
    normalizePhoto($source, $squareNormalized, true);
    $squareInfo = getimagesize($squareNormalized);
    check($squareInfo[0] === 1200 && $squareInfo[1] === 1200, 'Square-only sections center-crop non-square uploads to 1:1');
    $logoSource = $directory . DIRECTORY_SEPARATOR . 'logo-source.png';
    $logoPath = $directory . DIRECTORY_SEPARATOR . 'logo.png';
    $logoImage = imagecreatetruecolor(1800, 600);
    imagealphablending($logoImage, false);
    imagesavealpha($logoImage, true);
    imagefill($logoImage, 0, 0, imagecolorallocatealpha($logoImage, 255,255,255,127));
    imagefilledrectangle($logoImage, 20,20,500,580,imagecolorallocate($logoImage,23,107,117));
    imagepng($logoImage,$logoSource);
    unset($logoImage);
    saveReportLogo($logoSource,$logoPath);
    $logoSize=getimagesize($logoPath);
    check($logoSize[0]===1200 && $logoSize[1]===400, 'Logo scales to 1200px without changing proportions');
    $logoImage=imagecreatefrompng($logoPath);
    check((imagecolorat($logoImage,1199,399)>>24)===127, 'Logo PNG transparency preserved');
    unset($logoImage);
    $logoData=reportLogoData($logoPath);
    check(str_starts_with($logoData,'data:image/png;base64,'), 'Logo embedded as PNG without remote requests');
    check(reportLogoData($directory . DIRECTORY_SEPARATOR . 'missing-logo.png')===null, 'Missing logo leaves text-only header');

    $noiseSource = $directory . DIRECTORY_SEPARATOR . 'noise.jpg';
    $noise = imagecreatetruecolor(1600, 1600);
    mt_srand(2026);
    for ($y = 0; $y < 1600; $y++) {
        for ($x = 0; $x < 1600; $x++) {
            imagesetpixel($noise, $x, $y, mt_rand(0, 0xffffff));
        }
    }
    imagejpeg($noise, $noiseSource, 100);
    unset($noise);
    check(filesize($noiseSource) > FOXREPORT_PHOTO_BYTES, 'Complex input exceeds output weight limit');
    $noiseOutput = $directory . DIRECTORY_SEPARATOR . 'noise-reduced.jpg';
    normalizePhoto($noiseSource, $noiseOutput);
    check(filesize($noiseOutput) <= FOXREPORT_PHOTO_BYTES, 'Complex image compressed below 1 MiB');
    check(filesize($noiseOutput) < filesize($noiseSource), 'Complex image file weight reduced');

    $transparent = $directory . DIRECTORY_SEPARATOR . 'transparent.png';
    $small = imagecreatetruecolor(80, 40);
    imagealphablending($small, false);
    imagesavealpha($small, true);
    imagefill($small, 0, 0, imagecolorallocatealpha($small, 0, 0, 0, 127));
    imagepng($small, $transparent);
    unset($small);
    normalizePhoto($transparent, $directory . DIRECTORY_SEPARATOR . 'white.jpg');
    $white = imagecreatefromjpeg($directory . DIRECTORY_SEPARATOR . 'white.jpg');
    check(imagesx($white) === 80 && imagesy($white) === 40, 'Small images never enlarged');
    check((imagecolorat($white, 20, 20) & 0xffffff) === 0xffffff, 'Transparency flattened on white');
    unset($white);
    $webp = $directory . DIRECTORY_SEPARATOR . 'source.webp';
    $webpImage = imagecreatetruecolor(120, 80);
    imagewebp($webpImage, $webp);
    unset($webpImage);
    normalizePhoto($webp, $directory . DIRECTORY_SEPARATOR . 'webp.jpg');
    check(getimagesize($directory . DIRECTORY_SEPARATOR . 'webp.jpg')[2] === IMAGETYPE_JPEG, 'WebP converted to JPEG');

    $jpeg = $directory . DIRECTORY_SEPARATOR . 'oriented.jpg';
    $image = imagecreatetruecolor(300, 150);
    imagefill($image, 0, 0, imagecolorallocate($image, 255, 0, 0));
    imagefilledrectangle($image, 150, 0, 299, 149, imagecolorallocate($image, 0, 0, 255));
    imagejpeg($image, $jpeg);
    unset($image);
    $tiff = "II\x2a\x00\x08\x00\x00\x00" . pack('v', 1)
        . pack('vvVv', 0x0112, 3, 1, 6) . "\x00\x00" . pack('V', 0);
    $exif = "Exif\x00\x00" . $tiff;
    $bytes = file_get_contents($jpeg);
    file_put_contents($jpeg, substr($bytes, 0, 2) . "\xff\xe1" . pack('n', strlen($exif) + 2) . $exif . substr($bytes, 2));
    $oriented = $directory . DIRECTORY_SEPARATOR . 'corrected.jpg';
    normalizePhoto($jpeg, $oriented);
    $rotated = imagecreatefromjpeg($oriented);
    check(imagesx($rotated) === 150 && imagesy($rotated) === 300, 'EXIF orientation 6 corrected');
    check(((imagecolorat($rotated, 75, 50) >> 16) & 255) > 200, 'Orientation preserves top-side red pixels');
    check(!str_contains(file_get_contents($oriented), "Exif\x00\x00"), 'EXIF metadata removed');
    unset($rotated);

    $invalid = $directory . DIRECTORY_SEPARATOR . 'invalid.jpg';
    file_put_contents($invalid, '<script>not an image</script>');
    rejects(static fn() => normalizePhoto($invalid, $directory . DIRECTORY_SEPARATOR . 'invalid-output.jpg'), 'Non-image input rejected');
    $oversize = $directory . DIRECTORY_SEPARATOR . 'oversize.png';
    $png = file_get_contents($source);
    file_put_contents($oversize, substr_replace($png, pack('NN', 5000, 5000), 16, 8));
    rejects(static fn() => validatePhotoSource($oversize), 'Images exceeding 12 megapixels rejected');
    rejects(static fn() => storedPhotoPath(['report_id' => 1, 'stored_name' => '../db', 'mime_type' => 'image/jpeg']), 'Photo traversal references rejected');

    $html = reportPdfHtml([], [], []);
    $pdfSections = [1 => $sections[1], 3 => 'Liste Matériel']
        + array_diff_key($sections, [1 => true, 2 => true, 3 => true, 12 => true]);
    foreach ($pdfSections as $number => $label) {
        if ($number === 1) continue;
        $position = array_search($number, array_keys($pdfSections), true) + 1;
        check(str_contains($html, sprintf('%02d', $position) . ' · ' . pdfEscape($label)), 'Blank PDF includes section ' . $number);
    }
    check(substr_count($html, 'class="evaluation-card"') === 4, 'First page has exactly four evaluation cards');
    check(strpos($html, '<table class="evaluation-cards">') < strpos($html, '<table class="site-summary">') && !str_contains($html, 'INFORMATIONS COMMERCIALES'), 'Cards precede compact site table without commercial heading');
    check(!str_contains($html, 'class="subtitle"') && str_contains($html, '.evaluation-card-title { font-size: 8pt; font-weight: bold; height: 7mm; margin: 0;'), 'Cards start without a status spacer and have top-aligned titles');
    check(substr_count($html, 'Aucune photo ajoutée') === 9, 'Evaluation and SITE have no separate photo placeholder');
    $pdf = renderReportPdf([], [], []);
    $pdfBytes = $pdf->output();
    check(str_starts_with($pdfBytes, '%PDF-'), 'Actual PDF output');
    check($pdf->getCanvas()->get_page_count() === 8, 'Blank model flows sections continuously on 8 A4 pages instead of one page per section');
    check(!str_contains($html, 'page-break-before: always') && str_contains($html, '.section + .section { padding-top: 8mm; }') && str_contains($html, 'page-break-after: avoid; }'), 'Sections follow each other with spacing and headings stay with their content');
    check(abs($pdf->getCanvas()->get_width() - 595.28) < 1, 'A4 portrait width');
    unset($pdf);

    $reportId = random_int(100000000, 999999999);
    $photoDirectory = dirname(__DIR__) . '/storage/photos/' . $reportId;
    if (file_exists($photoDirectory)) {
        throw new RuntimeException('Synthetic photo directory collision.');
    }
    mkdir($photoDirectory, 0700);
    $name = bin2hex(random_bytes(16));
    copy($normalized, $photoDirectory . '/' . $name . '.jpg');
    $report = [
        'id' => $reportId, 'status' => 'draft', 'establishment' => '<script>Synthetic & test</script>',
        'all_material_installed' => 0, 'training_delivered' => 1, 'training_topics' => '["orders_service"]',
        'conclusion' => str_repeat('Synthetic long conclusion. ', 350),
        'intervention_followup' => '[{"date":"2026-10-07","comment":"Synthetic follow-up <script>escaped</script>"}]',
    ];
    $devices = [['category' => 'wifi_ap', 'brand' => 'TEST', 'model' => 'Synthetic', 'state' => 'configured', 'location' => 'TEST location']];
    $photos = [['report_id' => $reportId, 'stored_name' => $name, 'mime_type' => 'image/jpeg', 'section_number' => 6, 'caption' => 'TEST photo caption']];
    $html = reportPdfHtml($report, $devices, $photos);
    $evaluationReport = array_replace($report, ['evaluation_minutes'=>5, 'context_start_time'=>'08:30:00', 'context_end_time'=>'10:00', 'network_status'=>'issue', 'hardware_installation'=>'partial', 'skills_transfer'=>'complete']);
    $evaluationHtml = reportPdfHtml($evaluationReport, [], [['section_number'=>2]]);
    check(str_contains($evaluationHtml, '1 h 30') && !str_contains($evaluationHtml, '5 min') && str_contains($evaluationHtml, 'À résoudre') && str_contains($evaluationHtml, 'Partiel') && str_contains($evaluationHtml, 'Effectué / complet'), 'Cards use saved evaluation values and existing labels');
    check(substr_count($evaluationHtml, 'class="evaluation-card"') === 4 && !str_contains($evaluationHtml, '· Évaluation'), 'Evaluation appears once in first-page cards without a duplicate PDF section');
    $emptyEvaluationHtml = reportPdfHtml(['context_start_time'=>'09:15', 'context_end_time'=>'09:15', 'network_status'=>'', 'hardware_installation'=>null], [], []);
    check(str_contains($emptyEvaluationHtml, '0 min'), 'Zero computed minutes remains a populated evaluation value');
    $missingTimeHtml = reportPdfHtml(['evaluation_minutes'=>45, 'context_start_time'=>'09:15'], [], []);
    check(!str_contains($missingTimeHtml, '45 min') && preg_match('~Temps d’intervention</div><div class="evaluation-card-value"><span class="placeholder">À renseigner~u', $missingTimeHtml) === 1, 'Duration needs both times and ignores a stored value');
    check(interventionMinutes('22:30', '01:15') === 165 && interventionMinutes('08:00:00', '17:45') === 585 && interventionMinutes('bad', '10:00') === null, 'Duration is computed from start/end times, across midnight');
    check(formatInterventionDuration(45) === '45 min' && formatInterventionDuration(120) === '2 h' && formatInterventionDuration(65) === '1 h 05', 'Duration format is readable');
    $escapedEvaluationHtml = reportPdfHtml(['skills_transfer'=>'<script>invalid</script>'], [], []);
    $trainingHtml = reportPdfHtml(['skills_transfer'=>'already_trained'], [], []);
    check(str_contains($trainingHtml, 'Formation</div><div class="evaluation-card-value">Client déjà formé') && !str_contains($trainingHtml, 'Transfert de compétences'), 'Training card is titled Formation and shows the already-trained option');
    check(!str_contains($escapedEvaluationHtml, '<script>') && str_contains($escapedEvaluationHtml, '&lt;script&gt;'), 'Evaluation values are escaped');
    $evaluationPdf = renderReportPdf($evaluationReport, [], []);
    $evaluationBytes = $evaluationPdf->output(['compress'=>0]);
    check(str_contains($evaluationBytes, mb_convert_encoding('1 h 30', 'UTF-16BE', 'UTF-8')), 'Computed duration actually renders in PDF cards');
    check(!str_contains($html, '<script>') && str_contains($html, '&lt;script&gt;'), 'Report HTML escaped');
    check(str_contains($html, 'TEST photo caption') && str_contains($html, 'data:image/jpeg;base64,'), 'Photo and caption included in PDF template');
    $uncaptionedHtml = reportPdfHtml($report, $devices, [array_replace($photos[0], ['caption'=>'  '])]);
    check(str_contains($uncaptionedHtml, 'data:image/jpeg;base64,') && !str_contains($uncaptionedHtml, 'class="caption"') && !str_contains($uncaptionedHtml, 'Sans légende'), 'Photos without caption print no caption box');
    check(str_contains($html, 'table.fields, table.devices { border-collapse: separate; border-spacing: 0; border: 1px solid #DCE5E7; border-radius: 2mm;')
        && str_contains($html, '.devices tbody tr:last-child td:last-child { border-bottom-right-radius: 2mm; }'), 'PDF data tables have slightly rounded corners');
    $orderedPhotos = [$photos[0] + ['sort_order'=>1], array_replace($photos[0], ['caption'=>'SECOND synthetic photo', 'sort_order'=>2])];
    $orderedHtml = reportPdfHtml($report, $devices, $orderedPhotos);
    check(strpos($orderedHtml, 'TEST photo caption') < strpos($orderedHtml, 'SECOND synthetic photo'), 'PDF retains the saved photo order within a section');
    preg_match_all('~<table class="square-photos">(.*?)</table>~s', reportPdfHtml($report, $devices, array_merge($orderedPhotos, [array_replace($photos[0], ['caption'=>'THIRD synthetic photo'])])), $squareTables);
    check(count($squareTables[1]) === 1 && substr_count($squareTables[1][0], '<tr>') === 2 && substr_count($squareTables[1][0], 'class="photo square-photo"') === 3, 'Wi-Fi photos are laid out two per row');
    preg_match('~class="photo square-photo"><img src="data:image/jpeg;base64,([^"]+)"~', $orderedHtml, $squareImage);
    $squareSize = getimagesizefromstring(base64_decode($squareImage[1] ?? ''));
    check($squareSize !== false && $squareSize[0] === $squareSize[1], 'Existing non-square Wi-Fi photos are center-cropped square in the PDF');
    check(str_contains(reportPdfHtml([], [], [array_replace($photos[0], ['section_number'=>5])]), 'TEST photo caption') && !str_contains(reportPdfHtml([], [], [array_replace($photos[0], ['section_number'=>5])]), 'class="photo square-photo"'), 'Other sections keep full-width photos');
    $emptyComments = reportPdfHtml([], [], []);
    check(!str_contains($emptyComments, 'Commentaire matériel') && !str_contains($emptyComments, 'Commentaire Wi-Fi') && substr_count($emptyComments, 'À compléter') === 1, 'Empty comments are hidden in the PDF');
    check(str_contains(reportPdfHtml(['equipment_comment'=>'Synthetic <material> note'], [], []), '<h3>Commentaire matériel</h3><div class="notes">Synthetic &lt;material&gt; note</div>'), 'Filled equipment comment is shown escaped');
    $notTrained = reportPdfHtml(['training_delivered'=>0, 'training_participants'=>3, 'training_topics'=>'["orders_service"]'], [], []);
    $alreadyTrained = reportPdfHtml(['skills_transfer'=>'already_trained'], [], []);
    check(!str_contains($notTrained, 'Checklist de formation') && !str_contains($notTrained, 'Nombre de participants') && !str_contains($alreadyTrained, 'Checklist de formation') && str_contains($html, 'Checklist de formation'), 'Training details are hidden when no training took place');
    $checklistHtml = reportPdfHtml(['training_delivered'=>1, 'training_topics'=>json_encode(['items'=>['basics_1'=>'done','basics_2'=>'na'] + array_fill_keys(array_keys(trainingChecklist()['manager']['items']), 'na'), 'legacy'=>['orders_service']])], [], []);
    check(str_contains($checklistHtml, '☑ Se connecter avec son utilisateur.') && str_contains($checklistHtml, 'Présenter les écrans principaux et la navigation. (non concerné)')
        && str_contains($checklistHtml, '1. Prendre ses repères <span class="training-count">(1 / 4)</span>') && str_contains($checklistHtml, 'Complément réservé au responsable <span class="training-na">— Non concerné</span>')
        && !str_contains($checklistHtml, 'Créer les utilisateurs') && str_contains($checklistHtml, '☑ Commandes, tables et déroulement du service'), 'PDF prints the training checklist with done, not concerned and legacy topics');
    $GLOBALS['foxTrainingChecklist'] = ['basics' => ['title' => 'Prendre ses repères', 'items' => ['basics_cabc' => 'Synthetic <custom> line']]];
    $customHtml = reportPdfHtml(['training_topics'=>'{"items":{"basics_cabc":"done","basics_1":"done"},"legacy":[]}'], [], []);
    unset($GLOBALS['foxTrainingChecklist']);
    check(str_contains($customHtml, '☑ Synthetic &lt;custom&gt; line') && !str_contains($customHtml, 'Se connecter avec son utilisateur'), 'PDF follows the shared training template for every report');
    $state = trainingChecklistState('{"items":{"basics_c1a2":"done","bad key":"done","x_1":"maybe"},"legacy":["orders_service","unknown"]}');
    check($state === ['items'=>['basics_c1a2'=>'done'], 'legacy'=>['orders_service']], 'Training state keeps valid keys from any template version');
    check(str_contains($html, 'Configuré') && str_contains($html, '<td>1</td>'), 'Device state and derived quantity included');
    check(str_contains($html, '<tr class="quantity-empty"><th>iPad Pro</th><td></td></tr>')
        && str_contains($html, '<tr><th>Borne Wi-Fi</th><td>1</td></tr>')
        && !str_contains($html, '<td>0</td>'), 'Absent equipment is muted with blank quantity while present equipment keeps its count');
    $multipleDevicesHtml = reportPdfHtml($report, array_merge($devices, $devices), []);
    check(str_contains($multipleDevicesHtml, '<tr><th>Borne Wi-Fi</th><td>2</td></tr>'), 'Equipment list preserves quantities greater than one');
    preg_match_all('~<table class="devices">(.*?)</table>~s', $multipleDevicesHtml, $deviceTables);
    check(count($deviceTables[1]) === 2, 'One shared device list per matching section, not per product');
    foreach ($deviceTables[1] as $deviceTable) {
        check(substr_count($deviceTable, '<thead>') === 1 && substr_count($deviceTable, '<tr>') === 3
            && !str_contains($deviceTable, 'colspan'), 'Shared device list has one header and exactly one row per device without empty comment rows');
    }
    $commentHtml = reportPdfHtml($report, [array_replace($devices[0], ['comment'=>"Synthetic <note>\nSecond line"])], []);
    check(str_contains($commentHtml, '<div class="device-comment">Synthetic &lt;note&gt;<br />')
        && !str_contains($commentHtml, '<note>'), 'Device comments stay escaped and multiline inside their device row');
    $longDevices = [];
    for ($i = 1; $i <= 45; $i++) {
        $longDevices[] = array_replace($devices[0], ['category'=>'cash_drawer', 'serial_number'=>'SYNTHETIC-DEVICE-' . $i]);
    }
    $longDevicesPdf = renderReportPdf([], $longDevices, []);
    $longDevicesBytes = $longDevicesPdf->output(['compress'=>0]);
    check(str_contains($longDevicesBytes, mb_convert_encoding('SYNTHETIC-DEVICE-45', 'UTF-16BE', 'UTF-8'))
        && substr_count($longDevicesBytes, mb_convert_encoding('Numéro de série / MAC', 'UTF-16BE', 'UTF-8')) >= 2,
        'Long device list paginates without truncation and repeats its common header');
    check(str_contains($html, 'BROUILLON') && str_contains($html, '☑'), 'Draft status and training checklist included');
    check(str_contains($html, 'followup-history') && str_contains($html, '07/10/2026') && str_contains($html, 'Synthetic follow-up &lt;script&gt;escaped&lt;/script&gt;'), 'Dated follow-up included in PDF with escaped comments');
    $pdf = renderReportPdf($report, $devices, $photos);
    check($pdf->getCanvas()->get_page_count() > 8, 'Long text paginates instead of truncating');
    $imageWarnings = array_filter($GLOBALS['_dompdf_warnings'] ?? [], static fn(string $warning): bool => str_contains($warning, 'Image'));
    check($imageWarnings === [], 'PDF photo rendering has no image warnings');
    check(str_contains($pdf->output(), '/Subtype /Image'), 'Rendered PDF embeds photo image');
    $wideImage = imagecreatetruecolor(1600, 900);
    imagejpeg($wideImage, $photoDirectory . '/' . $name . '.jpg');
    $mapImage = imagecreatetruecolor(1280, 492);
    ob_start();
    imagepng($mapImage);
    $syntheticMap = (string) ob_get_clean();
    unset($mapImage);
    unset($wideImage);
    $coverReport = [
        'establishment'=>'SYNTHETIC COVER', 'gallery_url'=>'https://example.com/gallery',
        'contact_name'=>'Synthetic Contact', 'contact_phone'=>'0600000000', 'contact_email'=>'test@example.com',
        'address'=>'6 Synthetic Street', 'postal_code'=>'31000', 'city'=>'Synthetic City',
        'sales_rep'=>'Synthetic Salesperson', 'customer_id'=>'123456', 'establishment_id'=>'2040839610040322', 'order_reference'=>'Synthetic order mail',
        'network_status'=>'good', 'hardware_installation'=>'complete', 'skills_transfer'=>'complete',
        'latitude'=>43.6, 'longitude'=>1.4,
    ];
    $coverPhotos = [
        array_replace($photos[0], ['section_number'=>1, 'caption'=>'FIRST SITE PHOTO']),
        array_replace($photos[0], ['section_number'=>1, 'caption'=>'SECOND SITE PHOTO']),
    ];
    $originalPhotoHash = hash_file('sha256', $photoDirectory . '/' . $name . '.jpg');
    $coverHtml = reportPdfHtml($coverReport, [], $coverPhotos, $syntheticMap);
    check(hash_file('sha256', $photoDirectory . '/' . $name . '.jpg') === $originalPhotoHash, 'Panoramic PDF crop leaves the original site photo unchanged');
    $firstSectionEnd = strpos($coverHtml, '</section>');
    $coverSection = substr($coverHtml, strpos($coverHtml, '<section'), $firstSectionEnd - strpos($coverHtml, '<section'));
    check(substr_count($coverSection, '<tr') === 8, 'First page contains four-card row and seven information rows below separate gallery');
    check(str_contains($coverSection, '6 Synthetic Street 31000 Synthetic City') && str_contains($coverSection, 'Synthetic Contact 0600000000'), 'Address and contact are combined in compact rows');
    check(str_contains($coverSection, '<div class="gallery-panel"><a href="https://example.com/gallery">Galerie photo</a></div>') && !str_contains($coverSection, '>https://example.com/gallery<') && str_contains($coverSection, 'Mail de commande'), 'Gallery banner is clickable without printing the URL and order reference uses requested label');
    check(strpos($coverSection, 'class="site-summary"') < strpos($coverSection, 'class="cover-map"') && strpos($coverSection, 'class="cover-map"') < strpos($coverSection, 'class="photo cover-photo"'), 'First page order is table then map then first site photo');
    check(str_contains($coverSection, '<th>N° entreprise</th><td>123456</td>') && str_contains($coverSection, '<th>N° établissement</th><td>2040839610040322</td>'), 'Cover lists company and establishment identification numbers');
    check(!str_contains($coverHtml, 'FIRST SITE PHOTO') && !str_contains($coverHtml, 'SECOND SITE PHOTO') && !str_contains($coverHtml, 'Sans légende'), 'SITE captions and fallback labels are omitted from PDF');
    check(substr_count($coverHtml, 'data:image/jpeg;base64,') === 2 && substr_count($coverSection, 'data:image/jpeg;base64,') === 2, 'All SITE photos appear once consecutively before the next report section');
    check(substr_count($coverSection, 'class="site-photo-continuation"') === 1
        && !str_contains($coverHtml, '· SITE'), 'Remaining SITE photo follows the first with no duplicate SITE section');
    check(strpos($coverHtml, '</section>') < strpos($coverHtml, '02 · Liste Matériel')
        && strpos($coverHtml, '02 · Liste Matériel') < strpos($coverHtml, '03 · Organisation'), 'Equipment list immediately follows restaurant images before organisation');
    $coverPdf = new Dompdf\Dompdf();
    $coverPdf->setPaper('A4', 'portrait');
    $coverPdf->loadHtml($coverHtml, 'UTF-8');
    $cardBoxes = [];
    $titleBoxes = [];
    $valueBoxes = [];
    $coverBoxes = [];
    $roundedImages = 0;
    $coverPdf->setCallbacks([['event'=>'end_frame','f'=>static function ($frame) use (&$cardBoxes, &$titleBoxes, &$valueBoxes, &$coverBoxes, &$roundedImages): void {
        $node = $frame->get_node();
        if (!$node instanceof DOMElement) return;
        $class = $node->getAttribute('class');
        if ($class === 'evaluation-card') $cardBoxes[] = $frame->get_border_box();
        if ($class === 'evaluation-card-title') $titleBoxes[] = $frame->get_border_box();
        if ($class === 'evaluation-card-value') $valueBoxes[] = $frame->get_border_box();
        $continuation = $node->parentNode instanceof DOMElement && $node->parentNode->getAttribute('class') === 'site-photo-continuation';
        if (in_array($class, ['gallery-panel','site-panel','cover-map','photo cover-photo'], true) && !$continuation) $coverBoxes[$class] = $frame->get_border_box();
        if ($node->tagName === 'img' && in_array($node->parentNode->getAttribute('class'), ['cover-map','photo cover-photo'], true)) {
            if (!($node->parentNode->parentNode instanceof DOMElement
                && $node->parentNode->parentNode->getAttribute('class') === 'site-photo-continuation')) {
                $coverBoxes[$node->parentNode->getAttribute('class') . '-image'] = $frame->get_border_box();
            }
            if ($frame->get_style()->has_border_radius()) $roundedImages++;
        }
    }]]);
    $coverPdf->render();
    $coverBytes = $coverPdf->output(['compress'=>0]);
    preg_match_all('~/Type /Page\b.*?/Contents (\d+) 0 R~s', $coverBytes, $coverPages);
    $firstContentId = $coverPages[1][0] ?? null;
    check($firstContentId !== null && preg_match('~\b' . $firstContentId . ' 0 obj\b(.*?)endobj~s', $coverBytes, $firstContent) === 1, 'Actual first PDF page content identified');
    check(substr_count($firstContent[1], ' Do') >= 2, 'Map and site photo both render on actual first PDF page');
    $secondContentId = $coverPages[1][1] ?? null;
    $equipmentTitle = mb_convert_encoding('Liste Matériel', 'UTF-16BE', 'UTF-8');
    check($secondContentId !== null && preg_match('~\b' . $secondContentId . ' 0 obj\b(.*?)endobj~s', $coverBytes, $secondContent) === 1
        && substr_count($secondContent[1], ' Do') === 1
        && str_contains($secondContent[1], $equipmentTitle)
        && strpos($secondContent[1], ' Do') < strpos($secondContent[1], $equipmentTitle), 'Remaining SITE photo is followed on the same page by the equipment list, without a forced page break');
    check(count($cardBoxes) === 4, 'Actual rendered evaluation card dimensions available');
    foreach ($cardBoxes as $box) {
        check(abs($box['w'] - $cardBoxes[0]['w']) < .5 && abs($box['h'] - $cardBoxes[0]['h']) < .5 && abs($box['y'] - $cardBoxes[0]['y']) < .5, 'Evaluation cards have identical rendered width, height and top position');
    }
    check(count($titleBoxes) === 4 && max(array_column($titleBoxes, 'y')) - min(array_column($titleBoxes, 'y')) < .5, 'Card titles align at the top even with one or two lines and mixed filled values');
    foreach ($titleBoxes as $index => $box) {
        check(isset($valueBoxes[$index]) && $valueBoxes[$index]['y'] - ($box['y'] + $box['h']) >= 5, 'Each card keeps a visible gap between its title and its value');
    }
    check(count($coverBoxes) === 6, 'Actual rounded panel and image dimensions available');
    check($roundedImages === 3, 'Map and all SITE photos render with rounded clipping in Dompdf');
    foreach ($coverBoxes as $box) {
        check(abs($box['w'] - $coverBoxes['gallery-panel']['w']) < 1 && abs($box['x'] - $coverBoxes['gallery-panel']['x']) < 1, 'Gallery, information panel, Google map and restaurant photo share exact rendered width and alignment');
    }
    $expectedCoverWidth = 176 * 72 / 25.4;
    check(abs($coverBoxes['gallery-panel']['w'] - $expectedCoverWidth) < 1, 'Cover panels and images use the full 176mm header width');
    foreach (['cover-map-image', 'photo cover-photo-image'] as $key) {
        check(abs($coverBoxes[$key]['w'] / $coverBoxes[$key]['h'] - 2.6) < .02, 'Cover image actually renders in taller panoramic 2.6:1 format: ' . $key);
    }
    $photoBox = $coverBoxes['photo cover-photo-image'];
    check($photoBox['y'] + $photoBox['h'] < (297 - 32) * 72 / 25.4, 'Panoramic restaurant photo ends above the reserved footer on first page');
    $gaps = [];
    foreach ([['gallery-panel','site-panel'],['site-panel','cover-map'],['cover-map','photo cover-photo']] as [$previous,$next]) {
        $gaps[] = $coverBoxes[$next]['y'] - ($coverBoxes[$previous]['y'] + $coverBoxes[$previous]['h']);
    }
    check(max($gaps) - min($gaps) < 1 && abs($gaps[0] - 3 * 72 / 25.4) < 1, 'Cover panels and images use a uniform actual 3mm vertical gap');
    $panoramicMapParameters = staticMapParameters(['latitude'=>43.6, 'longitude'=>1.4, 'map_zoom'=>15, 'map_style'=>'sober-v1'], 2, true);
    check($panoramicMapParameters['size'] === '640x246', 'PDF requests a taller panoramic map without cropping Google attribution');
    check(str_contains($coverHtml, '.site-summary th, .site-summary td { padding: .45mm 2mm; line-height: 1.25; border: 0; }')
        && str_contains($coverHtml, '.site-summary tr + tr th, .site-summary tr + tr td { border-top: 1px solid #DCE5E7; }'), 'Rounded information panel has only horizontal row separators and no inner rectangular border');
    $wideHtml = reportPdfHtml($report, $devices, [array_replace($photos[0], ['section_number' => 5])]);
    check(str_contains($wideHtml, '<div class="photo widescreen">'), '16:9 photo uses full-width PDF layout');
    check(str_contains($wideHtml, '.photo.widescreen img { width: 165mm; height: auto; max-height: none; }'), 'Wide photos are not narrowed by the legacy 70mm height limit');
    $widePdf = renderReportPdf($report, $devices, [array_replace($photos[0], ['section_number' => 5])]);
    check(str_contains($widePdf->output(), '/Subtype /Image'), 'Full-width 16:9 photo renders in PDF');
    $uncompressed = $widePdf->output(['compress' => 0]);
    check(preg_match('/467\.7[0-9]* 0 0 263\.[0-9]+ [^\r\n]+ cm/', $uncompressed) === 1, 'Rendered wide photo measures 165mm across with proportional 16:9 height');
    $headerReport=array_replace($report,['establishment'=>'SYNTHETIC RESTAURANT','postal_code'=>'34280','city'=>'LA GRANDE MOTTE','report_date'=>'2026-05-08','author'=>'SYNTHETIC AUTHOR','intervention_id'=>'SYNTHETIC-002']);
    $headerHtml=reportPdfHtml($headerReport,$devices,$photos,null,'',$logoData);
    check(str_contains($headerHtml,'COMPTE RENDU INSTALLATION FORMATION') && str_contains($headerHtml,'class="report-header-name">SYNTHETIC RESTAURANT'), 'Report header has requested title and bold establishment');
    check(str_contains($headerHtml,'34280 LA GRANDE MOTTE') && str_contains($headerHtml,'le 08/05/2026'), 'Header includes postal code, city and French intervention date');
    check(str_contains($headerHtml,'left: 46mm; right: 0;') && substr_count($headerHtml,'margin-bottom: .8mm;')===2, 'Header text sits beside logo with compact 0.8mm vertical spacing');
    $headerPdf=renderReportPdf($headerReport,$devices,$photos,$logoData);
    $headerBytes=$headerPdf->output(['compress'=>0]);
    $restaurantText=mb_convert_encoding('SYNTHETIC RESTAURANT','UTF-16BE','UTF-8');
    check(substr_count($headerBytes,$restaurantText)>=$headerPdf->getCanvas()->get_page_count(), 'Restaurant header actually rendered on every PDF page');
    check(str_contains($headerBytes,'/Subtype /Image'), 'Uploaded logo image is rendered in PDF');
    $footerStart = strpos($headerHtml, '<footer class="report-footer">');
    $footerEnd = strpos($headerHtml, '</footer>', $footerStart) + strlen('</footer>');
    $footerHtml = substr($headerHtml, $footerStart, $footerEnd - $footerStart);
    check(str_contains($footerHtml, 'BROUILLON') && substr_count($headerHtml, 'BROUILLON') === 1, 'Draft status appears only inside the repeated footer');
    foreach (['WHITEFOX IS - LIGHTSPEED', 'SYNTHETIC AUTHOR', 'SYNTHETIC-002', 'Document confidentiel - NE PAS TRANSMETTRE', 'BROUILLON'] as $text) {
        check(substr_count($headerBytes, mb_convert_encoding($text, 'UTF-16BE', 'UTF-8')) >= $headerPdf->getCanvas()->get_page_count(), 'Footer repeats on every actual PDF page: ' . $text);
    }
    check(str_contains($headerBytes, mb_convert_encoding('1 / ' . $headerPdf->getCanvas()->get_page_count(), 'UTF-16BE', 'UTF-8')), 'Actual PDF pagination includes total page count');
    $finalHtml = reportPdfHtml(['status'=>'finalized','author'=>'<script>author</script>','intervention_id'=>'<tag>'], [], []);
    check(str_contains($finalHtml, 'FINALISÉ') && !str_contains($finalHtml, 'BROUILLON') && !str_contains($finalHtml, '<script>'), 'Finalized footer status and escaped metadata');
    echo "All FoxReport tests passed; no database connection used.\n";
} finally {
    if ($photoDirectory !== null && is_dir($photoDirectory)) {
        foreach (glob($photoDirectory . '/*.jpg') ?: [] as $file) {
            unlink($file);
        }
        rmdir($photoDirectory);
    }
    foreach (glob($directory . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
        unlink($file);
    }
    rmdir($directory);
}
