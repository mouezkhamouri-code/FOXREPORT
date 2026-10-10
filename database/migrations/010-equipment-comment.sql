-- Execute once on the dedicated FoxReport database, after backup and column inspection.
ALTER TABLE foxreport_reports
    ADD COLUMN equipment_comment TEXT NULL AFTER all_material_installed;
UPDATE foxreport_reports SET equipment_comment = '' WHERE equipment_comment IS NULL;
ALTER TABLE foxreport_reports MODIFY equipment_comment TEXT NOT NULL;
