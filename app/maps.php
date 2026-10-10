<?php
declare(strict_types=1);

function locationFields(array $input): array
{
    $latitude = $input['latitude'] ?? '';
    $longitude = $input['longitude'] ?? '';
    if (($latitude === '' || $latitude === null) && ($longitude === '' || $longitude === null)) {
        return ['latitude' => null, 'longitude' => null, 'map_zoom' => null, 'map_style' => 'sober-v1'];
    }
    foreach (['latitude' => [$latitude, -90, 90], 'longitude' => [$longitude, -180, 180]] as $field => [$value, $minimum, $maximum]) {
        if ((!is_string($value) && !is_int($value) && !is_float($value)) || !is_numeric($value)
            || !is_finite((float) $value) || (float) $value < $minimum || (float) $value > $maximum) {
            throw new RuntimeException('Latitude et longitude doivent être renseignées ensemble dans leurs limites valides.');
        }
    }
    $zoom = filter_var($input['map_zoom'] ?? 15, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 20]]);
    if ($zoom === false) {
        throw new RuntimeException('Le zoom de carte doit être compris entre 1 et 20.');
    }
    $style = $input['map_style'] ?? 'sober-v1';
    if (!in_array($style, ['sober-v1', 'roadmap-v1'], true)) {
        throw new RuntimeException('Style de carte invalide.');
    }
    return ['latitude' => (float) $latitude, 'longitude' => (float) $longitude, 'map_zoom' => $zoom, 'map_style' => $style];
}

function mapsConfig(): array
{
    $path = dirname(__DIR__) . '/storage/private/maps.php';
    if (!is_file($path)) {
        throw new RuntimeException('Carte indisponible : clé Google Maps non configurée. Les coordonnées peuvent être enregistrées.');
    }
    $config = require $path;
    if (!is_array($config) || ($config['enabled'] ?? false) !== true
        || !is_string($config['api_key'] ?? null) || trim($config['api_key']) === '') {
        throw new RuntimeException('Carte désactivée ou clé Google Maps absente. Les coordonnées peuvent être enregistrées.');
    }
    if (!in_array($config['scale'] ?? null, [1, 2], true)) {
        throw new RuntimeException('Échelle Google Maps invalide.');
    }
    return $config;
}

function staticMapParameters(array $location, int $scale, bool $panoramic = false): array
{
    $point = number_format($location['latitude'], 7, '.', '') . ',' . number_format($location['longitude'], 7, '.', '');
    $parameters = [
        'center' => $point, 'zoom' => $location['map_zoom'], 'size' => $panoramic ? '640x246' : '640x360',
        'scale' => $scale, 'format' => 'png', 'maptype' => 'roadmap',
        'markers' => 'color:0x176b75|' . $point,
    ];
    if ($location['map_style'] === 'sober-v1') {
        $parameters['style'] = 'feature:poi|visibility:off';
    }
    return $parameters;
}

function googleStaticImage(array $location, array $config, bool $panoramic = false): string
{
    if (!extension_loaded('curl')) {
        throw new RuntimeException('Activez PHP cURL pour afficher une carte.');
    }
    $parameters = staticMapParameters($location, $config['scale'], $panoramic);
    $parameters['key'] = $config['api_key'];
    $handle = curl_init('https://maps.googleapis.com/maps/api/staticmap?' . http_build_query($parameters));
    if ($handle === false) { throw new RuntimeException('Connexion à Google Maps indisponible.'); }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    ]);
    $bytes = curl_exec($handle);
    $code = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $type = curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
    if (!is_string($bytes) || $code !== 200 || !str_starts_with((string) $type, 'image/png') || strlen($bytes) > 5 * 1024 * 1024) {
        error_log('FoxReport Maps Static failed; HTTP ' . $code);
        throw new RuntimeException('Google Maps ne fournit pas de carte. Vérifiez clé, restrictions, facturation et quota.');
    }
    $info = getimagesizefromstring($bytes);
    if ($info === false || $info[0] !== 640 * $config['scale'] || $info[1] !== ($panoramic ? 246 : 360) * $config['scale']) {
        throw new RuntimeException('Dimensions de carte inattendues ; affichage refusé.');
    }
    return $bytes;
}
