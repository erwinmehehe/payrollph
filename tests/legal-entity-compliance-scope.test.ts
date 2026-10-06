import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { legalEntities, organizations } from "../src/db/schema";
import {
  ensurePrimaryLegalEntity,
  resolveComplianceLegalEntity,
} from "../src/lib/legal-entity";

const schema = readFileSync("src/db/schema.ts", "utf8");
const migration = readFileSync("drizzle/0065_legal_entity_compliance_scope.sql", "utf8");
const compat = readFileSync("src/lib/core-schema-compat.ts", "utf8");
const statutory = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const monthClose = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");
const payrollMonthClose = readFileSync("src/app/api/compliance/payroll-month-close/route.ts", "utf8");
const payrollMonthCloseServer = readFileSync("src/lib/payroll-month-close-server.ts", "utf8");
const bir = readFileSync("src/app/api/compliance/bir-1601c-remittances/route.ts", "utf8");
const loans = readFileSync("src/app/api/compliance/government-loan-remittances/route.ts", "utf8");
const filings = readFileSync("src/lib/filing-evidence-store.ts", "utf8");
const filingApi = readFileSync("src/app/api/compliance/filing-validations/route.ts", "utf8");
const exporter = readFileSync("src/lib/exporters.ts", "utf8");
const selfIssues = readFileSync("src/app/api/self/contribution-issues/route.ts", "utf8");
const payrollIssues = readFileSync("src/app/api/compliance/contribution-issues/route.ts", "utf8");
const postingImport = readFileSync("src/app/api/compliance/statutory-remittances/posting-import/route.ts", "utf8");
const corrections = readFileSync("src/app/api/compliance/statutory-remittance-corrections/route.ts", "utf8");
const certification = readFileSync("src/lib/statutory-remittance-certification.ts", "utf8");
const employeeEvidence = readFileSync("src/app/api/self/contribution-evidence/route.ts", "utf8");
const caseEvidence = readFileSync("src/app/api/compliance/contribution-issues/evidence/route.ts", "utf8");

test("legal-employer compliance columns are first-class and non-null in the Drizzle model", () => {
  for (const table of [
    "governmentFilingValidations",
    "payrollMonthClosures",
    "birWithholdingRemittanceBatches",
    "statutoryRemittanceBatches",
    "statutoryRemittanceMembers",
    "statutoryRemittanceMonthClosures",
    "statutoryContributionIssueCases",
    "governmentLoanRemittanceBatches",
    "governmentLoanRemittanceMembers",
  ]) {
    const start = schema.indexOf(`export const ${table}`);
    assert.ok(start >= 0, `${table} must exist`);
    const chunk = schema.slice(start, start + 5000);
    assert.ok(
      chunk.includes('legalEntityId: integer("legal_entity_id").notNull().references(() => legalEntities.id'),
      `${table} must require a legal employer`,
    );
  }
});

test("migration and compatibility paths backfill legacy evidence before enforcing legal-employer ownership", () => {
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS "legal_entity_id"'));
  assert.ok(migration.includes('ALTER COLUMN "legal_entity_id" SET NOT NULL'));
  assert.ok(migration.includes('"organization_id", "legal_entity_id", "agency", "applicable_month"'));
  assert.ok(migration.includes("Legal-employer compliance backfill incomplete"));
  assert.ok(compat.includes("linaw_core_schema_compat_v18"));
  assert.ok(compat.includes("Multi-legal-employer compliance evidence must never aggregate liabilities"));
  assert.ok(compat.includes("ALTER COLUMN legal_entity_id SET NOT NULL"));
});

test("multi-employer compliance lists and creation paths resolve one legal employer explicitly", () => {
  for (const source of [statutory, monthClose, payrollMonthClose, bir, loans, filingApi, payrollIssues]) {
    assert.ok(source.includes("resolveComplianceLegalEntity"));
    assert.ok(source.includes("legalEntityId"));
  }
  assert.ok(state.includes("eq(payrollRuns.legalEntityId, legalEntityId)"));
  assert.ok(state.includes("eq(governmentFilingValidations.legalEntityId, legalEntityId)"));
  assert.ok(state.includes("eq(statutoryRemittanceBatches.legalEntityId, legalEntityId)"));
});

