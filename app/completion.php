<?php
declare(strict_types=1);

require_once __DIR__ . '/report-definition.php';

const FOXREPORT_COMPLETION_FIELDS = [
    'establishment', 'address', 'report_date', 'contact_name', 'contact_phone',
    'contact_email', 'sales_rep', 'customer_id', 'establishment_id', 'order_reference', 'order_date',
    'gallery_url', 'author', 'intervention_id', 'evaluation_minutes',
    'network_status', 'hardware_installation', 'skills_transfer', 'all_material_installed',
    'context_start_time', 'context_end_time', 'context_notes', 'infrastructure_notes',
    'network_type', 'nebula_controller_configured', 'internet_present', 'switch_present', 'wifi_comment',
    'printer_comment', 'payment_tpe_status', 'payment_tap_to_pay_status', 'payment_comment',
    'apple_account_status', 'lightspeed_activation_status', 'apple_comment',
    'training_delivered', 'training_participants', 'training_comment', 'training_topics',
    'conclusion', 'latitude', 'longitude', 'map_zoom',
];

function reportCompletion(array $report): array
{
    $filled = 0;
    foreach (FOXREPORT_COMPLETION_FIELDS as $field) {
        $value = $report[$field] ?? null;
        if ($field === 'training_topics') {
            $state = trainingChecklistState($value);
            if ($state['items'] !== [] || $state['legacy'] !== []) {
                $filled++;
            }
        } elseif ($value !== null && trim((string) $value) !== '') {
            $filled++;
        }
    }
    $total = count(FOXREPORT_COMPLETION_FIELDS);
    return [
        'filled' => $filled,
        'total' => $total,
        'percent' => (int) round(100 * $filled / $total),
    ];
}
