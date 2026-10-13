-- Source-only schema design (unnumbered). DBA review and migration receipt required.
ALTER TABLE job_requisitions ADD COLUMN IF NOT EXISTS careers_published boolean NOT NULL DEFAULT false;
-- Never run directly against production; check existing recruiting/position policy and historical hashes.
