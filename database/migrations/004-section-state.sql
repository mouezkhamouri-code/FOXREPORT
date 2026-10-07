-- Execute explicitly once on the dedicated FoxReport database, after backup.
ALTER TABLE foxreport_reports ADD COLUMN completed_sections TEXT NULL;
