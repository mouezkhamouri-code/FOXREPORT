<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/pdf.php';
$html = reportPdfHtml(['wifi_comment'=>"Routeur près de la caisse.\nClient <informé>", 'training_delivered'=>0], [], []);
preg_match('/<h2>06 · Wi-Fi<\/h2>(.*?)<\/section>/s', $html, $matches);
$section = $matches[1] ?? '';
if (!str_contains($section, 'Routeur près de la caisse.') || !str_contains($section, 'Client &lt;informé&gt;')
    || str_contains($section, 'Appareils détaillés') || str_contains($html, 'Aucun appareil renseigné')
    || str_contains($section, 'Commentaire Wi-Fi') || str_contains($html, 'Photos et légendes')
    || str_contains($html, 'À compléter')) {
    throw new RuntimeException('PDF must keep escaped free text without redundant headings and empty information blocks.');
}
$withDevices = reportPdfHtml([], [['category'=>'wifi_ap','brand'=>'Synthetic','model'=>'AP','serial_number'=>'001','state'=>'installed']], []);
if (str_contains($withDevices, 'Appareils détaillés') || !str_contains($withDevices, '<table class="devices">') || !str_contains($withDevices, 'Synthetic AP')) {
    throw new RuntimeException('Actual device details must remain visible.');
}
echo "PASS: PDF presentation keeps actual content and omits redundant or empty labels.\n";

$reportId = random_int(900000000, 999999999);
$directory = dirname(__DIR__) . '/storage/photos/' . $reportId;
$name = bin2hex(random_bytes(16));
mkdir($directory, 0700, true);
try {
    $image = imagecreatetruecolor(520, 200);
    imagefill($image, 0, 0, imagecolorallocate($image, 30, 120, 140));
    imagejpeg($image, $directory . '/' . $name . '.jpg');
    $originalHash = hash_file('sha256', $directory . '/' . $name . '.jpg');
    $photos = [];
    foreach ([1, 5, 6] as $section) {
        $photos[] = ['report_id'=>$reportId, 'stored_name'=>$name, 'mime_type'=>'image/jpeg', 'section_number'=>$section, 'caption'=>'Synthetic caption'];
    }
    $pdf = renderReportPdf(['training_delivered'=>0, 'wifi_comment'=>'Routeur près de la caisse.'], [], $photos);
    $pdf = new Dompdf\Dompdf($pdf->getOptions());
    $pdf->setPaper('A4', 'portrait');
    $pdf->loadHtml(reportPdfHtml(['training_delivered'=>0, 'wifi_comment'=>'Routeur près de la caisse.'], [], $photos), 'UTF-8');
    $rounded = 0;
    $unbordered = 0;
    $pdf->setCallbacks([['event'=>'end_frame', 'f'=>static function ($frame) use (&$rounded, &$unbordered): void {
        $node = $frame->get_node();
        if (!$node instanceof DOMElement) return;
        if ($node->tagName === 'img' && str_contains($node->parentNode->getAttribute('class'), 'photo')) {
            if ($frame->get_style()->has_border_radius()) $rounded++;
        }
        if ($node->tagName === 'div' && str_contains($node->getAttribute('class'), 'photo')) {
            $style = $frame->get_style();
            if ((float) $style->border_top_width === 0.0 && (float) $style->border_left_width === 0.0) $unbordered++;
        }
    }]]);
    $pdf->render();
    if ($rounded !== 3 || $unbordered !== 3 || hash_file('sha256', $directory . '/' . $name . '.jpg') !== $originalHash) {
        throw new RuntimeException('All photo layouts must render rounded images without a frame, leaving originals intact. Counts: ' . $rounded . '/' . $unbordered);
    }
    if (getenv('FOXREPORT_PDF_PREVIEW')) file_put_contents(getenv('FOXREPORT_PDF_PREVIEW'), $pdf->output());
    echo "PASS: Cover, wide and square photos render rounded and borderless; originals are unchanged.\n";
} finally {
    unlink($directory . '/' . $name . '.jpg');
    rmdir($directory);
}
