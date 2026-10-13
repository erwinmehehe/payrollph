-- ISSUE #910: REVIEW-ONLY SQL SOURCE EXTRACT. NO PRODUCTION, NEON OR STAGING EXECUTION.
-- Not a reviewed migration: this file is outside drizzle/ and is not a release input.
-- Do not infer applied receipts. DBA approval, protected clone, finance/legal attribution
-- review and explicitly managed rollback are required before any migration change.
-- Derived from main commit fdf2793d05e0f27372e2c8f22347879b1cf2034c.
-- BEGIN_SOURCE_0121_STAGE --
INSERT INTO user_legal_entity_grants(organization_id,user_id,legal_entity_id)
SELECT m.organization_id, m.user_id,
  COALESCE(u.legal_entity_id, le.id)
FROM user_organizations m
LEFT JOIN org_units u ON u.id = m.org_unit_id AND u.organization_id=m.organization_id
JOIN legal_entities le ON le.organization_id=m.organization_id AND le.primary_entity=true
WHERE m.active = true
  AND m.role IN ('hr','payroll','checker','manager')
ON CONFLICT DO NOTHING;

-- Preserve stable service date. If historical employer move events exist,
-- an exact historical interval backfill requires a reviewed attribution.
-- END_SOURCE_0121_STAGE --
