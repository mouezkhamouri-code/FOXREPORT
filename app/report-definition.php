<?php
declare(strict_types=1);

$sections = [
    1 => 'INFORMATIONS COMMERCIALES',
    13 => 'Organisation de l’intervention',
    12 => 'SITE',
    2 => 'Évaluation',
    3 => 'Matériel',
    4 => 'Contexte et déroulement',
    5 => 'Infrastructure réseau',
    6 => 'Wi-Fi',
    7 => 'Imprimantes',
    8 => 'Paiement',
    9 => 'iPad / iPhone',
    10 => 'Formation',
    11 => 'Conclusion',
];

$deviceCategories = [
    'ipad_pro' => 'iPad Pro',
    'ipad' => 'iPad',
    'ipad_mini' => 'iPad Mini',
    'iphone' => 'iPhone',
    'router' => 'Routeur',
    'switch_poe' => 'Switch POE',
    'wifi_ap' => 'Borne Wi-Fi',
    'printer_wired' => 'Imprimante filaire',
    'printer_wifi' => 'Imprimante Wi-Fi',
    'printer_portable' => 'Imprimante portative',
    'payment_terminal' => 'TPE',
    'nyc_mobile_tap' => 'NYC Mobile TAP',
    'cash_drawer' => 'Tiroir-caisse',
];
$standardDeviceCategories = $deviceCategories;

// Wi-Fi and printer photos are square only, shown two per row in the PDF.
const FOXREPORT_SQUARE_PHOTO_SECTIONS = [6, 7];

// Legacy topics (before the detailed checklist); still read and printed for existing reports.
$trainingTopics = [
    'orders_service' => 'Commandes, tables et déroulement du service',
    'payments_refunds' => 'Paiements, remboursements et annulations',
    'printing_receipts' => 'Impression et tickets',
];

// Item keys are "<theme>_<position>": append new items at the end of a theme to keep saved ticks valid.
const FOXREPORT_TRAINING_CHECKLIST = [
    'basics' => ['title' => 'Prendre ses repères', 'items' => [
        'Se connecter avec son utilisateur.',
        'Présenter les écrans principaux et la navigation.',
        'Expliquer les droits des serveurs et des responsables.',
        'Retrouver les tables et les commandes en cours.',
    ]],
    'order' => ['title' => 'Prendre une commande', 'items' => [
        'Ouvrir une table et renseigner le nombre de couverts.',
        'Trouver les produits dans la carte.',
        'Ajouter les articles et modifier les quantités.',
        'Choisir les options et les accompagnements.',
        'Ajouter une remarque destinée à la cuisine.',
        'Prendre une commande sur tablette ou iPhone, selon l’équipement.',
    ]],
    'pace' => ['title' => 'Gérer le rythme du service', 'items' => [
        'Organiser les plats et les suites.',
        'Envoyer la commande au bar et en cuisine.',
        'Réclamer la suite selon le fonctionnement du restaurant.',
        'Ajouter des boissons ou des plats après le premier envoi.',
        'Retrouver une table et consulter sa commande.',
    ]],
    'edit' => ['title' => 'Modifier une commande', 'items' => [
        'Corriger un article ou une quantité.',
        'Supprimer ou annuler un article et expliquer les droits nécessaires.',
        'Modifier une option ou une remarque.',
        'Déplacer une commande vers une autre table.',
        'Transférer une table à un autre serveur, si cette fonction est utilisée.',
    ]],
    'payment' => ['title' => 'Encaisser', 'items' => [
        'Consulter l’addition et vérifier son contenu.',
        'Encaisser en espèces et vérifier la monnaie à rendre.',
        'Encaisser par carte avec le dispositif utilisé sur place.',
        'Partager une addition.',
        'Utiliser plusieurs moyens de paiement sur une même addition.',
        'Imprimer ou envoyer un justificatif.',
        'Ouvrir le tiroir-caisse selon les droits disponibles.',
    ]],
    'special' => ['title' => 'Gérer les cas particuliers', 'items' => [
        'Appliquer une remise.',
        'Enregistrer un offert.',
        'Corriger une erreur de paiement avec la procédure autorisée.',
        'Expliquer les annulations et les remboursements.',
        'Établir une facture, si cette fonction est utilisée.',
        'Vendre et utiliser une carte cadeau, si le restaurant en propose.',
    ]],
    'closing' => ['title' => 'Terminer le service', 'items' => [
        'Repérer les tables et les commandes encore ouvertes.',
        'Vérifier les encaissements par moyen de paiement.',
        'Consulter les rapports de fin de service.',
        'Retrouver le chiffre d’affaires par serveur.',
        'Effectuer le comptage des espèces selon la procédure du restaurant.',
        'Appliquer la procédure de fin de service configurée sur place.',
    ]],
    'issues' => ['title' => 'Réagir à un problème', 'items' => [
        'Vérifier une imprimante qui ne répond plus : alimentation, papier et connexion.',
        'Contrôler une commande non reçue au bar ou en cuisine.',
        'Réagir à un terminal de paiement indisponible.',
        'Vérifier un tiroir-caisse qui ne s’ouvre pas.',
        'Vérifier la connexion et la charge des tablettes ou des iPhone.',
        'Identifier la personne à contacter et les informations à lui transmettre.',
    ]],
    'manager' => ['title' => 'Complément réservé au responsable', 'items' => [
        'Créer les utilisateurs et gérer leurs droits.',
        'Modifier les produits, les prix et les disponibilités.',
        'Consulter les rapports de vente et d’encaissement.',
        'Contrôler les remises, les offerts et les annulations.',
        'Retrouver une transaction pour vérifier ou corriger une erreur.',
    ]],
    'exercises' => ['title' => 'Exercices pratiques de validation', 'items' => [
        'Prendre une commande pour une table de quatre avec une option et une remarque cuisine.',
        'Ajouter des boissons après l’envoi de la commande.',
        'Déplacer une commande vers une autre table.',
        'Partager une addition et encaisser avec deux moyens de paiement.',
        'Corriger une erreur avant encaissement.',
        'Montrer la procédure à suivre pour une erreur après encaissement.',
    ]],
];

