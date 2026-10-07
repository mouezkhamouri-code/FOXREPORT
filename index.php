<?php
declare(strict_types=1);

require_once __DIR__ . '/app/auth.php';
require_once __DIR__ . '/app/version.php';
$apiRequest = isset($_GET['api']);
$templateRequest = $apiRequest && ($_GET['api'] ?? '') === 'template' && $_SERVER['REQUEST_METHOD'] === 'GET';
$currentUser = requireFoxAuth($apiRequest);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");

require_once __DIR__ . '/SERVEUR/db.php';
if (!isset($pdo) || !$pdo instanceof PDO) {
    http_response_code(500);
    exit('La connexion FoxReport doit fournir une instance PDO dans $pdo.');
}
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
try {
    $connectedDatabase = $pdo->query('SELECT DATABASE()')->fetchColumn();
} catch (PDOException $exception) {
    error_log('FoxReport database selection check failed: ' . $exception->getMessage());
    http_response_code(500);
    exit('Impossible de vérifier la base sélectionnée pour FoxReport.');
}
if (!is_string($connectedDatabase) || stripos($connectedDatabase, 'planesto') !== false) {
    http_response_code(503);
    exit('FoxReport doit utiliser une base dédiée, distincte de PLANESTO.');
}

require_once __DIR__ . '/app/report-definition.php';
require_once __DIR__ . '/app/images.php';
require_once __DIR__ . '/app/completion.php';
require_once __DIR__ . '/app/sync.php';
require_once __DIR__ . '/app/maps.php';
require_once __DIR__ . '/app/report-list.php';
require_once __DIR__ . '/app/report-delete.php';
require_once __DIR__ . '/app/section-state.php';
require_once __DIR__ . '/app/salespeople.php';
require_once __DIR__ . '/app/photo-state.php';
require_once __DIR__ . '/app/intervention-followup.php';

if ($apiRequest && $_SERVER['REQUEST_METHOD'] === 'GET' && $_GET['api'] === 'session') {
    syncJson(['user' => $currentUser['sub'], 'email' => $currentUser['email'], 'csrf' => csrfToken()]);
}
if ($apiRequest && $_SERVER['REQUEST_METHOD'] === 'GET' && $_GET['api'] === 'reports') {
    try {
        $filter = reportListFilter($_GET['filter'] ?? 'open');
        $reports = loadReportList($pdo);
        syncJson(['html' => renderReportList($reports, csrfToken(), $filter)]);
    } catch (PDOException $exception) {
        error_log('FoxReport report list database failed; SQLSTATE ' . $exception->getCode());
        syncJson(['error' => 'Impossible de lire la liste. Vérifiez la connexion à la base FoxReport et ses tables ; consultez le journal PHP.'], 500);
    } catch (RuntimeException $exception) {
        syncJson(['error' => $exception->getMessage()], 503);
    }
}

