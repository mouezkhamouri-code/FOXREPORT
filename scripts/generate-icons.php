<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
if (!extension_loaded('gd')) { throw new RuntimeException('PHP GD est requis pour générer les icônes.'); }
$root = dirname(__DIR__);
function petrolLogo(GdImage $image): void
{
    if (!imagepalettetotruecolor($image)) { throw new RuntimeException('Conversion du logo impossible.'); }
    $width = imagesx($image);
    $height = imagesy($image);
    $background = imagecolorallocate($image, 23, 107, 117);
    // Remove only the white framing connected to the image edge, not the white fox.
    $queue = new SplQueue();
    foreach ([0, $height - 1] as $y) {
        for ($x=0; $x<$width; $x++) { $queue->enqueue([$x,$y]); }
    }
    foreach ([0, $width - 1] as $x) {
        for ($y=0; $y<$height; $y++) { $queue->enqueue([$x,$y]); }
    }
    while (!$queue->isEmpty()) {
        [$x,$y] = $queue->dequeue();
        if ($x<0 || $y<0 || $x>=$width || $y>=$height) { continue; }
        $color = imagecolorat($image,$x,$y);
        $red=($color>>16)&255; $green=($color>>8)&255; $blue=$color&255;
        if (min($red,$green,$blue)<180 || max($red,$green,$blue)-min($red,$green,$blue)>70) { continue; }
        imagesetpixel($image,$x,$y,$background);
        $queue->enqueue([$x-1,$y]); $queue->enqueue([$x+1,$y]);
        $queue->enqueue([$x,$y-1]); $queue->enqueue([$x,$y+1]);
    }
    for ($y=0; $y<$height; $y++) {
        for ($x=0; $x<$width; $x++) {
            $color = imagecolorat($image,$x,$y);
            if ($color === $background) { continue; }
            // Source orange has almost no blue; the blue channel preserves white/antialiased edges.
            $blue=$color&255;
            $white = $blue>225 ? 1 : max(0,($blue-60)/195);
            imagesetpixel($image,$x,$y,imagecolorallocate($image,
                (int) round(23+(255-23)*$white),
                (int) round(107+(255-107)*$white),
                (int) round(117+(255-117)*$white)));
        }
    }
}
$outputs = [
    'icon-192.png' => ['FoxReport_PWA_icon-192.png', 192, false],
    'icon-512.png' => ['FoxReport_icon-512.png', 512, false],
    'apple-touch-icon.png' => ['FoxReport_apple-touch-icon.png', 180, false],
    'favicon-32.png' => ['FoxReport_PWA_icon-192.png', 32, false],
    'icon-maskable.png' => ['FoxReport_icon-maskable-512.png', 512, true],
];
foreach ($outputs as $name => [$sourceName, $size, $maskable]) {
    $source = imagecreatefrompng($root . '/images/' . $sourceName);
    if (!$source instanceof GdImage) { throw new RuntimeException('Logo source illisible : ' . $sourceName); }
    petrolLogo($source);
    $image = imagecreatetruecolor($size, $size);
    imagefill($image, 0, 0, imagecolorallocate($image, 23, 107, 117));
    // A centered square of 56% fits inside the maskable safe circle (radius 40%).
    $limit = $maskable ? (int) floor($size * 0.56) : $size;
    $scale = min($limit / imagesx($source), $limit / imagesy($source));
    $width = (int) round(imagesx($source) * $scale);
    $height = (int) round(imagesy($source) * $scale);
    imagecopyresampled($image, $source, intdiv($size - $width, 2), intdiv($size - $height, 2), 0, 0,
        $width, $height, imagesx($source), imagesy($source));
    if (!imagepng($image, $root . '/assets/icons/' . $name)) {
        throw new RuntimeException('Écriture de l’icône impossible : ' . $name);
    }
    echo $name . ': ' . $size . 'x' . $size . PHP_EOL;
}
$png = file_get_contents($root . '/assets/icons/favicon-32.png');
if ($png === false || file_put_contents($root . '/assets/icons/favicon.ico',
    pack('vvv',0,1,1) . pack('CCCCvvVV',32,32,0,0,1,32,strlen($png),22) . $png) === false) {
    throw new RuntimeException('Génération du favicon impossible.');
}
