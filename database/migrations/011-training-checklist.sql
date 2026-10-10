-- Shared training checklist template (section 10). FoxReport fills it with the default list on first use.
CREATE TABLE IF NOT EXISTS foxreport_training_items (
    item_key VARCHAR(60) NOT NULL,
    theme_key VARCHAR(40) NOT NULL,
    label VARCHAR(300) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (item_key),
    KEY idx_foxreport_training_items_theme (theme_key, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;