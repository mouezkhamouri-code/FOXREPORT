<?php
declare(strict_types=1);

function deviceCatalogue(PDO $pdo): array
{
    return [
        'types' => $pdo->query('SELECT category, label FROM foxreport_device_types ORDER BY label, category')->fetchAll(PDO::FETCH_ASSOC),
        'models' => $pdo->query('SELECT model_key, category, name FROM foxreport_device_models ORDER BY name, model_key')->fetchAll(PDO::FETCH_ASSOC),
    ];
}

function deviceCatalogueInput(mixed $input): array
{
    global $standardDeviceCategories;
    if (!is_string($input) || strlen($input) > 1000000) throw new RuntimeException('Catalogue matériel invalide ou trop volumineux.');
    try { $data = json_decode($input, true, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException $exception) { throw new RuntimeException('Catalogue matériel illisible.', 0, $exception); }
    if (!is_array($data) || !isset($data['types'], $data['models']) || !is_array($data['types']) || !array_is_list($data['types'])
        || !is_array($data['models']) || !array_is_list($data['models']) || count($data['types']) > 500 || count($data['models']) > 2000) {
        throw new RuntimeException('La liste des types ou modèles est invalide ou trop longue.');
    }
    $types = [];
    foreach ($data['types'] as $type) {
        if (!is_array($type) || !is_string($type['category'] ?? null) || !is_string($type['label'] ?? null)) {
            throw new RuntimeException('Un type de matériel est invalide.');
        }
        $label = trim($type['label']);
        $key = $type['category'];
        if ($label === '' || strlen($label) > 120 || !mb_check_encoding($label, 'UTF-8')
            || (!isset($standardDeviceCategories[$key]) && $key !== 'custom_' . substr(hash('sha256', mb_strtolower($label, 'UTF-8')), 0, 32))) {
            throw new RuntimeException('Le nom ou l’identifiant d’un type de matériel est invalide.');
        }
        if (isset($standardDeviceCategories[$key]) && $standardDeviceCategories[$key] !== $label) {
            throw new RuntimeException('Un type de matériel standard ne peut pas être renommé.');
        }
        if (isset($types[$key])) throw new RuntimeException('Type de matériel dupliqué dans le catalogue.');
        $types[$key] = ['category'=>$key, 'label'=>$label];
    }
    $models = [];
    foreach ($data['models'] as $model) {
        if (!is_array($model) || !is_string($model['category'] ?? null) || !is_string($model['name'] ?? null)
            || !is_string($model['model_key'] ?? null)) throw new RuntimeException('Un modèle de matériel est invalide.');
        $name = trim($model['name']);
        $category = $model['category'];
        $key = $model['model_key'];
        if (!isset($types[$category]) || $name === '' || strlen($name) > 160 || !mb_check_encoding($name, 'UTF-8')
            || $key !== hash('sha256', $category . "\n" . mb_strtolower($name, 'UTF-8'))) {
            throw new RuntimeException('Le modèle est invalide ou son type de matériel est absent.');
        }
        if (isset($models[$key])) throw new RuntimeException('Modèle de matériel dupliqué dans le catalogue.');
        $models[$key] = ['model_key'=>$key, 'category'=>$category, 'name'=>$name];
    }
    return ['types'=>array_values($types), 'models'=>array_values($models)];
}

function saveDeviceCatalogue(PDO $pdo, array $data): void
{
    foreach ([
        ['foxreport_device_types', 'category', 'label', $data['types']],
        ['foxreport_device_models', 'model_key', 'name', $data['models']],
    ] as [$table, $key, $label, $entries]) {
        foreach ($entries as $entry) {
            $find = $pdo->prepare("SELECT $label FROM $table WHERE $key = ?");
            $find->execute([$entry[$key]]);
            if ($find->fetchColumn() !== false) continue;
            $columns = array_keys($entry);
            $insert = $pdo->prepare("INSERT INTO $table (" . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')');
            try { $insert->execute(array_values($entry)); }
            catch (PDOException $exception) {
                if ($exception->getCode() !== '23000') throw $exception;
                $find->execute([$entry[$key]]);
                if ($find->fetchColumn() === false) throw $exception;
            }
        }
    }
}

function deviceCatalogueCategories(array $catalogue): array
{
    return array_column($catalogue['types'], 'label', 'category');
}