function h(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function csrfToken(): string
{
    if (!isset($_SESSION['foxreport_csrf']) || !is_string($_SESSION['foxreport_csrf'])) {
        $_SESSION['foxreport_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['foxreport_csrf'];
}

function verifyCsrf(): bool
{
    $submitted = $_POST['csrf_token'] ?? '';
    return is_string($submitted)
        && isset($_SESSION['foxreport_csrf'])
        && hash_equals($_SESSION['foxreport_csrf'], $submitted);
}

function redirectTo(string $location): never
{
    header('Location: ' . $location, true, 303);
    exit;
}

function scalarPost(string $key, int $maxBytes, array &$errors): string
{
    $value = $_POST[$key] ?? '';
    if (!is_string($value)) {
        $errors[] = 'Un champ du formulaire est invalide.';
        return '';
    }
    $value = trim($value);
    if (strlen($value) > $maxBytes) {
        $errors[] = 'Un champ dépasse la longueur autorisée.';
    }
    return $value;
}

function enumPost(string $key, array $allowed, array &$errors): string
{
    $value = scalarPost($key, 50, $errors);
    if (!in_array($value, $allowed, true)) {
        $errors[] = 'Une valeur de sélection est invalide.';
        return '';
    }
    return $value;
}

function nullableBoolPost(string $key, array &$errors): ?int
{
    $value = enumPost($key, ['', '0', '1'], $errors);
    return $value === '' ? null : (int) $value;
}

function validDateOrNull(string $value, array &$errors): ?string
{
    if ($value === '') {
        return null;
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$date || $date->format('Y-m-d') !== $value) {
        $errors[] = 'Une date est invalide.';
        return null;
    }
    return $value;
}

function loadPostedReport(array &$errors): array
{
    $fields = [
        'establishment' => 190,
        'address' => 500,
        'contact_name' => 190,
        'contact_phone' => 60,
        'contact_email' => 190,
        'sales_rep' => 190,
        'customer_id' => 100,
        'order_reference' => 100,
        'gallery_url' => 2048,
        'author' => 190,
        'intervention_id' => 100,
        'context_notes' => 12000,
        'infrastructure_notes' => 12000,
        'wifi_comment' => 8000,
        'printer_comment' => 8000,
        'payment_comment' => 8000,
        'apple_comment' => 8000,
        'training_comment' => 8000,
        'conclusion' => 12000,
    ];
    $data = [];
    foreach (['postal_code'=>20, 'city'=>190] as $field=>$limit) {
        if (array_key_exists($field, $_POST)) $data[$field] = scalarPost($field, $limit, $errors);
    }
    if (array_key_exists('intervention_followup', $_POST)) {
        try { $data['intervention_followup'] = json_encode(interventionFollowup($_POST['intervention_followup']), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); }
        catch (RuntimeException $exception) { $errors[] = $exception->getMessage(); }
    }
    if (array_key_exists('completed_sections', $_POST)) {
        try {
            $data['completed_sections'] = json_encode(completedSections($_POST['completed_sections']), JSON_THROW_ON_ERROR);
        } catch (RuntimeException $exception) {
            $errors[] = $exception->getMessage();
        }
    }
    foreach ($fields as $field => $maxBytes) {
        $data[$field] = scalarPost($field, $maxBytes, $errors);
    }
    if (array_key_exists('sales_rep_id', $_POST)) {
        try {
            $person = selectedSalesperson($GLOBALS['pdo'], $_POST['sales_rep_id']);
            $data['sales_rep_id'] = $person ? (int) $person['id'] : null;
            if ($person) $data['sales_rep'] = salespersonName($person);
        } catch (PDOException $exception) {
            error_log('FoxReport salesperson selection failed; SQLSTATE ' . $exception->getCode());
            $errors[] = 'Annuaire des commerciaux indisponible. Vérifiez la migration 005.';
        } catch (RuntimeException $exception) { $errors[] = $exception->getMessage(); }
    }

    if ($data['contact_email'] !== '' && !filter_var($data['contact_email'], FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'L’adresse e-mail de contact est invalide.';
    }
    if ($data['gallery_url'] !== '' && !filter_var($data['gallery_url'], FILTER_VALIDATE_URL)) {
        $errors[] = 'Le lien de galerie doit être une URL valide.';
    }
    $data['report_date'] = validDateOrNull(scalarPost('report_date', 10, $errors), $errors);
    $data['order_date'] = validDateOrNull(scalarPost('order_date', 10, $errors), $errors);

    $data['evaluation_minutes'] = null;
    $minutes = scalarPost('evaluation_minutes', 6, $errors);
    if ($minutes !== '') {
        if (!ctype_digit($minutes) || (int) $minutes > 65535) {
            $errors[] = 'Le temps d’intervention doit être un nombre de minutes valide.';
        } else {
            $data['evaluation_minutes'] = (int) $minutes;
        }
    }

    $statusOptions = ['', 'good', 'limited', 'issue', 'not_applicable'];
    $data['network_status'] = enumPost('network_status', $statusOptions, $errors);
    $data['hardware_installation'] = enumPost('hardware_installation', ['', 'complete', 'partial', 'not_done'], $errors);
    $data['skills_transfer'] = enumPost('skills_transfer', ['', 'complete', 'partial', 'not_done'], $errors);
    $data['all_material_installed'] = nullableBoolPost('all_material_installed', $errors);
    $data['context_start_time'] = scalarPost('context_start_time', 5, $errors);
    $data['context_end_time'] = scalarPost('context_end_time', 5, $errors);
    foreach (['context_start_time', 'context_end_time'] as $timeField) {
        if ($data[$timeField] !== '' && !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $data[$timeField])) {
            $errors[] = 'Une heure de déroulement est invalide.';
        }
        if ($data[$timeField] === '') {
            $data[$timeField] = null;
        }
    }

    $data['nuc_installed'] = nullableBoolPost('nuc_installed', $errors);
    $data['internet_present'] = nullableBoolPost('internet_present', $errors);
    $data['router_switch_present'] = nullableBoolPost('router_switch_present', $errors);
    $data['payment_tpe_status'] = enumPost('payment_tpe_status', $statusOptions, $errors);
    $data['payment_tap_to_pay_status'] = enumPost('payment_tap_to_pay_status', $statusOptions, $errors);
    $data['apple_account_status'] = enumPost('apple_account_status', ['', 'ready', 'issue', 'not_applicable'], $errors);
    $data['lightspeed_activation_status'] = enumPost('lightspeed_activation_status', ['', 'activated', 'not_activated', 'not_applicable'], $errors);
    $data['training_delivered'] = nullableBoolPost('training_delivered', $errors);

    $participants = scalarPost('training_participants', 5, $errors);
    $data['training_participants'] = null;
    if ($participants !== '') {
        if (!ctype_digit($participants) || (int) $participants > 65535) {
            $errors[] = 'Le nombre de participants doit être un entier positif.';
        } else {
            $data['training_participants'] = (int) $participants;
        }
    }

    $postedTopics = $_POST['training_topics'] ?? [];
    if (!is_array($postedTopics)) {
        $errors[] = 'La checklist de formation est invalide.';
        $postedTopics = [];
    }
    $data['training_topics'] = [];
    foreach ($postedTopics as $topic) {
        if (!is_string($topic) || !array_key_exists($topic, $GLOBALS['trainingTopics'])) {
            $errors[] = 'Un thème de formation sélectionné est invalide.';
            continue;
        }
        $data['training_topics'][] = $topic;
    }
    $data['training_topics'] = array_values(array_unique($data['training_topics']));
    try {
        $data += locationFields($_POST);
    } catch (RuntimeException $exception) {
        $errors[] = $exception->getMessage();
        foreach (['latitude', 'longitude', 'map_zoom', 'map_style'] as $field) {
            $data[$field] = scalarPost($field, 30, $errors);
        }
    }
    return $data;
}

function loadPostedDevices(array $deviceCategories, array &$errors): array
{
    $input = $_POST['devices'] ?? [];
    if (!is_array($input)) {
        $errors[] = 'La liste du matériel est invalide.';
        return [];
    }
    if (count($input) > 200) {
        $errors[] = 'La liste du matériel dépasse la limite autorisée.';
        return [];
    }
    $devices = [];
    foreach ($input as $row) {
        if (!is_array($row)) {
            $errors[] = 'Une ligne de matériel est invalide.';
            continue;
        }
        $category = $row['category'] ?? '';
        if (!is_string($category) || $category === '') {
            continue;
        }
        if (!array_key_exists($category, $deviceCategories)) {
            $errors[] = 'Une catégorie de matériel est invalide.';
            continue;
        }
        $device = ['category' => $category];
        foreach (['brand' => 120, 'model' => 160, 'serial_number' => 160, 'mac_address' => 32, 'location' => 190, 'comment' => 500, 'decoded_password' => 500] as $field => $maxBytes) {
            $value = $row[$field] ?? '';
            if (!is_string($value)) {
                $errors[] = 'Un champ de matériel est invalide.';
                $value = '';
            }
            $device[$field] = trim($value);
            if (strlen($device[$field]) > $maxBytes) {
                $errors[] = 'Un champ de matériel dépasse la longueur autorisée.';
            }
        }
        if ($device['mac_address'] !== '' && !preg_match('/^(?:[0-9a-fA-F]{2}(?::|-)){5}[0-9a-fA-F]{2}$|^[0-9a-fA-F]{12}$/', $device['mac_address'])) {
            $errors[] = 'Une adresse MAC est invalide.';
        }
        $state = $row['state'] ?? '';
        if (!is_string($state) || !in_array($state, ['installed', 'configured', 'already_present'], true)) {
            $errors[] = 'Un état de matériel est invalide.';
            $state = 'installed';
        }
        $device['state'] = $state;
        $devices[] = $device;
    }
    $serials = [];
    $macs = [];
    foreach ($devices as $device) {
        $serial = strtoupper(trim($device['serial_number']));
        $mac = strtoupper(str_replace([':', '-'], '', $device['mac_address']));
        if (($serial !== '' && isset($serials[$serial])) || ($mac !== '' && isset($macs[$mac]))) {
            $errors[] = 'Appareil en doublon : numéro de série ou MAC déjà présent.';
        }
        if ($serial !== '') { $serials[$serial] = true; }
        if ($mac !== '') { $macs[$mac] = true; }
    }
    return $devices;
}

function loadUploads(array $sections, array &$errors): array
{
    $uploads = [];
    $total = 0;
    $mimeTypes = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $fileInfo = new finfo(FILEINFO_MIME_TYPE);
    foreach (array_keys($sections) as $section) {
        $key = 'photos_' . $section;
        if (!isset($_FILES[$key]) || !is_array($_FILES[$key]['name'] ?? null)) {
            continue;
        }
        $fileSet = $_FILES[$key];
        foreach ($fileSet['name'] as $index => $name) {
            $error = $fileSet['error'][$index] ?? UPLOAD_ERR_NO_FILE;
            if ($error === UPLOAD_ERR_NO_FILE) {
                continue;
            }
            $total++;
            if ($error !== UPLOAD_ERR_OK) {
                $errors[] = 'Une photo n’a pas pu être reçue correctement.';
                continue;
            }
            $tmpName = $fileSet['tmp_name'][$index] ?? '';
            $size = $fileSet['size'][$index] ?? 0;
            if (!is_string($tmpName) || !is_uploaded_file($tmpName) || !is_int($size) || $size < 1 || $size > 8 * 1024 * 1024) {
                $errors[] = 'Chaque photo doit peser au maximum 8 Mo.';
                continue;
            }
            $mime = $fileInfo->file($tmpName);
            if (!is_string($mime) || !isset($mimeTypes[$mime])) {
                $errors[] = 'Formats photo acceptés : JPEG, PNG et WebP.';
                continue;
            }
            try {
                $imageInfo = validatePhotoSource($tmpName);
                if ($section === 1) validateLandscapePhoto($tmpName, $imageInfo);
            } catch (RuntimeException $exception) {
                $errors[] = $exception->getMessage();
                continue;
            }
            $captionKey = 'captions_' . $section;
            $captions = $_POST[$captionKey] ?? [];
            if (!is_array($captions)) {
                $errors[] = 'Les légendes de photos sont invalides.';
                continue;
            }
            $caption = $captions[$index] ?? '';
            if (!is_string($caption)) {
                $errors[] = 'Une légende de photo est invalide.';
                continue;
            }
            $caption = trim($caption);
            if (strlen($caption) > 500) {
                $errors[] = 'Une légende de photo dépasse la longueur autorisée.';
                continue;
            }
            $formats = $_POST['formats_' . $section] ?? [];
            $format = is_array($formats) ? ($formats[$index] ?? 'original') : null;
            if (!is_string($format) || !in_array($format, ['original', 'square', 'landscape', 'portrait'], true)) {
                $errors[] = 'Format photo invalide.';
                continue;
            }
            if ($section === 1 && !in_array($format, ['original', 'landscape'], true)) {
                $errors[] = 'Les photos SITE doivent être au format paysage.';
                continue;
            }
            if ($format !== 'original') {
                $ratios = ['square' => [1], 'landscape' => [16 / 9, 4 / 3], 'portrait' => [3 / 4]][$format];
                $ratioMatches = false;
                foreach ($ratios as $ratio) {
                    if (abs($imageInfo[0] - $imageInfo[1] * $ratio) <= 2) $ratioMatches = true;
                }
                $limitWidth = $format === 'landscape' ? 1600 : 1200;
                $limitHeight = $format === 'portrait' ? 1600 : 1200;
                if ($mime !== 'image/jpeg' || $size > FOXREPORT_PHOTO_BYTES
                    || $imageInfo[0] > $limitWidth || $imageInfo[1] > $limitHeight
                    || !$ratioMatches) {
                    $errors[] = 'La photo ne respecte pas le format, les dimensions ou le plafond de 1 Mo.';
                    continue;
                }
            }
            $uploads[] = [
                'client_uid' => null,
                'section' => $section,
                'tmp_name' => $tmpName,
                'mime' => $mime,
                'extension' => $mimeTypes[$mime],
                'caption' => $caption,
                'format' => $format,
            ];
            $uids = $_POST['photo_uids_' . $section] ?? [];
            $uid = is_array($uids) ? ($uids[$index] ?? '') : null;
            if (!is_string($uid) || ($uid !== '' && !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/', $uid))) {
                $errors[] = 'Identifiant local de photo invalide.';
            } elseif ($uid !== '') {
                $uploads[array_key_last($uploads)]['client_uid'] = $uid;
            }
        }
    }
    if ($total > 12) {
        $errors[] = 'Vous pouvez ajouter au maximum 12 photos par enregistrement.';
    }
    return $uploads;
}

function saveReport(PDO $pdo, int $reportId, array $data, array $devices, array $uploads, string $status, array $photoState): void
{
    $data['training_topics'] = json_encode($data['training_topics'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $updateFields = array_keys($data);
    $assignments = array_map(static fn(string $field): string => '`' . $field . '` = :' . $field, $updateFields);
    $statement = $pdo->prepare('UPDATE foxreport_reports SET revision = revision + 1, status = :status, ' . implode(', ', $assignments) . ' WHERE id = :id');
    $statement->execute(['status' => $status, 'id' => $reportId] + $data);
    if ($statement->rowCount() === 0) {
        $exists = $pdo->prepare('SELECT id FROM foxreport_reports WHERE id = ?');
        $exists->execute([$reportId]);
        if (!$exists->fetch()) {
            throw new RuntimeException('Rapport introuvable.');
        }
    }

    $deleteDevices = $pdo->prepare('DELETE FROM foxreport_devices WHERE report_id = ?');
    $deleteDevices->execute([$reportId]);
    $insertDevice = $pdo->prepare(
        'INSERT INTO foxreport_devices (report_id, category, brand, model, serial_number, mac_address, location, state, comment, decoded_password)
         VALUES (:report_id, :category, :brand, :model, :serial_number, :mac_address, :location, :state, :comment, :decoded_password)'
    );
    foreach ($devices as $device) {
        $insertDevice->execute(['report_id' => $reportId] + $device);
    }

    $storageDirectory = __DIR__ . '/storage/photos/' . $reportId;
    if ($uploads !== [] && !is_dir($storageDirectory) && !mkdir($storageDirectory, 0700, true) && !is_dir($storageDirectory)) {
        throw new RuntimeException('Le dossier de stockage des photos ne peut pas être créé.');
    }
    $insertPhoto = $pdo->prepare(
        'INSERT INTO foxreport_photos (report_id, section_number, stored_name, mime_type, caption, crop_format, client_uid, sort_order)
         VALUES (:report_id, :section_number, :stored_name, :mime_type, :caption, :crop_format, :client_uid, :sort_order)'
    );
    foreach ($uploads as $upload) {
        $storedName = bin2hex(random_bytes(16));
        $destination = $storageDirectory . '/' . $storedName . '.jpg';
        $GLOBALS['foxreport_moved_uploads'][] = $destination;
        normalizePhoto($upload['tmp_name'], $destination);
        $insertPhoto->execute([
            'report_id' => $reportId,
            'section_number' => $upload['section'],
            'stored_name' => $storedName,
            'mime_type' => 'image/jpeg',
            'caption' => $upload['caption'],
            'crop_format' => $upload['format'],
            'client_uid' => $upload['client_uid'],
            'sort_order' => 2147483647,
        ]);
    }
    savePhotoState($pdo, $reportId, $photoState);
}

$errors = [];
$reportId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$activeSection = filter_input(INPUT_GET, 'section', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 13]]);
$activeSection = $activeSection ?: 1;
$report = null;
$devices = [];
$photosBySection = [];
$formData = [];
$postedDevices = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!verifyCsrf()) {
        http_response_code(403);
        $errors[] = 'Votre session de formulaire a expiré. Rechargez la page avant de réessayer.';
    } else {
        $action = $_POST['action'] ?? '';
        if (!is_string($action)) {
            $action = '';
        }
        if ($action === 'create') {
            try {
                $clientUid = $_POST['client_uid'] ?? null;
                if ($clientUid !== null && (!is_string($clientUid) || !preg_match('/^[a-f0-9]{32}$/', $clientUid))) {
                    throw new RuntimeException('Identifiant de brouillon local invalide.');
                }
                $create = $pdo->prepare(
                    "INSERT INTO foxreport_reports (
                        intervention_uid, context_notes, infrastructure_notes, wifi_comment, printer_comment,
                        payment_comment, apple_comment, training_comment, training_topics, conclusion
                    ) VALUES (?, '', '', '', '', '', '', '', '[]', '')
                    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
                );
                $create->execute([$clientUid ?? bin2hex(random_bytes(16))]);
                if ($apiRequest) {
                    $created = $pdo->prepare('SELECT id, revision, status FROM foxreport_reports WHERE intervention_uid = ?');
                    $created->execute([$clientUid ?? '']);
                    $row = $clientUid !== null ? $created->fetch() : ['id' => (int) $pdo->lastInsertId(), 'revision' => 1, 'status' => 'draft'];
                    syncJson($row, 201);
                }
                redirectTo('index.php?id=' . (int) $pdo->lastInsertId());
            } catch (PDOException $exception) {
                error_log('FoxReport create failed: ' . $exception->getMessage());
                http_response_code(500);
                $errors[] = 'Le rapport n’a pas pu être créé. Vérifiez que le schéma FoxReport a été installé.';
            } catch (RuntimeException $exception) {
                http_response_code(400);
                $errors[] = $exception->getMessage();
            }
        } elseif ($action === 'delete') {
            $id = filter_input(INPUT_POST, 'report_id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $revision = filter_input(INPUT_POST, 'revision', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if (!$id || !$revision || ($_POST['confirm_delete'] ?? '') !== '1') {
                http_response_code(400);
                $errors[] = 'Confirmez la suppression d’un rapport et de sa version valides.';
            } else {
                try {
                    $warning = deleteReport($pdo, $id, $revision);
                    if ($apiRequest) { syncJson(['deleted' => $id, 'warning' => $warning]); }
                    if ($warning !== null) {
                        $errors[] = $warning;
                    } else {
                        redirectTo('index.php');
                    }
                } catch (ReportConflict $exception) {
                    http_response_code(409);
                    $errors[] = $exception->getMessage();
                } catch (PDOException $exception) {
                    error_log('FoxReport delete failed; SQLSTATE ' . $exception->getCode());
                    http_response_code(500);
                    $errors[] = 'Suppression impossible. Vérifiez le schéma FoxReport et consultez le journal PHP.';
                }
            }
        } elseif ($action === 'reopen') {
            $id = filter_input(INPUT_POST, 'report_id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($id) {
                try {
                    $revision = filter_input(INPUT_POST, 'revision', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                    if (!$revision) {
                        throw new ReportConflict('Version du rapport manquante. Rechargez la page.');
                    }
                    $pdo->beginTransaction();
                    lockReportVersion($pdo, $id, $revision, true);
                    $reopen = $pdo->prepare("UPDATE foxreport_reports SET status = 'draft', revision = revision + 1 WHERE id = ?");
                    $reopen->execute([$id]);
                    $pdo->commit();
                    redirectTo('index.php?id=' . $id);
                } catch (PDOException | RuntimeException $exception) {
                    if ($pdo->inTransaction()) { $pdo->rollBack(); }
                    error_log('FoxReport reopen failed: ' . $exception->getMessage());
                    http_response_code(500);
                    $errors[] = 'Le rapport n’a pas pu être rouvert. Vérifiez le schéma FoxReport.';
                }
            } else {
                $errors[] = 'Le rapport à rouvrir est invalide.';
            }
        } elseif ($action === 'save') {
            $id = filter_input(INPUT_POST, 'report_id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $sectionInput = filter_input(INPUT_POST, 'active_section', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 13]]);
            $activeSection = $sectionInput ?: 1;
            if (!$id) {
                $errors[] = 'Le rapport à enregistrer est invalide.';
            } else {
                $reportId = $id;
                $formData = loadPostedReport($errors);
                $postedDevices = loadPostedDevices($deviceCategories, $errors);
                $uploads = loadUploads($sections, $errors);
                $photoState = ['photo_order'=>[], 'photo_deleted'=>[]];
                try { $photoState = photoStateInput($_POST); }
                catch (RuntimeException $exception) { $errors[] = $exception->getMessage(); }
                $targetStatus = ($_POST['save_status'] ?? '') === 'finalized' ? 'finalized' : 'draft';
                if ($targetStatus === 'finalized') {
                    if ($formData['establishment'] === '' || $formData['report_date'] === null) {
                        $errors[] = 'Indiquez au minimum l’établissement et la date avant de finaliser.';
                    }
                }
                if ($errors === []) {
                    $GLOBALS['foxreport_moved_uploads'] = [];
                    try {
                        $pdo->beginTransaction();
                        $revision = filter_input(INPUT_POST, 'revision', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                        if (!$revision) {
                            error_log('FoxReport save conflict; reason missing_revision; report ' . $id);
                            throw new ReportConflict('Version du rapport manquante. Rechargez la page.');
                        }
                        $requestId = $_POST['request_id'] ?? null;
                        if ($apiRequest && (!is_string($requestId) || !preg_match('/^[a-f0-9-]{36}$/', $requestId))) {
                            throw new RuntimeException('Identifiant de synchronisation invalide.');
                        }
                        if ($apiRequest) {
                            $serialize = $pdo->prepare('SELECT id FROM foxreport_reports WHERE id = ? FOR UPDATE');
                            $serialize->execute([$id]);
                            $existing = $pdo->prepare('SELECT report_id, user_sub, result_json FROM foxreport_sync_operations WHERE request_id = ?');
                            $existing->execute([$requestId]);
                            $previous = $existing->fetch();
                            if ($previous) {
                                if ((int) $previous['report_id'] !== $id || $previous['user_sub'] !== $currentUser['sub']) {
                                    throw new RuntimeException('Identifiant de synchronisation déjà utilisé.');
                                }
                                $pdo->rollBack();
                                syncJson(json_decode($previous['result_json'], true, 512, JSON_THROW_ON_ERROR));
                            }
                        }
                        lockReportVersion($pdo, $id, $revision);
                        saveReport($pdo, $id, $formData, $postedDevices, $uploads, $targetStatus, $photoState);
                        $result = ['id' => $id, 'revision' => $revision + 1, 'status' => $targetStatus];
                        if ($apiRequest) {
                            $savedPhotos = $pdo->prepare('SELECT id, client_uid, section_number, caption, crop_format FROM foxreport_photos WHERE report_id = ? AND deleted_at IS NULL ORDER BY section_number, sort_order, id');
                            $savedPhotos->execute([$id]);
                            $result['photos'] = $savedPhotos->fetchAll();
                            $operation = $pdo->prepare('INSERT INTO foxreport_sync_operations(request_id, report_id, user_sub, result_json) VALUES (?, ?, ?, ?)');
                            $operation->execute([$requestId, $id, $currentUser['sub'], json_encode($result, JSON_THROW_ON_ERROR)]);
                        }
                        $pdo->commit();
                        if ($apiRequest) { syncJson($result); }
                        redirectTo('index.php?id=' . $id . '&section=' . $activeSection);
                    } catch (ReportConflict $exception) {
                        if ($pdo->inTransaction()) { $pdo->rollBack(); }
                        if ($apiRequest) { syncJson(['error' => $exception->getMessage(), 'conflict' => true], 409); }
                        http_response_code(409);
                        $errors[] = $exception->getMessage();
                    } catch (PDOException $exception) {
                        if ($pdo->inTransaction()) {
                            $pdo->rollBack();
                        }
                        foreach ($GLOBALS['foxreport_moved_uploads'] as $movedFile) {
                            if (is_file($movedFile)) {
                                unlink($movedFile);
                            }
                        }
                        error_log('FoxReport save failed: ' . $exception->getMessage());
                        $errors[] = 'La sauvegarde a échoué. Vérifiez le schéma FoxReport et réessayez.';
                    } catch (RuntimeException $exception) {
                        if ($pdo->inTransaction()) {
                            $pdo->rollBack();
                        }
                        foreach ($GLOBALS['foxreport_moved_uploads'] as $movedFile) {
                            if (is_file($movedFile)) {
                                unlink($movedFile);
                            }
                        }
                        $errors[] = $exception->getMessage();
                    }
                }
            }
        } else {
            $errors[] = 'Action de formulaire inconnue.';
        }
    }
}

if ($apiRequest && !$templateRequest) {
    syncJson(['error' => implode(' ', array_unique($errors)) ?: 'Action API inconnue.'], $errors === [] ? 400 : (http_response_code() >= 400 ? http_response_code() : 422));
}

if (isset($_GET['id']) && $reportId === false) {
    http_response_code(400);
    $errors[] = 'Identifiant de rapport invalide.';
    $reportId = null;
}

if ($reportId) {
    try {
        $loadReport = $pdo->prepare('SELECT * FROM foxreport_reports WHERE id = ?');
        $loadReport->execute([$reportId]);
        $report = $loadReport->fetch() ?: null;
    } catch (PDOException $exception) {
        error_log('FoxReport report read failed: ' . $exception->getMessage());
        http_response_code(500);
        $errors[] = 'Impossible de lire le rapport. Importez le schéma FoxReport si ce n’est pas déjà fait.';
        $reportId = null;
    }
    if (!$report) {
        if ($errors === []) {
            http_response_code(404);
            $errors[] = 'Ce rapport est introuvable.';
        }
        $reportId = null;
    } else {
        if ($formData === []) {
            $formData = $report;
            $topics = json_decode((string) $report['training_topics'], true);
            $formData['training_topics'] = is_array($topics) ? $topics : [];
        }
        if ($postedDevices === []) {
            try {
                $loadDevices = $pdo->prepare('SELECT * FROM foxreport_devices WHERE report_id = ? ORDER BY id');
                $loadDevices->execute([$reportId]);
                $devices = $loadDevices->fetchAll();
                $postedDevices = $devices;
            } catch (PDOException $exception) {
                error_log('FoxReport device read failed: ' . $exception->getMessage());
                http_response_code(500);
                $errors[] = 'Impossible de lire le matériel du rapport.';
            }
        }
        try {
            $loadPhotos = $pdo->prepare('SELECT id, client_uid, section_number, caption, crop_format FROM foxreport_photos WHERE report_id = ? AND deleted_at IS NULL ORDER BY section_number, sort_order, id');
            $loadPhotos->execute([$reportId]);
            foreach ($loadPhotos->fetchAll() as $photo) {
                $photosBySection[(int) $photo['section_number']][] = $photo;
            }
        } catch (PDOException $exception) {
            error_log('FoxReport photo read failed: ' . $exception->getMessage());
            http_response_code(500);
            $errors[] = 'Impossible de lire les photos du rapport. Vérifiez la migration database/migrations/006-photo-management.sql.';
        }
    }
}

function value(array $data, string $key): string
{
    $value = $data[$key] ?? '';
    if ($value === null || is_array($value)) {
        return '';
    }

    if ($value instanceof DateTimeInterface) {
        return $value->format('Y-m-d');
    }
    return (string) $value;
}

function sectionStart(int $number, array $data, int $activeSection): void
{
    $done = in_array($number, $GLOBALS['completedSectionState'], true);
    echo '<details class="report-accordion' . ($done ? ' is-complete' : '') . '" data-section-accordion="' . $number . '"' . ($number === $activeSection && !$done ? ' open' : '') . '>';
    $position = array_search($number, array_keys($GLOBALS['sections']), true) + 1;
    echo '<summary id="section-heading-' . $number . '"><span class="accordion-number">' . sprintf('%02d', $position) . '</span><span>' . h($GLOBALS['sections'][$number]) . '</span><span class="section-state">' . ($done ? '✓ Terminée' : 'À compléter') . '</span></summary>';
    echo '<section class="form-section" id="section-' . $number . '" data-section-panel="' . $number . '" aria-labelledby="section-heading-' . $number . '">';
}

function sectionEnd(int $number, bool $editable): void
{
    if ($editable) {
        echo '<button type="button" class="button button-secondary section-complete" data-complete-section="' . $number . '">Section terminée</button>';
    }
    echo '</section></details>';
}

function selected(array $data, string $key, string $choice): string
{
    return value($data, $key) === $choice ? ' selected' : '';
}

function inputField(array $data, string $name, string $label, string $type = 'text', string $autocomplete = ''): void
{
    $autocompleteAttribute = $autocomplete !== '' ? ' autocomplete="' . h($autocomplete) . '"' : '';
    $nativeType = in_array($type, ['date', 'time'], true) ? ' field-native' : '';
    echo '<label class="field field-floating' . $nativeType . '"><input placeholder=" " type="' . h($type) . '" name="' . h($name) . '" value="' . h(value($data, $name)) . '"' . $autocompleteAttribute . '><span class="field-title">' . h($label) . '</span></label>';
}

function textareaField(array $data, string $name, string $label, string $hint = ''): void
{
    echo '<label class="field field-floating"><textarea placeholder=" " name="' . h($name) . '" rows="4">' . h(value($data, $name)) . '</textarea><span class="field-title">' . h($label) . '</span>';
    if ($hint !== '') {
        echo '<small>' . h($hint) . '</small>';
    }
    echo '</label>';
}

function selectField(array $data, string $name, string $label, array $options): void
{
    echo '<label class="field field-floating field-native"><select name="' . h($name) . '">';
    foreach ($options as $optionValue => $optionLabel) {
        echo '<option value="' . h((string) $optionValue) . '"' . selected($data, $name, (string) $optionValue) . '>' . h($optionLabel) . '</option>';
    }
    echo '</select><span class="field-title">' . h($label) . '</span></label>';
}

function booleanSelect(array $data, string $name, string $label): void
{
    selectField($data, $name, $label, ['' => 'À préciser', '1' => 'Oui', '0' => 'Non']);
}

function statusSelect(array $data, string $name, string $label): void
{
    selectField($data, $name, $label, [
        '' => 'À préciser',
        'good' => 'Bon',
        'limited' => 'Limité',
        'issue' => 'À résoudre',
        'not_applicable' => 'Non applicable',
    ]);
}

function photoBlock(int $section, array $photosBySection, bool $editable): void
{
    echo '<div class="photo-block" data-photo-section="' . $section . '"' . ($section === 1 ? ' data-landscape-only="true"' : '') . '><div>';
    echo $section === 1
        ? '<h3>Photo du restaurant extérieur / intérieur / terrasse</h3><p>Image à prendre en mode large. Recadrage paysage 16:9 ajustable ; vous pouvez ajouter plusieurs photos.</p>'
        : '<h3>Photos de cette section</h3><p>JPEG, PNG ou WebP · 8 Mo maximum · Réduction automatique en JPEG à l’enregistrement (1 600 px, 1 Mo maximum).</p>';
    echo '</div>';
    if ($editable) {
        echo '<label class="upload-control">Galerie<input type="file" name="photos_' . $section . '[]" accept="image/jpeg,image/png,image/webp" multiple data-photo-input="' . $section . '"></label> <label class="upload-control">Prendre une photo<input type="file" accept="image/*" capture="environment" data-photo-input="' . $section . '"></label><div class="photo-caption-fields" data-caption-fields="' . $section . '"></div>';
    }
    $photos = $photosBySection[$section] ?? [];
    if ($photos !== []) {
        echo '<div class="photo-grid">';
        foreach ($photos as $photo) {
            echo '<figure><img src="photo.php?id=' . (int) $photo['id'] . '" data-photo-key="' . h(photoKey($photo)) . '" data-photo-format="' . h($photo['crop_format']) . '" alt="' . h($photo['caption'] ?: 'Photo du rapport') . '"><figcaption>' . h($photo['caption'] ?: 'Sans légende') . '</figcaption></figure>';
        }
        echo '</div>';
    }
    echo '</div>';
}

if ($templateRequest) {
    $schema = $pdo->query('SHOW COLUMNS FROM foxreport_reports')->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('completed_sections', $schema, true)) {
        syncJson(['error' => 'Appliquez database/migrations/004-section-state.sql pour préparer les brouillons hors ligne.'], 503);
    }
    $report = ['id' => 0, 'revision' => 1, 'status' => 'draft', 'updated_at' => '', 'completed_sections' => '[]'];
    $formData = $report + ['training_topics' => [], 'map_style' => 'sober-v1'];
    ob_start();
}
$selectedId = isset($_GET['id']) && $reportId ? (int) $reportId : 0;
$isEditable = !$report || $report['status'] === 'draft';
$isEditor = ($selectedId > 0 || $templateRequest) && $report !== null;
if ($report !== null && !array_key_exists('completed_sections', $report)) {
    http_response_code(503);
    $errors[] = 'Schéma FoxReport incomplet : appliquez explicitement database/migrations/004-section-state.sql après sauvegarde pour enregistrer les sections terminées.';
    $isEditable = false;
}
$completedSectionState = [];
$salespeople = [];
if ($isEditor) {
    try {
        $pdo->query('SELECT client_uid, sort_order, deleted_at FROM foxreport_photos LIMIT 0');
    } catch (PDOException $exception) {
        error_log('FoxReport photo management schema unavailable; SQLSTATE ' . $exception->getCode());
        $errors[] = 'Appliquez la migration database/migrations/006-photo-management.sql après sauvegarde pour organiser les photos.';
        $isEditable = false;
    }
    try {
        $salespeople = salespeople($pdo);
        $columns = $pdo->query('SHOW COLUMNS FROM foxreport_reports')->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('sales_rep_id', $columns, true)) throw new RuntimeException('Appliquez la migration database/migrations/005-salespeople.sql après sauvegarde.');
        if (!in_array('intervention_followup', $columns, true)) throw new RuntimeException('Appliquez la migration database/migrations/007-intervention-followup.sql après sauvegarde.');
        if (!in_array('postal_code', $columns, true) || !in_array('city', $columns, true)) throw new RuntimeException('Appliquez la migration database/migrations/008-report-locality.sql après sauvegarde.');
    } catch (PDOException $exception) {
        error_log('FoxReport salespeople schema unavailable; SQLSTATE ' . $exception->getCode());
        $errors[] = 'Appliquez la migration database/migrations/005-salespeople.sql après sauvegarde pour sélectionner un commercial.';
        $isEditable = false;
    } catch (RuntimeException $exception) { $errors[] = $exception->getMessage();$isEditable = false; }
    if ($templateRequest && !$isEditable) syncJson(['error'=>implode(' ', $errors)], 503);
}
try {
    $completedSectionState = completedSections($formData['completed_sections'] ?? null);
} catch (RuntimeException $exception) {
    error_log('FoxReport invalid section state; report ' . $selectedId);
    $errors[] = $exception->getMessage();
    $isEditable = false;
}

?>
<!doctype html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#176B75">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="FoxReport">
    <title><?= $isEditor ? 'Rapport d’intervention' : 'Rapports d’intervention' ?> · FoxReport</title>
    <link rel="stylesheet" href="<?= h(foxAsset('assets/app.css')) ?>">
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="icon" href="assets/icons/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="assets/icons/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png" sizes="180x180">
    <script src="<?= h(foxAsset('assets/install.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/update.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/local-store.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/sync-client.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/connection.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/app.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/photos.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/scanner.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/location.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/pwa.js')) ?>" defer></script>
    <script src="<?= h(foxAsset('assets/report-list.js')) ?>" defer></script>
</head>
<body data-user="<?= h($currentUser['sub']) ?>" data-app-version="<?= h(FOXREPORT_VERSION) ?>">
<header class="topbar">
    <a class="brand" href="index.php" aria-label="FoxReport, liste des rapports">
        <img class="brand-logo" src="assets/icons/icon-192.png" width="44" height="44" alt=""><span>Fox<span>Report</span></span>
    </a>
    <div class="topbar-note">
        <details class="actions-menu">
            <summary class="button button-secondary">Menu</summary>
            <div class="actions-content">
                <div data-install-container></div>
                <div data-update-container></div>
                <a href="offline.html" class="button button-secondary">Brouillons locaux</a>
                <a href="salespeople.php" class="button button-secondary">Commerciaux</a>
                <a href="report-settings.php" class="button button-secondary">Paramètres du rapport</a>
                <a href="rapport.php" class="button button-secondary" target="_blank" rel="noopener">Rapport · modèle vide</a>
                <form method="post" action="auth.php?action=logout"><input type="hidden" name="csrf_token" value="<?= h(csrfToken()) ?>"><button class="button button-secondary">Déconnexion</button></form>
            </div>
        </details>
    </div>
</header>

<main class="page-shell">
    <p id="local-sync-status" role="status">Vérification des données locales…</p>
    <?php if (!$isEditor): ?>
        <section class="page-heading">
            <div class="report-list-intro">
                <p class="eyebrow">VOTRE ACTIVITÉ</p>
                <h1>Rapports d’intervention</h1>
                <p class="intro">Retrouvez vos interventions et reprenez un brouillon à tout moment.</p>
            </div>
            <form method="post" action="index.php" class="new-report-form">
                <input type="hidden" name="csrf_token" value="<?= h(csrfToken()) ?>">
                <button class="button button-primary" type="submit" name="action" value="create"><span aria-hidden="true">＋</span> Nouveau rapport</button>
            </form>
        </section>

        <?php if ($errors !== []): ?>
            <div class="alert alert-error" role="alert"><?php foreach (array_unique($errors) as $error): ?><p><?= h($error) ?></p><?php endforeach; ?></div>
        <?php endif; ?>

        <?php
        $listError = '';
        $listFilter = 'open';
        try {
            $listFilter = reportListFilter($_GET['filter'] ?? 'open');
            $list = loadReportList($pdo);
        } catch (PDOException $exception) {
            error_log('FoxReport report list database failed; SQLSTATE ' . $exception->getCode());
            http_response_code(500);
            $listError = 'Impossible de lire la liste. Vérifiez la connexion à la base FoxReport et ses tables ; consultez le journal PHP.';
        } catch (RuntimeException $exception) {
            http_response_code(503);
            $listError = $exception->getMessage();
        }
        ?>
        <nav class="report-filters" aria-label="Filtrer les rapports">
            <?php foreach (['open' => 'Ouverts', 'closed' => 'Clôturés', 'all' => 'Tous'] as $filter => $label): ?>
                <a class="button button-secondary <?= $listFilter === $filter ? 'is-selected' : '' ?>" href="index.php?filter=<?= h($filter) ?>" <?= $listFilter === $filter ? 'aria-current="page"' : '' ?>><?= h($label) ?></a>
            <?php endforeach; ?>
        </nav>
        <p id="report-list-state" class="sr-only" role="status"></p>
        <div id="report-list-error" class="alert alert-error" role="alert" <?= $listError === '' ? 'hidden' : '' ?>><?= h($listError) ?></div>
        <section class="panel report-list-panel" id="live-report-list" data-filter="<?= h($listFilter) ?>">
            <?php if ($listError !== ''): ?>
                <div class="empty-state"><p>Liste indisponible. Corrigez l’erreur signalée puis rechargez la page.</p></div>
            <?php else: ?>
                <?= renderReportList($list, csrfToken(), $listFilter) ?>
            <?php endif; ?>
        </section>

    <?php else: ?>
        <section class="editor-heading">
            <div>
                <h1><?= h($formData['establishment'] ?? '') ?: 'Nouveau rapport' ?></h1>
            </div>
            <div class="editor-tools">
                <span class="status-badge <?= $report['status'] === 'finalized' ? 'status-final' : 'status-draft' ?>"><span></span><?= $report['status'] === 'finalized' ? 'Finalisé' : 'Brouillon' ?></span>
            </div>
        </section>

        <?php if ($errors !== []): ?>
            <div class="alert alert-error" role="alert"><strong>La sauvegarde nécessite votre attention.</strong><?php foreach (array_unique($errors) as $error): ?><p><?= h($error) ?></p><?php endforeach; ?></div>
        <?php endif; ?>

        <form method="post" action="index.php?id=<?= (int) $report['id'] ?>" enctype="multipart/form-data" id="report-form" class="report-form">
            <input type="hidden" name="revision" value="<?= (int) $report['revision'] ?>">
            <input type="hidden" name="csrf_token" value="<?= h(csrfToken()) ?>">
            <input type="hidden" name="report_id" value="<?= (int) $report['id'] ?>">
            <input type="hidden" name="active_section" value="<?= (int) $activeSection ?>" id="active-section">
            <input type="hidden" name="action" value="save" id="form-action">
            <input type="hidden" name="completed_sections" value="<?= h(json_encode($completedSectionState, JSON_THROW_ON_ERROR)) ?>" id="completed-sections">
            <input type="hidden" name="photo_order" value="<?= h(is_string($_POST['photo_order'] ?? null) ? $_POST['photo_order'] : '[]') ?>" id="photo-order">
            <input type="hidden" name="photo_deleted" value="<?= h(is_string($_POST['photo_deleted'] ?? null) ? $_POST['photo_deleted'] : '[]') ?>" id="photo-deleted">
            <div class="step-controls">
                <button type="button" class="button button-secondary" id="previous-step">Précédent</button>
                <span id="step-progress" class="sr-only" aria-live="polite">Étape <?= array_search($activeSection, array_keys($sections), true) + 1 ?>/<?= count($sections) ?></span>
                <button type="button" class="button button-primary" id="next-step">Suivant</button>
            </div>
            <div id="sync-conflict" class="alert alert-error" hidden>
                <p>Une autre version existe sur le serveur. Vos saisies locales sont conservées.</p>
                <button type="button" class="button button-secondary" id="conflict-server">Utiliser la version serveur</button>
                <button type="button" class="button button-secondary" id="conflict-copy">Enregistrer mes saisies dans un nouveau rapport</button>
            </div>
            <fieldset <?= $isEditable ? '' : 'disabled' ?>>
                <?php sectionStart(1, $formData, $activeSection); ?>
                    <div class="form-grid commercial-row commercial-row-four">
                        <?php inputField($formData, 'establishment', 'Établissement'); ?>
                        <?php inputField($formData, 'address', 'Adresse'); ?>
                        <?php inputField($formData, 'postal_code', 'Code postal'); ?>
                        <?php inputField($formData, 'city', 'Ville'); ?>
                        <?php inputField($formData, 'contact_name', 'Contact sur place'); ?>
                        <?php inputField($formData, 'contact_phone', 'Téléphone contact', 'tel', 'tel'); ?>
                        <?php inputField($formData, 'contact_email', 'E-mail contact', 'email', 'email'); ?>
                    </div>
                    <div class="form-grid commercial-row">
                        <input type="hidden" name="sales_rep" value="<?= h(value($formData, 'sales_rep')) ?>">
                        <?php
                        $salesOptions = [''=>value($formData, 'sales_rep') !== '' ? value($formData, 'sales_rep') . ' (ancien contact)' : 'Choisir un commercial'];
                        foreach ($salespeople as $person) $salesOptions[(string) $person['id']] = salespersonName($person);
                        selectField($formData, 'sales_rep_id', 'Commercial', $salesOptions);
                        ?>
                        <?php inputField($formData, 'order_reference', 'Référence de commande'); ?>
                        <?php inputField($formData, 'order_date', 'Date de commande', 'date'); ?>
                        <?php inputField($formData, 'customer_id', 'Customer ID'); ?>
                    </div>
                <?php sectionEnd(1, $isEditable); ?>
                <?php sectionStart(13, $formData, $activeSection); ?>
                    <div class="form-grid commercial-row commercial-row-four">
                        <label class="field field-floating field-native"><input id="organisation-order-date" type="date" readonly value="<?= h(value($formData, 'order_date')) ?>"><span class="field-title">Date de commande</span></label>
                        <?php inputField($formData, 'report_date', 'Date de l’intervention', 'date'); ?>
                        <?php inputField($formData, 'intervention_id', 'Identifiant intervention'); ?>
                        <label class="field field-floating"><input id="report-day-number" placeholder=" " readonly aria-label="Numéro du jour dans l’année (calculé)"><span class="field-title">Numéro du jour (calculé)</span></label>
                        <?php inputField($formData, 'author', 'Rédacteur'); ?>
                    </div>
                    <div class="intervention-followup">
                        <h3>Suivi intervention</h3>
                        <input type="hidden" name="intervention_followup" id="intervention-followup" value="<?= h(value($formData, 'intervention_followup') ?: '[]') ?>">
                        <div id="followup-rows"></div>
                        <?php if ($isEditable): ?><button type="button" class="button button-primary" id="add-followup">Ajouter une ligne de suivi</button><?php endif; ?>
                        <p id="followup-message" role="alert"></p>
                    </div>
                <?php sectionEnd(13, $isEditable); ?>
                <?php sectionStart(12, $formData, $activeSection); ?>
                    <?php inputField($formData, 'gallery_url', 'Lien galerie photo', 'url'); ?>
                    <div class="location-block">
                        <h3>Localisation de l’intervention</h3>
                        <div class="form-grid">
                            <?php inputField($formData, 'latitude', 'Latitude (-90 à 90)'); ?>
                            <?php inputField($formData, 'longitude', 'Longitude (-180 à 180)'); ?>
                            <?php selectField(array_replace($formData, ['map_zoom' => value($formData, 'map_zoom') ?: '15']), 'map_zoom', 'Zoom', array_combine(range(1, 20), array_map('strval', range(1, 20)))); ?>
                            <?php selectField($formData, 'map_style', 'Style de carte', ['sober-v1' => 'Sobre', 'roadmap-v1' => 'Plan standard']); ?>
                        </div>
                        <button type="button" class="button button-secondary" id="use-position">Utiliser ma position</button>
                        <button type="button" class="button button-secondary" id="refresh-map">Afficher la carte</button>
                        <p id="location-message" role="status">Les coordonnées restent enregistrables sans carte. Cliquez sur la carte pour corriger le repère.</p>
                        <img id="location-map" class="location-map" alt="Localisation de l’intervention, carte Google" hidden>
                    </div>
                    <?php photoBlock(1, $photosBySection, $isEditable); ?>
                <?php sectionEnd(12, $isEditable); ?>

                <?php sectionStart(2, $formData, $activeSection); ?>
                    <div class="form-grid">
                        <?php inputField($formData, 'evaluation_minutes', 'Temps d’intervention (minutes)', 'number'); ?>
                        <?php statusSelect($formData, 'network_status', 'Réseau'); ?>
                        <?php selectField($formData, 'hardware_installation', 'Installation matériel', ['' => 'À préciser', 'complete' => 'Complète', 'partial' => 'Partielle', 'not_done' => 'Non réalisée']); ?>
                        <?php selectField($formData, 'skills_transfer', 'Transfert de compétences', ['' => 'À préciser', 'complete' => 'Effectué', 'partial' => 'Partiel', 'not_done' => 'Non réalisé']); ?>
                    </div>
                    <?php photoBlock(2, $photosBySection, $isEditable); ?>
                <?php sectionEnd(2, $isEditable); ?>

                <?php sectionStart(3, $formData, $activeSection); ?>
                    <div class="form-grid form-grid-narrow inventory-topline"><?php booleanSelect($formData, 'all_material_installed', 'Tout le matériel est installé'); ?></div>
                    <div class="inventory-summary" data-inventory-summary aria-live="polite"></div>
                    <div class="table-wrap device-table-wrap"><table class="device-table">
                        <thead><tr><th>Catégorie</th><th>Marque</th><th>Modèle</th><th>N° série</th><th>MAC</th><th>Emplacement</th><th>État</th><th>Commentaire</th><th>Mot de passe (hors PDF)</th><th><span class="sr-only">Retirer</span></th></tr></thead>
                        <tbody id="device-rows">
                        <?php foreach ($postedDevices as $index => $device): ?>
                            <tr class="device-row">
                                <td><select name="devices[<?= (int) $index ?>][category]" aria-label="Catégorie"><?php foreach ($deviceCategories as $key => $label): ?><option value="<?= h($key) ?>"<?= ($device['category'] ?? '') === $key ? ' selected' : '' ?>><?= h($label) ?></option><?php endforeach; ?></select></td>
                                <?php foreach (['brand' => 'Marque', 'model' => 'Modèle', 'serial_number' => 'N° série', 'mac_address' => 'MAC', 'location' => 'Emplacement'] as $field => $label): ?><td><input name="devices[<?= (int) $index ?>][<?= h($field) ?>]" value="<?= h((string) ($device[$field] ?? '')) ?>" aria-label="<?= h($label) ?>" maxlength="<?= $field === 'model' ? '160' : '190' ?>"></td><?php endforeach; ?>
                                <td><select name="devices[<?= (int) $index ?>][state]" aria-label="État"><option value="installed"<?= ($device['state'] ?? '') === 'installed' ? ' selected' : '' ?>>Installé</option><option value="configured"<?= ($device['state'] ?? '') === 'configured' ? ' selected' : '' ?>>Configuré</option><option value="already_present"<?= ($device['state'] ?? '') === 'already_present' ? ' selected' : '' ?>>Déjà présent</option></select></td>
                                <td><input name="devices[<?= (int) $index ?>][comment]" value="<?= h((string) ($device['comment'] ?? '')) ?>" aria-label="Commentaire" maxlength="500"></td>
                                <td><input type="password" name="devices[<?= (int) $index ?>][decoded_password]" value="<?= h((string) ($device['decoded_password'] ?? '')) ?>" aria-label="Mot de passe décodé (hors PDF)" maxlength="500" autocomplete="off"></td>
                                <td><button type="button" class="icon-button remove-device" aria-label="Retirer cet appareil">×</button></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table></div>
                    <template id="device-row-template"><tr class="device-row">
                        <td><select data-device-field="category" aria-label="Catégorie"><?php foreach ($deviceCategories as $key => $label): ?><option value="<?= h($key) ?>"><?= h($label) ?></option><?php endforeach; ?></select></td>
                        <td><input data-device-field="brand" aria-label="Marque" maxlength="120"></td><td><input data-device-field="model" aria-label="Modèle" maxlength="160"></td>
                        <td><input data-device-field="serial_number" aria-label="N° série" maxlength="160"></td><td><input data-device-field="mac_address" aria-label="MAC" maxlength="32"></td>
                        <td><input data-device-field="location" aria-label="Emplacement" maxlength="190"></td>
                        <td><select data-device-field="state" aria-label="État"><option value="installed">Installé</option><option value="configured">Configuré</option><option value="already_present">Déjà présent</option></select></td>
                        <td><input data-device-field="comment" aria-label="Commentaire" maxlength="500"></td><td><input type="password" data-device-field="decoded_password" aria-label="Mot de passe décodé (hors PDF)" maxlength="500" autocomplete="off"></td><td><button type="button" class="icon-button remove-device" aria-label="Retirer cet appareil">×</button></td>
                    </tr></template>
                    <button type="button" class="button button-secondary add-device" id="add-device">＋ Ajouter un appareil</button>
                    <button type="button" class="button button-secondary" id="scan-device">Scanner un matériel / OCR</button>
                    <p class="field-note">Les quantités affichées ci-dessus correspondent au nombre de lignes de chaque catégorie.</p>
                    <?php photoBlock(3, $photosBySection, $isEditable); ?>
                <?php sectionEnd(3, $isEditable); ?>

                <?php sectionStart(4, $formData, $activeSection); ?>
                    <div class="form-grid form-grid-narrow"><?php inputField($formData, 'context_start_time', 'Heure de début', 'time'); ?><?php inputField($formData, 'context_end_time', 'Heure de fin', 'time'); ?></div>
                    <?php textareaField($formData, 'context_notes', 'Déroulement de l’intervention', 'Vous pouvez compléter ce rapport progressivement.'); ?>
                    <?php photoBlock(4, $photosBySection, $isEditable); ?>
                <?php sectionEnd(4, $isEditable); ?>

                <?php sectionStart(5, $formData, $activeSection); ?>
                    <div class="form-grid"><?php booleanSelect($formData, 'nuc_installed', 'NUC installé'); ?><?php booleanSelect($formData, 'internet_present', 'Connexion Internet présente'); ?><?php booleanSelect($formData, 'router_switch_present', 'Routeur / switch présent'); ?></div>
                    <?php textareaField($formData, 'infrastructure_notes', 'Notes sur l’infrastructure'); ?>
                    <?php photoBlock(5, $photosBySection, $isEditable); ?>
                <?php sectionEnd(5, $isEditable); ?>

                <?php sectionStart(6, $formData, $activeSection); ?>
                    <div class="related-assets" data-related-categories="wifi_ap"></div>
                    <?php textareaField($formData, 'wifi_comment', 'Commentaire Wi-Fi'); ?>
                    <?php photoBlock(6, $photosBySection, $isEditable); ?>
                <?php sectionEnd(6, $isEditable); ?>

                <?php sectionStart(7, $formData, $activeSection); ?>
                    <div class="related-assets" data-related-categories="printer_wired,printer_wifi,printer_portable"></div>
                    <?php textareaField($formData, 'printer_comment', 'Affectation et configuration'); ?>
                    <?php photoBlock(7, $photosBySection, $isEditable); ?>
                <?php sectionEnd(7, $isEditable); ?>

                <?php sectionStart(8, $formData, $activeSection); ?>
                    <div class="related-assets" data-related-categories="payment_terminal,nyc_mobile_tap"></div>
                    <div class="form-grid"><?php statusSelect($formData, 'payment_tpe_status', 'TPE'); ?><?php statusSelect($formData, 'payment_tap_to_pay_status', 'Tap to Pay'); ?></div>
                    <?php textareaField($formData, 'payment_comment', 'Commentaire paiement'); ?>
                    <?php photoBlock(8, $photosBySection, $isEditable); ?>
                <?php sectionEnd(8, $isEditable); ?>

                <?php sectionStart(9, $formData, $activeSection); ?>
                    <div class="related-assets" data-related-categories="ipad_pro,ipad,ipad_mini,iphone"></div>
                    <div class="form-grid"><?php selectField($formData, 'apple_account_status', 'Compte Apple', ['' => 'À préciser', 'ready' => 'Prêt', 'issue' => 'À résoudre', 'not_applicable' => 'Non applicable']); ?><?php selectField($formData, 'lightspeed_activation_status', 'Activation Lightspeed', ['' => 'À préciser', 'activated' => 'Activée', 'not_activated' => 'Non activée', 'not_applicable' => 'Non applicable']); ?></div>
                    <?php textareaField($formData, 'apple_comment', 'Commentaire iPad / iPhone'); ?>
                    <?php photoBlock(9, $photosBySection, $isEditable); ?>
                <?php sectionEnd(9, $isEditable); ?>

                <?php sectionStart(10, $formData, $activeSection); ?>
                    <div class="form-grid"><?php booleanSelect($formData, 'training_delivered', 'Formation dispensée'); ?><?php inputField($formData, 'training_participants', 'Nombre de participants', 'number'); ?></div>
                    <fieldset class="checklist"><legend>Thèmes de formation</legend>
                        <?php foreach ($trainingTopics as $topic => $label): ?><label class="check-option"><input type="checkbox" name="training_topics[]" value="<?= h($topic) ?>"<?= in_array($topic, $formData['training_topics'] ?? [], true) ? ' checked' : '' ?>><span><?= h($label) ?></span></label><?php endforeach; ?>
                    </fieldset>
                    <?php textareaField($formData, 'training_comment', 'Commentaire formation'); ?>
                    <?php photoBlock(10, $photosBySection, $isEditable); ?>
                <?php sectionEnd(10, $isEditable); ?>

                <?php sectionStart(11, $formData, $activeSection); ?>
                    <?php textareaField($formData, 'conclusion', 'Conclusion de l’intervention'); ?>
                    <?php photoBlock(11, $photosBySection, $isEditable); ?>
                <?php sectionEnd(11, $isEditable); ?>
            </fieldset>

            <p id="sync-state" role="status">Enregistré</p>
            <?php if ($isEditable): ?>
                <div class="form-actions">
                    <p><span class="save-dot"></span> Vos saisies sont enregistrées à chaque sauvegarde.</p>
                    <div><button class="button button-secondary" type="submit" name="save_status" value="draft">Enregistrer le brouillon</button><button class="button button-primary" type="submit" name="save_status" value="finalized">Finaliser le rapport</button></div>
                </div>
            <?php else: ?>
                <div class="form-actions"><p>Ce rapport est finalisé. Rouvrez-le pour le compléter ou le corriger.</p><button class="button button-primary" type="submit" name="action" value="reopen">Rouvrir pour modification</button></div>
            <?php endif; ?>
        </form>
        <section class="editor-footer panel">
            <p class="report-meta">Rapport #<?= (int) $report['id'] ?> · Modifié <?= h((string) $report['updated_at']) ?></p>
            <p class="field-note">La prévisualisation affiche les données et photos enregistrées. Synchronisez vos modifications avant de l’ouvrir.</p>
            <div class="editor-footer-actions">
                <a class="button button-primary report-preview" href="rapport.php?id=<?= (int) $report['id'] ?>" target="_blank" rel="noopener">Prévisualiser le rapport</a>
                <a class="button button-secondary" href="index.php">Tous les rapports</a>
            </div>
        </section>
    <?php endif; ?>
</main>
<footer class="site-footer"><span>FoxReport</span><span>Rapports d’intervention · Installation &amp; formation Lightspeed</span></footer>
</body>
</html>
<?php
if ($templateRequest) {
    syncJson(['html' => (string) ob_get_clean()]);
}
