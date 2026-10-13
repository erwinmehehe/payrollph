-- Existing employers retain their complete navigation. Only future INSERTs default to core.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS module_navigation_mode varchar(8) NOT NULL DEFAULT 'all';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '[]';
ALTER TABLE organizations ALTER COLUMN module_navigation_mode SET DEFAULT 'core';
