-- Run on the dedicated FoxReport database before deploying the new device state.
-- Existing device states and the default are preserved.
ALTER TABLE foxreport_devices
    MODIFY COLUMN state ENUM('installed', 'configured', 'already_present', 'not_installed') NOT NULL DEFAULT 'installed';
