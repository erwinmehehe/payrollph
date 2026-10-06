import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0045_multi_legal_entities.sql", "utf8");
const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
const legalApi = readFileSync("src/app/api/legal-entities/route.ts", "utf8");
const payrollRoute = readFileSync("src/app/api/payroll-runs/route.ts", "utf8");
const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
const panel = readFileSync("src/components/legal-entities-panel.tsx", "utf8");
const payrollModal = readFileSync("src/components/workspace/panels.tsx", "utf8");
const primaryHelper = readFileSync("src/lib/legal-entity.ts", "utf8");

test("legal employers are modeled under organizations and referenced by employees and payroll runs", () => {
  assert.ok(schema.includes('export const legalEntities = pgTable('));
  assert.ok(schema.includes('"legal_entities"'));
  assert.ok(schema.includes('uniqueIndex("legal_entities_org_code_unique")'));
  assert.ok(schema.includes('uniqueIndex("legal_entities_org_primary_unique")'));

  const employeeBlock = schema.slice(
    schema.indexOf('export const employees = pgTable("employees"'),
    schema.indexOf("export const employeeWorksiteAssignments"),
  );
  assert.ok(employeeBlock.includes('legalEntityId: integer("legal_entity_id")'));

  const worksiteBlock = schema.slice(
    schema.indexOf("export const worksites = pgTable"),
    schema.indexOf('export const employees = pgTable("employees"'),
  );
  assert.ok(!worksiteBlock.includes('legalEntityId: integer("legal_entity_id")'));

  const runBlock = schema.slice(
    schema.indexOf('export const payrollRuns = pgTable("payroll_runs"'),
    schema.indexOf("export const employeePayRetroAdjustments"),
  );
  assert.ok(runBlock.includes('legalEntityId: integer("legal_entity_id")'));
});

test("migration creates a primary employer for existing organizations and backfills legacy ownership", () => {
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS "legal_entities"'));
  assert.ok(migration.includes("'PRIMARY'"));
  assert.ok(migration.includes('WHERE NOT EXISTS ('));
  assert.ok(migration.includes('ALTER TABLE "employees"'));
  assert.ok(migration.includes('ALTER TABLE "payroll_runs"'));
  assert.ok(migration.includes('WHERE e."legal_entity_id" IS NULL'));
  assert.ok(migration.includes('WHERE pr."legal_entity_id" IS NULL'));
});

test("production compatibility schema carries the same additive migration", () => {
  assert.match(compat, /linaw_core_schema_compat_v(?:1[6-9]|[2-9]\\d+)/);
  assert.ok(compat.includes("CREATE TABLE IF NOT EXISTS legal_entities"));
  assert.ok(compat.includes("ALTER TABLE employees"));
  assert.ok(compat.includes("ADD COLUMN IF NOT EXISTS legal_entity_id"));
  assert.ok(compat.includes("UPDATE payroll_runs pr"));
  assert.ok(compat.includes("legal_entities_org_primary_unique"));
});

test("newly created organizations lazily receive an idempotent PRIMARY employer", () => {
  assert.ok(primaryHelper.includes('code: "PRIMARY"'));
  assert.ok(primaryHelper.includes("onConflictDoNothing"));
  assert.ok(primaryHelper.includes("organization.statutoryDeductionTiming"));
  assert.ok(primaryHelper.includes("organization.payrollCalendarMode"));

  const employeesApi = readFileSync("src/app/api/employees/route.ts", "utf8");
  assert.ok(employeesApi.includes("ensurePrimaryLegalEntity(organizationId)"));
  assert.ok(payrollRoute.includes("ensurePrimaryLegalEntity(organizationId)"));
  assert.ok(legalApi.includes("ensurePrimaryLegalEntity(organizationId)"));
});

