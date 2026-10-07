-- Execute explicitly on the dedicated FoxReport database, once.
ALTER TABLE foxreport_reports ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE foxreport_devices ADD COLUMN decoded_password VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE foxreport_photos ADD COLUMN crop_format ENUM('original', 'square', 'landscape', 'portrait') NOT NULL DEFAULT 'original';
CREATE TABLE foxreport_sync_operations (
    request_id CHAR(36) NOT NULL,
    report_id BIGINT UNSIGNED NOT NULL,
    user_sub VARCHAR(255) NOT NULL,
    result_json TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (request_id),
    CONSTRAINT fk_foxreport_sync_report FOREIGN KEY (report_id) REFERENCES foxreport_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
