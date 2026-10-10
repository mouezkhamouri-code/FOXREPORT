-- Execute explicitly on the dedicated FoxReport MySQL database.
-- This script only creates foxreport_-prefixed tables; it does not select,
-- create, or modify any PLANESTO database or tables.

CREATE TABLE IF NOT EXISTS foxreport_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    intervention_uid CHAR(32) NOT NULL,
    report_type VARCHAR(100) NOT NULL DEFAULT 'Installation et formation Lightspeed',
    status ENUM('draft', 'finalized') NOT NULL DEFAULT 'draft',
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    completed_sections TEXT NULL,
    establishment VARCHAR(190) NOT NULL DEFAULT '',
    address VARCHAR(500) NOT NULL DEFAULT '',
    postal_code VARCHAR(20) NOT NULL DEFAULT '',
    city VARCHAR(190) NOT NULL DEFAULT '',
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    map_zoom TINYINT UNSIGNED NULL,
    map_style VARCHAR(30) NOT NULL DEFAULT 'sober-v1',
    report_date DATE NULL,
    contact_name VARCHAR(190) NOT NULL DEFAULT '',
    contact_phone VARCHAR(60) NOT NULL DEFAULT '',
    contact_email VARCHAR(190) NOT NULL DEFAULT '',
    sales_rep VARCHAR(190) NOT NULL DEFAULT '',
    sales_rep_id BIGINT UNSIGNED NULL,
    customer_id VARCHAR(100) NOT NULL DEFAULT '',
    establishment_id VARCHAR(100) NOT NULL DEFAULT '',
    order_reference VARCHAR(100) NOT NULL DEFAULT '',
    order_date DATE NULL,
    gallery_url VARCHAR(2048) NOT NULL DEFAULT '',
    author VARCHAR(190) NOT NULL DEFAULT '',
    intervention_id VARCHAR(100) NOT NULL DEFAULT '',
    intervention_followup MEDIUMTEXT NULL,
    evaluation_minutes SMALLINT UNSIGNED NULL,
    network_status VARCHAR(30) NOT NULL DEFAULT '',
    hardware_installation VARCHAR(30) NOT NULL DEFAULT '',
    skills_transfer VARCHAR(30) NOT NULL DEFAULT '',
    all_material_installed TINYINT(1) NULL,
    equipment_comment TEXT NOT NULL,
    context_start_time TIME NULL,
    context_end_time TIME NULL,
    context_notes TEXT NOT NULL,
    infrastructure_notes TEXT NOT NULL,
    internet_present TINYINT(1) NULL,
    network_type VARCHAR(40) NOT NULL DEFAULT '',
    nebula_controller_configured TINYINT(1) NULL,
    switch_present TINYINT(1) NULL,
    wifi_comment TEXT NOT NULL,
    printer_comment TEXT NOT NULL,
    payment_tpe_status VARCHAR(30) NOT NULL DEFAULT '',
    payment_tap_to_pay_status VARCHAR(30) NOT NULL DEFAULT '',
    payment_comment TEXT NOT NULL,
    apple_account_status VARCHAR(30) NOT NULL DEFAULT '',
    lightspeed_activation_status VARCHAR(30) NOT NULL DEFAULT '',
    apple_comment TEXT NOT NULL,
    training_delivered TINYINT(1) NULL,
    training_participants SMALLINT UNSIGNED NULL,
    training_comment TEXT NOT NULL,
    training_topics TEXT NOT NULL,
    conclusion TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_foxreport_intervention_uid (intervention_uid),
    KEY idx_foxreport_status_date (status, report_date),
    KEY idx_foxreport_establishment (establishment)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    report_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(40) NOT NULL,
    brand VARCHAR(120) NOT NULL DEFAULT '',
    model VARCHAR(160) NOT NULL DEFAULT '',
    serial_number VARCHAR(160) NOT NULL DEFAULT '',
    mac_address VARCHAR(32) NOT NULL DEFAULT '',
    location VARCHAR(190) NOT NULL DEFAULT '',
    state ENUM('installed', 'configured', 'already_present') NOT NULL DEFAULT 'installed',
    comment VARCHAR(500) NOT NULL DEFAULT '',
    decoded_password VARCHAR(500) NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    KEY idx_foxreport_devices_report_category (report_id, category),
    CONSTRAINT fk_foxreport_devices_report
        FOREIGN KEY (report_id) REFERENCES foxreport_reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_photos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    report_id BIGINT UNSIGNED NOT NULL,
    section_number TINYINT UNSIGNED NOT NULL,
    stored_name CHAR(36) NOT NULL,
    mime_type VARCHAR(20) NOT NULL,
    caption VARCHAR(500) NOT NULL DEFAULT '',
    crop_format ENUM('original', 'square', 'landscape', 'portrait') NOT NULL DEFAULT 'original',
    client_uid CHAR(36) NULL,
    sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_foxreport_photos_report_section (report_id, section_number),
    UNIQUE KEY idx_foxreport_photos_client (report_id, client_uid),
    CONSTRAINT fk_foxreport_photos_report
        FOREIGN KEY (report_id) REFERENCES foxreport_reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_sync_operations (
    request_id CHAR(36) NOT NULL,
    report_id BIGINT UNSIGNED NOT NULL,
    user_sub VARCHAR(255) NOT NULL,
    result_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (request_id),
    CONSTRAINT fk_foxreport_sync_report FOREIGN KEY (report_id) REFERENCES foxreport_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_salespeople (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    last_name VARCHAR(90) NOT NULL,
    first_name VARCHAR(90) NOT NULL,
    phone VARCHAR(60) NOT NULL DEFAULT '',
    email VARCHAR(190) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_device_types (
    category VARCHAR(40) NOT NULL,
    label VARCHAR(120) NOT NULL,
    PRIMARY KEY (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_device_models (
    model_key CHAR(64) NOT NULL,
    category VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    PRIMARY KEY (model_key),
    KEY idx_foxreport_device_models_category (category),
    CONSTRAINT fk_foxreport_device_models_type FOREIGN KEY (category)
        REFERENCES foxreport_device_types(category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS foxreport_training_items (
    item_key VARCHAR(60) NOT NULL,
    theme_key VARCHAR(40) NOT NULL,
    label VARCHAR(300) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (item_key),
    KEY idx_foxreport_training_items_theme (theme_key, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO foxreport_device_types (category, label) VALUES
('ipad_pro', 'iPad Pro'), ('ipad', 'iPad'), ('ipad_mini', 'iPad Mini'),
('iphone', 'iPhone'), ('router', 'Routeur'), ('switch_poe', 'Switch POE'),
('wifi_ap', 'Borne Wi-Fi'), ('printer_wired', 'Imprimante filaire'),
('printer_wifi', 'Imprimante Wi-Fi'), ('printer_portable', 'Imprimante portative'),
('payment_terminal', 'TPE'), ('nyc_mobile_tap', 'NYC Mobile TAP'), ('cash_drawer', 'Tiroir-caisse');
