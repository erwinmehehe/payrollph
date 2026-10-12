-- UNNUMBERED DESIGN PROPOSAL ONLY. DO NOT DEPLOY OR CLAIM MIGRATION APPLIED.
-- Canonical #865 already reserves 0115 and 0116; allocate after the DBA-reviewed release train.
-- Existing tenants keep the full menu. New tenants default to core-only.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS module_visibility varchar(16) NOT NULL DEFAULT 'all';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE organizations ALTER COLUMN module_visibility SET DEFAULT 'core_only';
ALTER TABLE organizations ADD CONSTRAINT organizations_module_visibility_valid CHECK (module_visibility IN ('all', 'core_only'));
