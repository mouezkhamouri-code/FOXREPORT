-- Execute once on the dedicated FoxReport database, after backup.
CREATE TABLE IF NOT EXISTS foxreport_salespeople (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    last_name VARCHAR(90) NOT NULL,
    first_name VARCHAR(90) NOT NULL,
    phone VARCHAR(60) NOT NULL DEFAULT '',
    email VARCHAR(190) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE foxreport_reports ADD COLUMN sales_rep_id BIGINT UNSIGNED NULL;
