<?php
declare(strict_types=1);

const FOXREPORT_PHOTO_EDGE = 1600;
const FOXREPORT_PHOTO_BYTES = 1024 * 1024;
const FOXREPORT_PHOTO_PIXELS = 12000000;

function imageOperation(callable $operation): mixed
{
    set_error_handler(static function (int $severity, string $message): never {
        error_log('FoxReport image processing: ' . $message);
        throw new RuntimeException('La photo est illisible ou son traitement a échoué.');
    });
    try {
        return $operation();
    } finally {
        restore_error_handler();
    }
}

function validatePhotoSource(string $source): array
{
    if (!extension_loaded('gd') || !extension_loaded('exif')) {
        throw new RuntimeException('Activez les extensions PHP GD et EXIF pour traiter les photos.');
    }
    $info = imageOperation(static fn() => getimagesize($source));
    if ($info === false || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP], true)) {
        throw new RuntimeException('Formats photo acceptés : JPEG, PNG et WebP.');
    }
    if ($info[0] < 1 || $info[1] < 1 || $info[0] * $info[1] > FOXREPORT_PHOTO_PIXELS) {
        throw new RuntimeException('La photo dépasse 12 mégapixels. Réduisez sa résolution avant de l’envoyer.');
    }
    $memoryLimit = trim((string) ini_get('memory_limit'));
    if ($memoryLimit !== '-1') {
        $multipliers = ['g' => 1024 ** 3, 'm' => 1024 ** 2, 'k' => 1024];
        $limitBytes = (int) $memoryLimit * ($multipliers[strtolower(substr($memoryLimit, -1))] ?? 1);
        // GD needs the decoded original, possible rotation, thumbnail, and encoding buffers.
        $needed = $info[0] * $info[1] * 10 + 24 * 1024 * 1024;
        if ($limitBytes > 0 && memory_get_usage(true) + $needed > $limitBytes) {
            throw new RuntimeException('La résolution de cette photo est trop élevée pour la mémoire disponible. Réduisez-la avant l’envoi.');
        }
    }
    return $info;
}

function validateLandscapePhoto(string $source, array $info): void
{
    $orientation = 1;
    if ($info[2] === IMAGETYPE_JPEG) {
        $exif = imageOperation(static fn() => exif_read_data($source));
        $orientation = (int) ($exif['Orientation'] ?? 1);
    }
    [$width, $height] = in_array($orientation, [5, 6, 7, 8], true)
        ? [$info[1], $info[0]] : [$info[0], $info[1]];
    if ($width <= $height) {
        throw new RuntimeException('Photo SITE : prenez une image en mode paysage (large). Les photos portrait ou carrées ne sont pas acceptées.');
    }
}

function normalizePhoto(string $source, string $destination, bool $square = false): void
{
    $info = validatePhotoSource($source);
    $image = imageOperation(static fn() => match ($info[2]) {
        IMAGETYPE_JPEG => imagecreatefromjpeg($source),
        IMAGETYPE_PNG => imagecreatefrompng($source),
        IMAGETYPE_WEBP => imagecreatefromwebp($source),
    });
    if (!$image instanceof GdImage) {
        throw new RuntimeException('Impossible de décoder la photo.');
    }
    try {
        if ($info[2] === IMAGETYPE_JPEG) {
            $exif = imageOperation(static fn() => exif_read_data($source));
            $orientation = (int) ($exif['Orientation'] ?? 1);
            if (in_array($orientation, [2, 4, 5, 7], true)) {
                imageflip($image, in_array($orientation, [4, 5], true) ? IMG_FLIP_VERTICAL : IMG_FLIP_HORIZONTAL);
            }
            $angle = match ($orientation) {
                3, 4 => 180,
                5, 6 => -90,
                7, 8 => 90,
                default => 0,
            };
            if ($angle !== 0) {
                $rotated = imageOperation(static fn() => imagerotate($image, $angle, 0));
                if (!$rotated instanceof GdImage) {
                    throw new RuntimeException('Impossible de corriger l’orientation de la photo.');
                }
                $image = $rotated;
            }
        }
        $sourceX = 0;
        $sourceY = 0;
        $sourceWidth = imagesx($image);
        $sourceHeight = imagesy($image);
        if ($square && $sourceWidth !== $sourceHeight) {
            // Centered crop keeps legacy or non-JavaScript uploads square in square-only sections.
            $edge = min($sourceWidth, $sourceHeight);
            $sourceX = intdiv($sourceWidth - $edge, 2);
            $sourceY = intdiv($sourceHeight - $edge, 2);
            $sourceWidth = $sourceHeight = $edge;
        }
        $scale = min(1, FOXREPORT_PHOTO_EDGE / max($sourceWidth, $sourceHeight));
        $width = max(1, (int) round($sourceWidth * $scale));
        $height = max(1, (int) round($sourceHeight * $scale));
        do {
            $thumbnail = imagecreatetruecolor($width, $height);
            if (!$thumbnail instanceof GdImage) {
                throw new RuntimeException('Impossible de créer la photo réduite.');
            }
            imagefill($thumbnail, 0, 0, imagecolorallocate($thumbnail, 255, 255, 255));
            imagecopyresampled($thumbnail, $image, 0, 0, $sourceX, $sourceY, $width, $height, $sourceWidth, $sourceHeight);
            foreach ([82, 72, 62, 52] as $quality) {
                $written = imageOperation(static fn() => imagejpeg($thumbnail, $destination, $quality));
                if (!$written) {
                    throw new RuntimeException('Impossible d’enregistrer la photo réduite.');
                }
                clearstatcache(true, $destination);
                $bytes = filesize($destination);
                if ($bytes !== false && $bytes <= FOXREPORT_PHOTO_BYTES) {
                    if (!chmod($destination, 0600)) {
                        throw new RuntimeException('Impossible de protéger le fichier photo.');
                    }
                    return;
                }
            }
            unset($thumbnail);
            $width = max(1, (int) floor($width * 0.8));
            $height = max(1, (int) floor($height * 0.8));
        } while ($width > 1 || $height > 1);
        throw new RuntimeException('La photo ne peut pas être réduite à la taille autorisée.');
    } finally {
        unset($image);
    }
}

function storedPhotoPath(array $photo): string
{
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $mime = $photo['mime_type'] ?? '';
    $name = $photo['stored_name'] ?? '';
    $reportId = filter_var($photo['report_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!is_string($mime) || !isset($extensions[$mime]) || !is_string($name) || !preg_match('/^[a-f0-9]{32}$/', $name) || !$reportId) {
        throw new RuntimeException('Référence de photo invalide.');
    }
    $root = realpath(dirname(__DIR__) . '/storage/photos');
    $path = realpath(dirname(__DIR__) . '/storage/photos/' . $reportId . '/' . $name . '.' . $extensions[$mime]);
    if ($root === false || $path === false || !str_starts_with($path, $root . DIRECTORY_SEPARATOR) || !is_file($path)) {
        throw new RuntimeException('Photo du rapport introuvable.');
    }
    return $path;
}