test("full legal-employer data is company-wide admin only while payroll gets a minimal selector", () => {
  assert.ok(legalApi.includes('url.searchParams.get("mode") === "selector"'));
  assert.ok(legalApi.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(legalApi.includes("Legal-employer administration requires company-wide access."));
  assert.ok(legalApi.includes("disbursementAccount: maskBankAccount"));
  assert.ok(legalApi.includes("requireSensitiveActionMfa(user)"));
  assert.ok(legalApi.includes("enforceSameOriginMutation(request)"));

  const selector = legalApi.slice(
    legalApi.indexOf("if (selectorMode)"),
    legalApi.indexOf("const denied = await requireAdmin", legalApi.indexOf("if (selectorMode)")),
  );
  assert.ok(selector.includes("id: legalEntities.id"));
  assert.ok(selector.includes("code: legalEntities.code"));
  assert.ok(selector.includes("displayName: legalEntities.displayName"));
  assert.ok(!selector.includes("birTin:"));
  assert.ok(!selector.includes("disbursementAccount:"));
});

test("ad-hoc legal-employer reassignment is blocked after released payroll", () => {
  assert.ok(legalApi.includes('action === "assign_employee"'));
  assert.ok(legalApi.includes('eq(payrollRuns.status, "Released")'));
  assert.ok(legalApi.includes("LEGAL_ENTITY_TRANSFER_REQUIRES_WORKFLOW"));
  assert.ok(legalApi.includes("effective-dated transfer workflow"));
});

test("new payroll binds to one active legal employer and uses its calendar policy", () => {
  assert.ok(payrollRoute.includes("requestedLegalEntityId"));
  assert.ok(payrollRoute.includes("legalEntity.payrollCalendarMode"));
  assert.ok(payrollRoute.includes("eq(employees.legalEntityId, legalEntity.id)"));
  assert.ok(payrollRoute.includes("legalEntityId: legalEntity.id"));
  assert.ok(payrollRoute.includes("legalEntityCode: legalEntity.code"));
  assert.ok(payrollRoute.includes("legalEntityName: legalEntity.displayName"));
});

test("payroll queue and chunk execution both preserve the legal-employer cohort", () => {
  const matches = engine.match(/eq\(employees\.legalEntityId, run\.legalEntityId\)/g) ?? [];
  assert.ok(matches.length >= 4, "both scoped and all-unit branches must filter the legal employer");
  assert.ok(engine.includes("const payrollEmployer = legalEntity ?? organization"));
  assert.ok(engine.includes("statutoryDeductionTiming: payrollEmployer.statutoryDeductionTiming"));
  assert.ok(engine.includes("Payroll legal employer missing"));
});

test("new employees default to a valid active legal employer", () => {
  const employeesApi = readFileSync("src/app/api/employees/route.ts", "utf8");
  assert.ok(employeesApi.includes("requestedLegalEntityId"));
  assert.ok(employeesApi.includes("entity.primaryEntity"));
  assert.ok(employeesApi.includes("legalEntityId: selectedLegalEntity.id"));
  assert.ok(employeesApi.includes("Create an active legal employer before adding employees."));
});

test("enterprise UI manages legal employers without exposing stored bank accounts", () => {
  assert.ok(panel.includes("Hard payroll boundary."));
  assert.ok(panel.includes("Government registration and payroll policy belong to the employer"));
  assert.ok(panel.includes('action: "assign_employee"'));
  assert.ok(panel.includes('action: "set_primary"'));
  assert.ok(panel.includes('action: "update_entity"'));
  assert.ok(panel.includes("Leave blank to keep current encrypted account"));
  assert.ok(!panel.includes("decryptBankAccount"));
});

test("payroll modal requires a legal employer and uses selector-safe API mode", () => {
  const modalStart = payrollModal.indexOf("export function NewPayrollModal");
  const modalEnd = payrollModal.indexOf("export function OutboxModal");
  const modal = payrollModal.slice(modalStart, modalEnd);
  assert.ok(modal.includes("legalEntityId: number"));
  assert.ok(modal.includes("mode=selector"));
  assert.ok(modal.includes("Legal employer"));
  assert.ok(modal.includes("invalidEntity"));
  assert.ok(modal.includes("The payroll run is bound to one legal employer."));
});
