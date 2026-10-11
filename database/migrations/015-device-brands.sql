-- Run on the dedicated FoxReport database before deployment.
CREATE TABLE IF NOT EXISTS foxreport_device_brands (
    brand_key CHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    ever_used TINYINT(1) NOT NULL DEFAULT 0,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (brand_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only deleted keys are retained, so stale offline catalogues cannot recreate a deleted brand.
CREATE TABLE IF NOT EXISTS foxreport_device_brand_deletions (
    brand_key CHAR(64) NOT NULL,
    PRIMARY KEY (brand_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO foxreport_device_brands (brand_key, name, ever_used)
SELECT SHA2(LOWER(TRIM(brand)), 256), MIN(TRIM(brand)), 1
FROM foxreport_devices
WHERE TRIM(brand) <> ''
GROUP BY SHA2(LOWER(TRIM(brand)), 256);
