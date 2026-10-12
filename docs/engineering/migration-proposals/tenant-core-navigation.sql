-- UNNUMBERED DESIGN PROPOSAL; DO NOT APPLY TO PRODUCTION.
-- Conflicts with PR #874 canonical 0122 (module_navigation_mode/core).
-- App currently uses module_visibility/core_only: reconcile one schema, no duplicate 0122.
-- Historical SQL receipt, independent DBA review and tenant migration tests are mandatory.
-- SOURCE ONLY / DO NOT APPLY TO PRODUCTION. Follows proposed canonical 0115-0121 train.
-- This does not validate historical migration receipts or authorize Neon deployment.
-- Existing organizations keep their full permitted menu; new organizations use core-only.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS module_visibility varchar(16) NOT NULL DEFAULT 'all';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE organizations ALTER COLUMN module_visibility SET DEFAULT 'core_only';
ALTER TABLE organizations ADD CONSTRAINT organizations_module_visibility_valid
 CHECK (module_visibility IN ('all','core_only'));
