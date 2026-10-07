-- Execute once on the dedicated FoxReport database, after backup and column inspection.
ALTER TABLE foxreport_reports ADD COLUMN intervention_followup MEDIUMTEXT NULL;
