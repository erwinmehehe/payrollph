/**
 * Golden payroll certification, Phase 12: prior-employer evidence in the year-end settlement.
 * Part A runs the real annualizeWithPrior() on hand-derived cases. Part B runs the real parsePriorEvidence() on valid and
 * invalid evidence. Part C runs the real payroll engine for a mid-year-hire year, saves and approves evidence through the
 * real priorIntake() with a maker and a different checker, and settles with the real runYearEndAnnualization(). Part D
 * certifies the controls (no evidence, unapproved, self-approval, stale digest, tampered scope, flag off). Every expected value
 * is an immutable literal in certification/golden-payroll-phase12.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  employeePayProfiles, employees, organizations, payrollEntries, payrollRuns, userOrganizations, users, yearEndAdjustments, yearEndPriorEvidence,
} from "../src/db/schema";
import { annualize, type AnnualizationInput } from "../src/lib/annualization";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { runYearEndAnnualization } from "../src/lib/year-end";
import { annualizeWithPrior, parsePriorEvidence, type PriorEvidence, type PriorScope } from "../src/lib/year-end-prior-evidence";
import { priorIntake } from "../src/lib/year-end-prior-evidence-server";

type Money = Record<string, number | string>;
type Evidence = Record<string, string>;
type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  evidenceBase: Evidence;
  noneConfirmed: Evidence;
  presentYearInput: AnnualizationInput;
  annualizeWithPrior: Record<string, { description: string; evidence: Evidence | "noneConfirmed"; presentOverride?: Partial<AnnualizationInput>; expected?: Money; expectedError?: string }>;
  parseEvidence: {
    scope: PriorScope;
    cases: Record<string, { description: string; scope?: Partial<PriorScope>; evidence: Evidence | "noneConfirmed"; expected?: Money; expectedError?: string }>;
  };
  engine: {
    employees: Record<string, { description: string; monthlySalary: number; startCutoff: number; evidence: Evidence | "noneConfirmed"; yearEnd: Money }>;
    controls: { description: string; monthlySalary: number; startCutoff: number; flagOffYearEnd: Money };
  };
  limitations: string[];
};
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };
type Entry = typeof payrollEntries.$inferSelect;

const catalogPath = "certification/golden-payroll-phase12.json";
const artifactPath = "qa-artifacts/golden-payroll-phase12-reconciliation.json";
const TAX_YEAR = 2026;
const FLAG = "YEAR_END_PRIOR_EVIDENCE_ENABLED";
// 2026 is not a leap year.
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const cents = (value: number, label: string) => {
  assert.ok(Number.isFinite(value), `${label}: non-finite amount`);
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), `${label}: unsafe centavo amount`);
  return result;
};

/** Compares numbers to the centavo and strings exactly; returns human-readable failures. */
function compare(id: string, expected: Money, actual: Record<string, unknown>) {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(key in actual, `${id}: unknown expected key ${key}`);
    const got = actual[key];
    if (typeof value === "string") {
      if (got !== value) failures.push(`${id} ${key}: expected ${value}, got ${String(got)}`);
    } else if (!Number.isFinite(Number(got)) || cents(Number(got), id) !== cents(value, id)) {
      failures.push(`${id} ${key}: expected ₱${value.toFixed(2)}, got ₱${Number(got).toFixed(2)}`);
    }
  }
  return failures;
}

