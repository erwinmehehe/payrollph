import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_OBJECTS, FOUNDATION_OBJECTS_SQL, assessFoundationObjects }
  from "../scripts/lib/foundation-migration-objects.mjs";

const inventory = (missing = []) => FOUNDATION_OBJECTS.map(x => ({
  migration: x.migration, kind: x.kind, objectName: x.objectName,
  present: !missing.includes(x.kind + ":" + x.objectName),
}));

test("Neon production's partially applied 0022 and 0109-0114 must not be treated as adopted", () => {
  const result = assessFoundationObjects(inventory([
    "table:job_profiles", "table:positions", "table:position_assignments",
    "table:audit_chain_heads", "function_integer:seal_audit_events",
    "function_zero:audit_events_protect", "trigger:audit_events_protect_mutation",
    "table:provider_events", "table:worksite_geofence_boundaries",
    "table:workforce_demand_import_batches",
    "table:workforce_demand_observation_revisions",
    "table:workforce_demand_forecast_issues",
    "table:workforce_demand_forecast_scores",
    "table:workforce_demand_staffing_policies",
    "table:workforce_demand_staffing_policy_events",
  ]));
  assert.equal(result.allExpectedObjectsPresent, false);
  assert.equal(result.productionMigrationApproved, false);
  assert.equal(result.migrations.length, 7);
  assert.ok(result.migrations.some(x => x.file.startsWith("0109") && x.missingObjects.length >= 4));
  assert.ok(result.migrations.some(x => x.file.startsWith("0022") && x.missingObjects.includes("table:job_profiles")));
});

test("presence only is never a migration receipt, and each historical file remains independent", () => {
  const result = assessFoundationObjects(inventory());
  assert.equal(result.allExpectedObjectsPresent,true);
  assert.equal(result.productionMigrationApproved,false);
  assert.equal(result.migrations.length,7);
  assert.ok(result.migrations.every(x => x.status === "EXPECTED_OBJECTS_PRESENT_NOT_MIGRATION_RECEIPT"));
});

test("duplicate, unknown, missing and malformed catalog evidence fail closed", () => {
  assert.throws(() => assessFoundationObjects(null), /UNAVAILABLE/);
  assert.throws(() => assessFoundationObjects(inventory().slice(1)), /INCOMPLETE/);
  assert.throws(() => assessFoundationObjects([...inventory(),inventory()[0]]), /INCONSISTENT/);
  assert.throws(() => assessFoundationObjects([{migration:"unknown",kind:"table",objectName:"employees",present:true}]), /INCONSISTENT/);
  assert.throws(() => assessFoundationObjects([{...inventory()[0],present:"true"},...inventory().slice(1)]), /INCONSISTENT/);
});

test("static SQL cannot query employee/payroll or bank row values", () => {
  assert.match(FOUNDATION_OBJECTS_SQL,/pg_catalog\.pg_trigger/);
  assert.match(FOUNDATION_OBJECTS_SQL,/information_schema\.columns/);
  assert.doesNotMatch(FOUNDATION_OBJECTS_SQL,/\bSELECT\s+\*\s+FROM\s+(?:public\.)?(?:employees|payroll_entries|payroll_runs)\b/i);
  assert.doesNotMatch(FOUNDATION_OBJECTS_SQL,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+(?:TABLE|INTO|FROM|public\.)/i);
});
