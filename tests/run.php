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
    foreach ($sections as $number => $label) {
        $position = array_search($number, array_keys($sections), true) + 1;
        check(str_contains($html, sprintf('%02d', $position) . ' · ' . pdfEscape($label)), 'Blank PDF includes section ' . $number);
    }
    check(substr_count($html, 'Aucune photo ajoutée') === 11, 'Photos moved from Informations to SITE without duplication');
    $pdf = renderReportPdf([], [], []);
    $pdfBytes = $pdf->output();
    check(str_starts_with($pdfBytes, '%PDF-'), 'Actual PDF output');
    check($pdf->getCanvas()->get_page_count() === 12, 'Blank model has exactly 12 A4 pages');
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
    ];
    $devices = [['category' => 'wifi_ap', 'brand' => 'TEST', 'model' => 'Synthetic', 'state' => 'configured', 'location' => 'TEST location']];
    $photos = [['report_id' => $reportId, 'stored_name' => $name, 'mime_type' => 'image/jpeg', 'section_number' => 6, 'caption' => 'TEST photo caption']];
    $html = reportPdfHtml($report, $devices, $photos);
    check(!str_contains($html, '<script>') && str_contains($html, '&lt;script&gt;'), 'Report HTML escaped');
    check(str_contains($html, 'TEST photo caption') && str_contains($html, 'data:image/jpeg;base64,'), 'Photo and caption included in PDF template');
    $orderedPhotos = [$photos[0] + ['sort_order'=>1], array_replace($photos[0], ['caption'=>'SECOND synthetic photo', 'sort_order'=>2])];
    $orderedHtml = reportPdfHtml($report, $devices, $orderedPhotos);
    check(strpos($orderedHtml, 'TEST photo caption') < strpos($orderedHtml, 'SECOND synthetic photo'), 'PDF retains the saved photo order within a section');
    check(str_contains($html, 'Configuré') && str_contains($html, '<td>1</td>'), 'Device state and derived quantity included');
    check(str_contains($html, 'BROUILLON') && str_contains($html, '☑'), 'Draft status and training checklist included');
    $pdf = renderReportPdf($report, $devices, $photos);
    check($pdf->getCanvas()->get_page_count() > 11, 'Long text paginates instead of truncating');
    $imageWarnings = array_filter($GLOBALS['_dompdf_warnings'] ?? [], static fn(string $warning): bool => str_contains($warning, 'Image'));
    check($imageWarnings === [], 'PDF photo rendering has no image warnings');
    check(str_contains($pdf->output(), '/Subtype /Image'), 'Rendered PDF embeds photo image');
    $wideImage = imagecreatetruecolor(1600, 900);
    imagejpeg($wideImage, $photoDirectory . '/' . $name . '.jpg');
    unset($wideImage);
    $wideHtml = reportPdfHtml($report, $devices, $photos);
    check(str_contains($wideHtml, '<div class="photo widescreen">'), '16:9 photo uses full-width PDF layout');
    check(str_contains($wideHtml, '.photo.widescreen img { width: 165mm; height: auto; max-height: none; }'), 'Wide photos are not narrowed by the legacy 70mm height limit');
    $widePdf = renderReportPdf($report, $devices, $photos);
    check(str_contains($widePdf->output(), '/Subtype /Image'), 'Full-width 16:9 photo renders in PDF');
    $uncompressed = $widePdf->output(['compress' => 0]);
    check(preg_match('/467\.7[0-9]* 0 0 263\.[0-9]+ [^\r\n]+ cm/', $uncompressed) === 1, 'Rendered wide photo measures 165mm across with proportional 16:9 height');
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
