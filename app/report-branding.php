<?php
declare(strict_types=1);

require_once __DIR__ . '/images.php';

function reportLogoPath(): string
{
    return dirname(__DIR__) . '/storage/private/report-logo.png';
}

function reportLogoData(?string $path = null): ?string
{
    $path ??= reportLogoPath();
    if (!file_exists($path)) return null;
    $bytes = file_get_contents($path);
    if ($bytes === false) throw new RuntimeException('Impossible de lire le logo du rapport.');
    return 'data:image/png;base64,' . base64_encode($bytes);
}

function saveReportLogo(string $source, ?string $destination = null): void
{
    $destination ??= reportLogoPath();
    $info = validatePhotoSource($source);
    $image = imageOperation(static fn() => match ($info[2]) {
        IMAGETYPE_JPEG => imagecreatefromjpeg($source),
        IMAGETYPE_PNG => imagecreatefrompng($source),
        IMAGETYPE_WEBP => imagecreatefromwebp($source),
    });
    if (!$image instanceof GdImage) throw new RuntimeException('Impossible de décoder le logo.');
    $temporary = null;
    try {
        if ($info[2] === IMAGETYPE_JPEG) {
            $exif = imageOperation(static fn() => exif_read_data($source));
            $orientation = (int) ($exif['Orientation'] ?? 1);
            if (in_array($orientation, [2,4,5,7], true)) imageflip($image, in_array($orientation, [4,5], true) ? IMG_FLIP_VERTICAL : IMG_FLIP_HORIZONTAL);
            $angle = match ($orientation) { 3,4=>180, 5,6=>-90, 7,8=>90, default=>0 };
            if ($angle !== 0) $image = imageOperation(static fn() => imagerotate($image, $angle, 0));
        }
        $scale = min(1, 1200 / max(imagesx($image), imagesy($image)));
        $output = imagecreatetruecolor(max(1, (int) round(imagesx($image)*$scale)), max(1, (int) round(imagesy($image)*$scale)));
        imagealphablending($output, false);
        imagesavealpha($output, true);
        imagefill($output, 0, 0, imagecolorallocatealpha($output, 255, 255, 255, 127));
        imagecopyresampled($output, $image, 0, 0, 0, 0, imagesx($output), imagesy($output), imagesx($image), imagesy($image));
        $temporary = tempnam(dirname($destination), 'report-logo-');
        if ($temporary === false) throw new RuntimeException('Stockage du logo indisponible.');
        if (!imageOperation(static fn() => imagepng($output, $temporary))) throw new RuntimeException('Impossible d’enregistrer le logo.');
        if (!chmod($temporary, 0600) || !rename($temporary, $destination)) throw new RuntimeException('Impossible de remplacer le logo du rapport.');
        $temporary = null;
    } finally {
        unset($image, $output);
        if (is_string($temporary) && is_file($temporary) && !unlink($temporary)) error_log('FoxReport logo temporary cleanup failed.');
    }
}