function cutoffPeriod(cutoff: number) {
  assert.ok(cutoff >= 1 && cutoff <= 24, "cutoff must be 1-24");
  const month = Math.ceil(cutoff / 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  const firstHalf = cutoff % 2 === 1;
  const periodStart = `${TAX_YEAR}-${pad(month)}-${firstHalf ? "01" : "16"}`;
  const periodEnd = `${TAX_YEAR}-${pad(month)}-${firstHalf ? "15" : pad(MONTH_END[month - 1])}`;
  return { periodStart, periodEnd, payDate: periodEnd, label: `Phase 12 cutoff ${cutoff}` };
}

const evidenceOf = (catalog: Catalog, spec: Evidence | "noneConfirmed"): Evidence =>
  spec === "noneConfirmed" ? { ...catalog.noneConfirmed } : { ...catalog.evidenceBase, ...spec };
const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function runPureCases(catalog: Catalog) {
  const results: CaseResult[] = [];
  for (const [id, spec] of Object.entries(catalog.annualizeWithPrior)) {
    const failures: string[] = [];
    let actual: unknown;
    try {
      const present = annualize({ ...catalog.presentYearInput, ...spec.presentOverride });
      const evidence = evidenceOf(catalog, spec.evidence) as unknown as PriorEvidence;
      const result = annualizeWithPrior(present, evidence, TAX_YEAR);
      actual = result;
      if (spec.expectedError) failures.push(`${id}: expected ${spec.expectedError}, but the calculation succeeded`);
      else failures.push(...compare(id, spec.expected!, result as unknown as Record<string, unknown>));
    } catch (error) {
      actual = errorText(error);
      if (!spec.expectedError) failures.push(`${id}: unexpected error ${errorText(error)}`);
      else if (errorText(error) !== spec.expectedError) failures.push(`${id}: expected ${spec.expectedError}, got ${errorText(error)}`);
    }
    results.push(outcome(id, "annualizeWithPrior", spec.expected ?? spec.expectedError, actual, failures));
  }
  for (const [id, spec] of Object.entries(catalog.parseEvidence.cases)) {
    const failures: string[] = [];
    let actual: unknown;
    try {
      const scope = { ...catalog.parseEvidence.scope, ...spec.scope };
      const parsed = parsePriorEvidence(evidenceOf(catalog, spec.evidence), scope);
      actual = parsed;
      if (spec.expectedError) failures.push(`${id}: expected ${spec.expectedError}, but the evidence was accepted`);
      else failures.push(...compare(id, spec.expected!, parsed as unknown as Record<string, unknown>));
    } catch (error) {
      actual = errorText(error);
      if (!spec.expectedError) failures.push(`${id}: unexpected error ${errorText(error)}`);
      else if (errorText(error) !== spec.expectedError) failures.push(`${id}: expected ${spec.expectedError}, got ${errorText(error)}`);
    }
    results.push(outcome(id, "parseEvidence", spec.expected ?? spec.expectedError, actual, failures));
  }
  return results;
}

async function newUser(label: string) {
  const [user] = await db.insert(users).values({
    name: `Golden P12 ${label}`, email: `golden-p12-${label}-${randomBytes(6).toString("hex")}@example.invalid`, passwordHash: "not-login",
  }).returning();
  return user;
}

async function hire(orgId: number, id: string, monthlySalary: number, startDate: string) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P12-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: monthlySalary.toFixed(2), mwe: false, region: "NCR", startDate,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: monthlySalary.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

async function runCutoff(orgId: number, cutoff: number, expectedEntries: number) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.payDate,
  }).returning();
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows: Entry[] = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, expectedEntries, `cutoff ${cutoff}: expected ${expectedEntries} payroll entries, got ${rows.length}`);
  // The year-end annualization reads Released runs; the release approval workflow is not part of this certification.
  await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
}

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  try { await promise; } catch (error) { return pattern.test(errorText(error)) ? null : `expected ${pattern}, got ${errorText(error)}`; }
  return `expected ${pattern}, but the call succeeded`;
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.engine.employees);
  const previousFlag = process.env[FLAG];
  const [org] = await db.insert(organizations).values({ name: "Golden P12 prior evidence", legalName: "Golden P12 prior evidence Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const [controlOrg] = await db.insert(organizations).values({ name: "Golden P12 controls", legalName: "Golden P12 controls Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const orgIds = [org.id, controlOrg.id];
  const userIds: number[] = [];
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  try {
    const maker = await newUser("maker"), checker = await newUser("checker");
    userIds.push(maker.id, checker.id);
    for (const orgId of orgIds) {
      for (const user of [maker, checker]) await db.insert(userOrganizations).values({ userId: user.id, organizationId: orgId, role: "owner", active: true });
    }
    const makerActor = { id: maker.id, name: maker.name }, checkerActor = { id: checker.id, name: checker.name };

    // ---- Part C: a mid-year-hire year for six workers in one employer.
    const workers = new Map<string, typeof employees.$inferSelect>();
    for (const [id, spec] of specs) if (spec.startCutoff === 1) workers.set(id, await hire(org.id, id, spec.monthlySalary, `${TAX_YEAR}-01-01`));
    for (let cutoff = 1; cutoff <= 24; cutoff++) {
      for (const [id, spec] of specs) if (spec.startCutoff === cutoff && cutoff > 1) workers.set(id, await hire(org.id, id, spec.monthlySalary, cutoffPeriod(cutoff).periodStart));
      await runCutoff(org.id, cutoff, specs.filter(([, s]) => s.startCutoff <= cutoff).length);
    }

    process.env[FLAG] = "true";
    const digests = new Map<string, string>();
    for (const [id, spec] of specs) {
      const scope = { organizationId: org.id, employeeId: workers.get(id)!.id, taxYear: TAX_YEAR };
      await priorIntake(scope, makerActor, { action: "save", evidence: evidenceOf(catalog, spec.evidence), expectedDigest: "" });
      const record = await priorIntake(scope, makerActor) as { digest: string; approved: boolean; revision: number };
      if (record.approved) fail(id, "freshly saved evidence must not be approved");
      if (record.revision !== 1) fail(id, `first save must be revision 1, got ${record.revision}`);
      const selfApproval = await rejects(priorIntake(scope, makerActor, { action: "approve", expectedDigest: record.digest }), /PRIOR_INDEPENDENT_CHECKER_REQUIRED/);
      if (selfApproval) fail(id, "maker approving own evidence: " + selfApproval);
      await priorIntake(scope, checkerActor, { action: "approve", expectedDigest: record.digest });
      digests.set(id, record.digest);
      const [stored] = await db.select().from(yearEndPriorEvidence).where(and(eq(yearEndPriorEvidence.organizationId, org.id), eq(yearEndPriorEvidence.employeeId, scope.employeeId)));
      if (!stored?.approvedAt || stored.checkerUserId !== checker.id || stored.makerUserId !== maker.id) fail(id, "approval must record the maker and the different checker");
      if (!stored?.encryptedEvidence.startsWith("enc:govid:v1:") || stored.encryptedEvidence.includes("123456789")) fail(id, "evidence must be stored encrypted");
    }

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase12");
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
        taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
      };
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
      const breakdown = row.breakdown as { priorEvidence?: { digest?: string; revision?: number } } | null;
      if (breakdown?.priorEvidence?.digest !== digests.get(id)) fail(id, "the settlement must record the digest of the approved evidence it used");
    }
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      results.push(outcome(id, "engine", spec.yearEnd, row ? { taxDue: Number(row.taxDue), taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome } : undefined, failuresById.get(id) ?? []));
    }

    // ---- Part D: controls, each in a fresh single-worker employer so a refusal cannot hide behind another worker.
    const control = catalog.engine.controls;
    const controlFailures: string[] = [];
    const check = (message: string | null, label: string) => { if (message) controlFailures.push(`${label}: ${message}`); };
    const worker = await hire(controlOrg.id, "controls", control.monthlySalary, cutoffPeriod(control.startCutoff).periodStart);
    await runCutoff(controlOrg.id, control.startCutoff, 1);
    const scope = { organizationId: controlOrg.id, employeeId: worker.id, taxYear: TAX_YEAR };
    const evidence = evidenceOf(catalog, {});
    const settledRows = async () => (await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, controlOrg.id))).length;

    check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase12"), /PRIOR_APPROVED_EVIDENCE_REQUIRED/), "no evidence at all blocks settlement");
    if (await settledRows() !== 0) controlFailures.push("a blocked settlement must leave no adjustment rows");

    await priorIntake(scope, makerActor, { action: "save", evidence, expectedDigest: "" });
    check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase12"), /PRIOR_APPROVED_EVIDENCE_REQUIRED/), "saved but unapproved evidence blocks settlement");
    if (await settledRows() !== 0) controlFailures.push("an unapproved settlement must leave no adjustment rows");
    check(await rejects(priorIntake(scope, makerActor, { action: "approve", expectedDigest: "0".repeat(64) }), /PRIOR_SOURCE_CHANGED|PRIOR_INDEPENDENT_CHECKER_REQUIRED/), "approval with a stale digest or by the maker");
    check(await rejects(priorIntake(scope, checkerActor, { action: "approve", expectedDigest: "0".repeat(64) }), /PRIOR_SOURCE_CHANGED/), "a checker approving a digest that is not the saved evidence");
    check(await rejects(priorIntake(scope, makerActor, { action: "save", evidence: { ...evidence, taxWithheld: "1.00" }, expectedDigest: "stale" }), /PRIOR_SOURCE_CHANGED/), "saving over a revision the maker has not seen");

    const saved = await priorIntake(scope, makerActor) as { digest: string };
    await priorIntake(scope, checkerActor, { action: "approve", expectedDigest: saved.digest });
    // The approved fingerprint covers the employee's start date: changing it after approval invalidates the evidence.
    // A later hire date still passes the sequential-employment check, so only the approved fingerprint can catch it.
    await db.update(employees).set({ startDate: "2026-07-16" }).where(eq(employees.id, worker.id));
    check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase12"), /PRIOR_SOURCE_CHANGED/), "evidence approved for another (later) hire date blocks settlement by its fingerprint");
    // An earlier hire date overlaps the previous employer's period, which the evidence validation itself refuses.
    await db.update(employees).set({ startDate: "2026-06-01" }).where(eq(employees.id, worker.id));
    check(await rejects(runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase12"), /PRIOR_SOURCE_CHANGED|PRIOR_SEQUENTIAL_EMPLOYMENT_REQUIRED/), "evidence approved for a hire date inside the previous employment blocks settlement");
    if (await settledRows() !== 0) controlFailures.push("a tampered-scope settlement must leave no adjustment rows");
    await db.update(employees).set({ startDate: cutoffPeriod(control.startCutoff).periodStart }).where(eq(employees.id, worker.id));

    // With the flag off the evidence is ignored: the single-employer result, and intake is closed.
    delete process.env[FLAG];
    check(await rejects(priorIntake(scope, makerActor), /PRIOR_DISABLED/), "intake is closed while the flag is off");
    await runYearEndAnnualization(controlOrg.id, TAX_YEAR, "golden-phase12");
    const [flagOffRow] = await db.select().from(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, controlOrg.id));
    if (!flagOffRow) controlFailures.push("flag-off settlement produced no adjustment row");
    else {
      for (const message of compare("flag-off year-end", control.flagOffYearEnd, {
        grossCompensation: Number(flagOffRow.grossCompensation), thirteenthMonth: Number(flagOffRow.thirteenthMonth), nonTaxable: Number(flagOffRow.nonTaxable),
        statutoryContributions: Number(flagOffRow.statutoryContributions), taxableIncome: Number(flagOffRow.taxableIncome), taxDue: Number(flagOffRow.taxDue),
        taxWithheld: Number(flagOffRow.taxWithheld), adjustment: Number(flagOffRow.adjustment), outcome: flagOffRow.outcome,
      })) controlFailures.push(message);
      const breakdown = flagOffRow.breakdown as { priorEvidence?: unknown } | null;
      if (breakdown && "priorEvidence" in breakdown) controlFailures.push("a flag-off settlement must not carry prior-evidence metadata");
    }
    results.push(outcome("controls", "controls", control.flagOffYearEnd, flagOffRow ? { taxDue: Number(flagOffRow.taxDue), adjustment: Number(flagOffRow.adjustment) } : undefined, controlFailures));
  } finally {
    if (previousFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = previousFlag;
    for (const orgId of orgIds) {
      await db.delete(yearEndPriorEvidence).where(eq(yearEndPriorEvidence.organizationId, orgId));
      await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    for (const userId of userIds) {
      await db.delete(userOrganizations).where(eq(userOrganizations.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
  return results;
}

async function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 12 compares exact centavos");
  const results: CaseResult[] = [...runPureCases(catalog)];
  try {
    results.push(...await runEngine(catalog));
  } catch (error) {
    results.push({ id: "engine", part: "engine", status: "failed", expected: {}, actual: undefined, failures: [errorText(error)] });
  }
  const failed = results.filter((r) => r.status === "failed");
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    version: catalog.version,
    catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failed.length ? "failed" : "passed",
    caseCount: results.length,
    sources: catalog.sources,
    assumptions: catalog.assumptions,
    results,
    limitations: catalog.limitations,
  }, null, 2) + "\n");
  for (const r of failed) console.error(`FAILED ${r.id}\n  ${r.failures.join("\n  ")}`);
  console.log(JSON.stringify({ status: failed.length ? "failed" : "passed", caseCount: results.length, failed: failed.map((r) => r.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().finally(() => pool.end());
