<?php
declare(strict_types=1);

function salespeople(PDO $pdo): array
{
    return $pdo->query('SELECT id, last_name, first_name FROM foxreport_salespeople ORDER BY last_name, first_name, id')->fetchAll(PDO::FETCH_ASSOC);
}

function salespersonName(array $person): string
{
    return trim($person['last_name'] . ' ' . $person['first_name']);
}

function salespersonPhone(string $phone): string
{
    $phone = trim($phone);
    $digits = preg_replace('/[\s().-]+/', '', $phone);
    return preg_match('/^0[0-9]{9}$/', $digits) === 1
        ? implode(' ', str_split($digits, 2))
        : $phone;
}

function salespersonDial(string $phone): ?string
{
    $phone = trim($phone);
    $source = str_starts_with($phone, '+') ? str_replace('(0)', '', $phone) : $phone;
    $dial = preg_replace('/[\s().-]+/', '', $source);
    return preg_match('/^\+?[0-9]{3,15}$/', $dial) === 1 ? $dial : null;
}

function salespersonInput(array $input): array
{
    $data = [];
    foreach (['last_name'=>90, 'first_name'=>90, 'phone'=>60, 'email'=>190] as $name=>$limit) {
        $value = $input[$name] ?? '';
        if (!is_string($value) || strlen(trim($value)) > $limit) {
            throw new RuntimeException('Un champ du commercial est invalide ou trop long.');
        }
        $data[$name] = trim($value);
    }
    if ($data['last_name'] === '' || $data['first_name'] === '') {
        throw new RuntimeException('Indiquez le nom et le prénom du commercial.');
    }
    if ($data['email'] === '' || !filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Indiquez une adresse e-mail valide.');
    }
    $data['phone'] = salespersonPhone($data['phone']);
    return $data;
}

function selectedSalesperson(PDO $pdo, mixed $id): ?array
{
    if ($id === '') return null;
    if (!is_string($id) || !ctype_digit($id) || (int) $id < 1) {
        throw new RuntimeException('Le commercial sélectionné est invalide.');
    }
    $query = $pdo->prepare('SELECT id, last_name, first_name FROM foxreport_salespeople WHERE id = ?');
    $query->execute([(int) $id]);
    $person = $query->fetch(PDO::FETCH_ASSOC);
    if (!$person) throw new RuntimeException('Le commercial sélectionné n’existe plus. Choisissez une autre fiche.');
    return $person;
}
