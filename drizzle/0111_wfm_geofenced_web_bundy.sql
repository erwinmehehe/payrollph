-- Optional geofence table: no breaking changes to legacy worksites columns.
-- Deployed code does not query this table unless an explicitly allowlisted
-- employer has enabled GPS. DBA must rehearse/apply before pilot activation.
CREATE TABLE IF NOT EXISTS worksite_geofence_boundaries (
  worksite_id integer PRIMARY KEY REFERENCES worksites(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  latitude numeric(10,7) NOT NULL,
  longitude numeric(10,7) NOT NULL,
  radius_meters integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worksite_geofence_valid_check CHECK (
    latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
    AND radius_meters BETWEEN 100 AND 2000
  )
);
CREATE INDEX IF NOT EXISTS worksite_geofence_org_idx ON worksite_geofence_boundaries (organization_id);
-- Tenant authorization remains enforced by the existing worksite membership
-- API and the (worksite id, organization id) join on all employee GPS checks.
-- No employee GPS coordinates, tracking history or EXIF is persisted.
