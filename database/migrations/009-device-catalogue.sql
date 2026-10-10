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

INSERT IGNORE INTO foxreport_device_types (category, label) VALUES
('ipad_pro', 'iPad Pro'), ('ipad', 'iPad'), ('ipad_mini', 'iPad Mini'),
('iphone', 'iPhone'), ('router', 'Routeur'), ('switch_poe', 'Switch POE'),
('wifi_ap', 'Borne Wi-Fi'), ('printer_wired', 'Imprimante filaire'),
('printer_wifi', 'Imprimante Wi-Fi'), ('printer_portable', 'Imprimante portative'),
('payment_terminal', 'TPE'), ('nyc_mobile_tap', 'NYC Mobile TAP'), ('cash_drawer', 'Tiroir-caisse');

INSERT IGNORE INTO foxreport_device_models (model_key, category, name)
SELECT SHA2(CONCAT(d.category, CHAR(10), LOWER(TRIM(d.model))), 256), d.category, TRIM(d.model)
FROM foxreport_devices d JOIN foxreport_device_types t ON t.category = d.category
WHERE TRIM(d.model) <> '';
