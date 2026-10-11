-- Opt-in workforce GPS worksite configuration only. No employee raw GPS tracks stored.
-- DBA apply/rehearse before deploying source that reads the new columns.
ALTER TABLE worksites
  ADD COLUMN IF NOT EXISTS geofence_latitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS geofence_longitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS geofence_radius_m integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'worksites_geofence_configuration_check') THEN
    ALTER TABLE worksites ADD CONSTRAINT worksites_geofence_configuration_check CHECK (
      (geofence_latitude IS NULL AND geofence_longitude IS NULL AND geofence_radius_m IS NULL)
      OR
      (geofence_latitude IS NOT NULL
       AND geofence_longitude IS NOT NULL
       AND geofence_radius_m IS NOT NULL
       AND geofence_latitude BETWEEN -90 AND 90
       AND geofence_longitude BETWEEN -180 AND 180
       AND geofence_radius_m BETWEEN 100 AND 2000)
    );
  END IF;
END $$;
