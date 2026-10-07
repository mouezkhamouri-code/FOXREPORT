<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/app/section-state.php';

function sectionCheck(bool $condition, string $label): void
{
    if (!$condition) { throw new RuntimeException('FAIL: ' . $label); }
    echo 'PASS: ' . $label . PHP_EOL;
}
sectionCheck(completedSections(null) === [], 'Legacy null state starts with no completed sections');
sectionCheck(completedSections('[11,6,6,1]') === [1,6,11], 'Explicit states normalized without field-fill inference');
sectionCheck(completedSections('[6]') === [6], 'Empty optional section can be explicitly completed');
foreach (['invalid', '{}', '{"1":true}', '[0]', '[12]', '["6"]', '[true]', str_repeat(' ', 101)] as $value) {
    try {
        completedSections($value);
        throw new LogicException('Invalid state accepted');
    } catch (RuntimeException) {
        sectionCheck(true, 'Invalid section-state representation rejected');
    }
}
$root = dirname(__DIR__);
foreach (['icon-192.png'=>192,'icon-512.png'=>512,'icon-maskable.png'=>512,'apple-touch-icon.png'=>180,'favicon-32.png'=>32] as $file => $size) {
    $image = imagecreatefrompng($root . '/assets/icons/' . $file);
    sectionCheck(imagesx($image) === $size && imagesy($image) === $size, 'Correct output size: ' . $file);
    $safe = true;
    $dark = false;
    for ($y=0; $y<$size; $y++) {
        for ($x=0; $x<$size; $x++) {
            $pixel = imagecolorat($image, $x, $y);
            $red = ($pixel >> 16) & 255;
            $green = ($pixel >> 8) & 255;
            $blue = $pixel & 255;
            if ($red < 80 && $green < 80 && $blue < 80) { $dark = true; }
            if ($file === 'icon-maskable.png' && hypot($x - ($size-1)/2, $y - ($size-1)/2) > $size * .4
                && ($red !== 23 || $green !== 107 || $blue !== 117)) { $safe = false; }
        }
    }
    sectionCheck(!$dark, 'No black contour pixels: ' . $file);
    if ($file === 'icon-maskable.png') {
        sectionCheck($safe, 'Entire maskable artwork lies inside 40-percent safe circle');
    }
}