const FOXREPORT_TRAINING_ITEM_KEY = '/^[a-z]+_[a-z0-9]{1,24}$/';

/**
 * Shared template (database, see app/training-catalogue.php) when loaded, otherwise the default list.
 * @return array<string, array{title: string, items: array<string, string>}>
 */
function trainingChecklist(): array
{
    if (isset($GLOBALS['foxTrainingChecklist']) && is_array($GLOBALS['foxTrainingChecklist'])) {
        return $GLOBALS['foxTrainingChecklist'];
    }
    return defaultTrainingChecklist();
}

/** @return array<string, array{title: string, items: array<string, string>}> */
function defaultTrainingChecklist(): array
{
    $themes = [];
    foreach (FOXREPORT_TRAINING_CHECKLIST as $theme => $definition) {
        $items = [];
        foreach ($definition['items'] as $index => $label) {
            $items[$theme . '_' . ($index + 1)] = $label;
        }
        $themes[$theme] = ['title' => $definition['title'], 'items' => $items];
    }
    return $themes;
}

/**
 * Accepts the stored JSON (or decoded value): a legacy list of topic keys, or
 * {"items": {"<item>": "done"|"na"}, "legacy": [...]}.
 * @return array{items: array<string, string>, legacy: list<string>}
 */
function trainingChecklistState(mixed $stored): array
{
    if (is_string($stored)) {
        $stored = trim($stored) === '' ? [] : json_decode($stored, true, 512, JSON_THROW_ON_ERROR);
    }
    if ($stored === null) $stored = [];
    if (!is_array($stored)) throw new RuntimeException('La checklist de formation enregistrée est invalide.');
    if (array_is_list($stored)) {
        $stored = ['items' => [], 'legacy' => $stored];
    }
    // Ticks on items absent from the current template are kept: the template is shared and may change.
    $items = [];
    foreach ((array) ($stored['items'] ?? []) as $key => $status) {
        if (is_string($key) && preg_match(FOXREPORT_TRAINING_ITEM_KEY, $key) && in_array($status, ['done', 'na'], true)) $items[$key] = $status;
        if (count($items) >= 1000) break;
    }
    $legacy = array_values(array_filter((array) ($stored['legacy'] ?? []),
        static fn(mixed $topic): bool => is_string($topic) && array_key_exists($topic, $GLOBALS['trainingTopics'])));
    return ['items' => $items, 'legacy' => array_values(array_unique($legacy))];
}

function encodeTrainingChecklist(array $state): string
{
    return json_encode(['items' => (object) $state['items'], 'legacy' => array_values($state['legacy'])], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

function interventionMinutes(mixed $start, mixed $end): ?int
{
    $parse = static function (mixed $time): ?int {
        if (!is_string($time) || !preg_match('/^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/', $time, $match)) return null;
        return (int) $match[1] * 60 + (int) $match[2];
    };
    $startMinutes = $parse($start);
    $endMinutes = $parse($end);
    if ($startMinutes === null || $endMinutes === null) return null;
    // An end time earlier than the start is an intervention that runs past midnight.
    return ($endMinutes - $startMinutes + 1440) % 1440;
}

function formatInterventionDuration(int $minutes): string
{
    if ($minutes < 60) return $minutes . ' min';
    $rest = $minutes % 60;
    return intdiv($minutes, 60) . ' h' . ($rest > 0 ? ' ' . str_pad((string) $rest, 2, '0', STR_PAD_LEFT) : '');
}