test("government exports aggregate only payrolls owned by the selected run's legal employer", () => {
  assert.ok(exporter.includes('if (!run.legalEntityId)'));
  assert.ok(exporter.includes("eq(payrollRuns.legalEntityId, run.legalEntityId)"));
  assert.ok(exporter.includes("eq(legalEntities.id, run.legalEntityId)"));
  assert.ok(exporter.includes('const employerTin = (legalEntity.birTin ?? "")'));
  assert.ok(exporter.includes('const employerBranchCode = (legalEntity.birBranchCode ?? "")'));
  assert.ok(!exporter.includes('const employerTin = (organization?.birTin ?? "")'));
});

test("filing/remittance evidence cannot cross legal-employer boundaries", () => {
  assert.ok(filings.includes("legalEntityId: run.legalEntityId"));
  assert.ok(filings.includes("eq(governmentFilingValidations.legalEntityId, run.legalEntityId)"));
  assert.ok(statutory.includes("eq(payrollRuns.legalEntityId, legalEntity.id)"));
  assert.ok(statutory.includes("legalEntityId: legalEntity.id"));
  assert.ok(bir.includes("acceptedFilingForMonth(organizationId: number, legalEntityId: number"));
  assert.ok(bir.includes("eq(governmentFilingValidations.legalEntityId, legalEntityId)"));
  assert.ok(loans.includes("eq(employees.legalEntityId, legalEntity.id)"));
  assert.ok(monthClose.includes("eq(statutoryContributionIssueCases.legalEntityId, legalEntityId)"));
  assert.ok(monthClose.includes("legalEntityId: legalEntity.id"));
  assert.ok(payrollMonthClose.includes("buildPayrollMonthCloseState(organizationId, legalEntity.id, applicableMonth)"));
  assert.ok(payrollMonthClose.includes("eq(payrollMonthClosures.legalEntityId, legalEntity.id)"));
  assert.ok(payrollMonthCloseServer.includes("eq(payrollRuns.legalEntityId, legalEntityId)"));
  assert.ok(payrollMonthCloseServer.includes("eq(governmentFilingValidations.legalEntityId, legalEntityId)"));
  assert.ok(payrollMonthCloseServer.includes("eq(payrollMonthClosures.legalEntityId, legalEntityId)"));
});

test("employee disputes, corrections, exports and certification invalidation stay on their source legal employer", () => {
  assert.ok(selfIssues.includes("legalEntityId: employee.legalEntityId"));
  assert.ok(payrollIssues.includes("eq(statutoryRemittanceMembers.legalEntityId, issue.legalEntityId)"));
  assert.ok(postingImport.includes("legalEntityId: batch.legalEntityId"));
  assert.ok(corrections.includes("legalEntityId: currentBatch.legalEntityId"));
  assert.ok(certification.includes("eq(statutoryRemittanceMonthClosures.legalEntityId, input.legalEntityId)"));
  assert.ok(employeeEvidence.includes("eq(payrollRuns.legalEntityId, employee.legalEntityId)"));
  assert.ok(employeeEvidence.includes("eq(governmentFilingValidations.legalEntityId, employee.legalEntityId)"));
  assert.ok(caseEvidence.includes("eq(payrollRuns.legalEntityId, issue.legalEntityId)"));
  assert.ok(caseEvidence.includes("eq(statutoryRemittanceMonthClosures.legalEntityId, issue.legalEntityId)"));
});

test("ambiguous organizations must choose a legal employer while single-employer organizations remain compatible", async () => {
  const [organization] = await db.insert(organizations).values({
    name: "Legal Entity Compliance Golden",
    legalName: "Legal Entity Compliance Golden Inc.",
    plan: "Core",
  }).returning();

  try {
    const primary = await ensurePrimaryLegalEntity(organization.id);
    assert.ok(primary);

    const inferred = await resolveComplianceLegalEntity({ organizationId: organization.id });
    assert.equal(inferred.id, primary!.id);

    const [second] = await db.insert(legalEntities).values({
      organizationId: organization.id,
      code: "SECOND",
      legalName: "Second Employer Inc.",
      displayName: "Second Employer",
      primaryEntity: false,
      active: true,
    }).returning();

    await assert.rejects(
      resolveComplianceLegalEntity({ organizationId: organization.id }),
      /legalEntityId is required/,
    );

    const selected = await resolveComplianceLegalEntity({
      organizationId: organization.id,
      legalEntityId: second.id,
    });
    assert.equal(selected.id, second.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organization.id));
  }
});
