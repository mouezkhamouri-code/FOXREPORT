-- Execute explicitly on the dedicated FoxReport database, once.
ALTER TABLE foxreport_reports
    ADD COLUMN latitude DECIMAL(10,7) NULL,
    ADD COLUMN longitude DECIMAL(10,7) NULL,
    ADD COLUMN map_zoom TINYINT UNSIGNED NULL,
    ADD COLUMN map_style VARCHAR(30) NOT NULL DEFAULT 'sober-v1';
