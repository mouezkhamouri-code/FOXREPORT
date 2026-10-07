<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
if (!extension_loaded('gd')) { throw new RuntimeException('GD required to generate PWA icons.'); }
$directory = dirname(__DIR__) . '/assets/icons';
if (!is_dir($directory)) { mkdir($directory, 0755, true); }
foreach (['icon-192.png' => 192, 'icon-512.png' => 512, 'icon-maskable.png' => 512] as $name => $size) {
    $image = imagecreatetruecolor($size, $size);
    $blue = imagecolorallocate($image, 49, 92, 232);
    $white = imagecolorallocate($image, 255, 255, 255);
    imagefill($image, 0, 0, $blue);
    imagefilledrectangle($image, (int)($size*.32), (int)($size*.25), (int)($size*.43), (int)($size*.75), $white);
    imagefilledrectangle($image, (int)($size*.32), (int)($size*.25), (int)($size*.71), (int)($size*.36), $white);
    imagefilledrectangle($image, (int)($size*.32), (int)($size*.46), (int)($size*.63), (int)($size*.57), $white);
    imagepng($image, $directory . '/' . $name);
}
