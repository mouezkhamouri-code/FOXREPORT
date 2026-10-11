<?php
declare(strict_types=1);

function deviceCatalogue(PDO $pdo): array
{
    return [
        'types' => $pdo->query('SELECT category, label FROM foxreport_device_types ORDER BY label, category')->fetchAll(PDO::FETCH_ASSOC),
        'models' => $pdo->query('SELECT model_key, category, name FROM foxreport_device_models ORDER BY name, model_key')->fetchAll(PDO::FETCH_ASSOC),
        'brands' => array_map(static fn(array $brand): array => array_replace($brand, ['archived'=>(int) $brand['archived'], 'ever_used'=>(int) $brand['ever_used'], 'revision'=>(int) $brand['revision']]), $pdo->query('SELECT brand_key, name, archived, ever_used, revision FROM foxreport_device_brands ORDER BY name, brand_key')->fetchAll(PDO::FETCH_ASSOC)),
        'deleted_brands' => $pdo->query('SELECT brand_key FROM foxreport_device_brand_deletions')->fetchAll(PDO::FETCH_COLUMN),
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
    $result = ['types'=>array_values($types), 'models'=>array_values($models)];
    if (array_key_exists('brands', $data)) {
        if (!is_array($data['brands']) || !array_is_list($data['brands']) || count($data['brands']) > 1000) throw new RuntimeException('Liste des marques invalide ou trop longue.');
        $brands = [];
        foreach ($data['brands'] as $brand) {
            if (!is_array($brand)) throw new RuntimeException('Marque invalide.');
            $name = deviceBrandName($brand['name'] ?? null);
            $key = deviceBrandKey($name);
            if (($brand['brand_key'] ?? null) !== $key || isset($brands[$key])) throw new RuntimeException('Identifiant de marque invalide ou dupliqué.');
            $brands[$key] = ['brand_key'=>$key, 'name'=>$name];
        }
        $result['brands'] = array_values($brands);
    }
    return $result;
}

function saveDeviceCatalogue(PDO $pdo, array $data): void
{
    foreach ($data['brands'] ?? [] as $brand) ensureDeviceBrand($pdo, $brand['name']);
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

function deviceBrandName(mixed $name): string
{
    if (!is_string($name)) throw new RuntimeException('Nom de marque invalide.');
    $name = trim($name);
    if ($name === '' || strlen($name) > 120 || !mb_check_encoding($name, 'UTF-8')) throw new RuntimeException('Indiquez une marque de 120 octets maximum.');
    return $name;
}

function deviceBrandKey(string $name): string
{
    return hash('sha256', mb_strtolower(trim($name), 'UTF-8'));
}

function ensureDeviceBrand(PDO $pdo, string $name, bool $used = false): bool
{
    $name = deviceBrandName($name);
    $key = deviceBrandKey($name);
    $lock = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $find = $pdo->prepare('SELECT brand_key FROM foxreport_device_brands WHERE brand_key = ?' . $lock);
    $find->execute([$key]);
    if ($find->fetchColumn() === false) {
        $deleted = $pdo->prepare('SELECT brand_key FROM foxreport_device_brand_deletions WHERE brand_key = ?');
        $deleted->execute([$key]);
        if ($deleted->fetchColumn() !== false) {
            if ($used) throw new RuntimeException('Cette marque a été supprimée du catalogue. Choisissez une marque valide avant de sauvegarder.');
            return false; // An old offline catalogue must never recreate a deleted entry.
        }
        $insert = $pdo->prepare('INSERT INTO foxreport_device_brands (brand_key, name, archived, ever_used, revision) VALUES (?, ?, 0, 0, 1)');
        try { $insert->execute([$key, $name]); }
        catch (PDOException $exception) {
            if ($exception->getCode() !== '23000') throw $exception;
            $find->execute([$key]);
            if ($find->fetchColumn() === false) throw $exception;
        }
    }
    if ($used) {
        $mark = $pdo->prepare('UPDATE foxreport_device_brands SET ever_used = 1 WHERE brand_key = ?');
        $mark->execute([$key]);
    }
    return true;
}

function changeDeviceBrand(PDO $pdo, mixed $key, mixed $action): void
{
    if (!is_string($key) || !preg_match('/^[a-f0-9]{64}$/', $key) || !in_array($action, ['archive', 'restore', 'delete'], true)) throw new RuntimeException('Action sur la marque invalide.');
    $pdo->beginTransaction();
    try {
        $lock = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
        $find = $pdo->prepare('SELECT name, ever_used FROM foxreport_device_brands WHERE brand_key = ?' . $lock);
        $find->execute([$key]);
        $brand = $find->fetch(PDO::FETCH_ASSOC);
        if (!$brand) throw new RuntimeException('Marque introuvable.');
        if ($action === 'delete') {
            $uses = $pdo->prepare('SELECT COUNT(*) FROM foxreport_devices WHERE LOWER(TRIM(brand)) = ?');
            $uses->execute([mb_strtolower($brand['name'], 'UTF-8')]);
            if ((int) $brand['ever_used'] !== 0 || (int) $uses->fetchColumn() > 0) throw new RuntimeException('Cette marque a déjà été utilisée. Archivez-la pour ne plus la proposer.');
            $tombstone = $pdo->prepare('INSERT INTO foxreport_device_brand_deletions (brand_key) VALUES (?)');
            $tombstone->execute([$key]);
            $delete = $pdo->prepare('DELETE FROM foxreport_device_brands WHERE brand_key = ?');
            $delete->execute([$key]);
        } else {
            $update = $pdo->prepare('UPDATE foxreport_device_brands SET archived = ?, revision = revision + 1 WHERE brand_key = ?');
            $update->execute([$action === 'archive' ? 1 : 0, $key]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}
