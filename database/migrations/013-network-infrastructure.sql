ALTER TABLE foxreport_reports
    ADD COLUMN network_type VARCHAR(40) NOT NULL DEFAULT '' AFTER infrastructure_notes,
    ADD COLUMN nebula_controller_configured TINYINT(1) NULL AFTER network_type,
    ADD COLUMN switch_present TINYINT(1) NULL AFTER internet_present;
