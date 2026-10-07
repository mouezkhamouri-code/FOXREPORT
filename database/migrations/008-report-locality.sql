-- Execute once on the dedicated FoxReport database, after backup and column inspection.
ALTER TABLE foxreport_reports
    ADD COLUMN postal_code VARCHAR(20) NOT NULL DEFAULT '',
    ADD COLUMN city VARCHAR(190) NOT NULL DEFAULT '';
