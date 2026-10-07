-- Execute once on the dedicated FoxReport database, after backup and column inspection.
ALTER TABLE foxreport_photos
    ADD COLUMN client_uid CHAR(36) NULL,
    ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN deleted_at DATETIME NULL,
    ADD UNIQUE KEY idx_foxreport_photos_client (report_id, client_uid);
