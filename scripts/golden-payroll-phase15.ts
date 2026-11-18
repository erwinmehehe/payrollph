/**
 * Golden payroll certification, Phase 15: withholding and review holds in the CALCULATED cutoffs of a provider-switch year.
 * Phase 14 certified the year-end settlement. This phase runs the real engine for cutoffs 13-24 after six imported months and
 * checks, per cutoff, the withholding on the payslip, the run status and the review flags, then that the real
 * runYearEndAnnualization() closes the year exactly (tax due - everything withheld). Every expected value is an immutable
 * hand-derived literal in certification/golden-payroll-phase15.json and is never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {execFileSync} from "node:child_process";
import { and, eq } from "drizzle-orm";
import { deMinimisGrants, employeePayProfiles, employees, historicalPayrollEntries, organizations, payrollEntries, payrollRuns, yearEndAdjustments } from "../src/db/schema";
import {requirePhase15Environment,requirePhase15Database,PHASE15_OFF,type Phase15Mode} from "./qa/golden-phase15-safety";
import {phase15Centavos,phase15CutoffFailures,type Phase15Observation} from "./qa/golden-phase15-observations";

let db: typeof import("../src/db").db;
let pool: typeof import("../src/db").pool;
let drainPayrollQueue: typeof import("../src/lib/payroll-engine").drainPayrollQueue;
let enqueuePayrollRun: typeof import("../src/lib/payroll-engine").enqueuePayrollRun;
let runYearEndAnnualization: typeof import("../src/lib/year-end").runYearEndAnnualization;
const executedRunIds:number[]=[];

type Money = Record<string, number | string>;
type ImportedRow = {
  grossPay: number; basicSalary: number; netPay: number; taxWithheld: number;
  sssEmployee: number; philHealthEmployee: number; pagIbigEmployee: number; thirteenthMonth: number;
  deMinimisBreakdown?: Record<string, number>;
};
type Spec = {
  description: string; imported: ImportedRow;
  grant: { benefitType: string; amount: number; frequency: string; effectiveOn: string } | null;
  cutoffs: { withholdingEachCutoff: number; withholdingOverrides?: Record<string, number>; status: string; noBreakdownFlagFrom: number | null; poolFlagFrom: number | null };
  yearEnd: Money;
};
type Catalog = { version: string; toleranceCentavos: number; sources: Record<string, string>; assumptions: string[]; employees: Record<string, Spec>; limitations: string[] };
type CaseResult = { id: string; part: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] };
type CutoffObservation = Phase15Observation & {runId:number;entryId:number;employeeId:number;payDate:string};

const catalogPath = "certification/golden-payroll-phase15.json";
const artifactPath = "qa-artifacts/golden-payroll-phase15-reconciliation.json";
const TAX_YEAR = 2026;
const SOURCE_SYSTEM = "golden-phase15-previous-provider";
const MONTHLY_SALARY = 30000;
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const NO_BREAKDOWN_FLAG = "has no de minimis category breakdown";
const POOL_FLAG = "does not identify the shared PHP 90,000";

const cents=phase15Centavos;

async function assertNoRails() {
  const {rows:[counts]}=await pool.query(`SELECT
    (SELECT count(*)::int FROM outbox) AS emails,
    (SELECT count(*)::int FROM payout_batches) AS batches,
    (SELECT count(*)::int FROM payout_transfers) AS transfers`);
  assert.deepEqual(counts,{emails:0,batches:0,transfers:0},"PHASE15_STOP: email or payout state appeared; preserve evidence and do not merge");
}

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
  return {
    periodStart: `${TAX_YEAR}-${pad(month)}-${firstHalf ? "01" : "16"}`,
    periodEnd: `${TAX_YEAR}-${pad(month)}-${firstHalf ? "15" : pad(MONTH_END[month - 1])}`,
    label: `Phase 15 cutoff ${cutoff}`,
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const outcome = (id: string, part: string, expected: unknown, actual: unknown, failures: string[]): CaseResult =>
  ({ id, part, status: failures.length ? "failed" : "passed", expected, actual, failures });

async function hire(orgId: number, id: string) {
  const [employee] = await db.insert(employees).values({
    organizationId: orgId, employeeNo: `P15-${id.slice(0, 12)}`, firstName: "Golden", lastName: id, title: "Certification Employee", avatarInitials: "GP",
    basicRate: MONTHLY_SALARY.toFixed(2), mwe: false, region: "NCR", startDate: `${TAX_YEAR}-01-01`,
  }).returning();
  await db.insert(employeePayProfiles).values({
    employeeId: employee.id, organizationId: orgId, payBasis: "monthly", rateAmount: MONTHLY_SALARY.toFixed(2),
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  });
  return employee;
}

/** Runs one calculated cutoff for everyone and returns what each payslip and its review state show. */
async function runCutoff(orgId: number, cutoff: number, employeeIds: Map<number, string>) {
  const period = cutoffPeriod(cutoff);
  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, periodLabel: period.label, scopeLabel: "All locations", status: "Draft",
    periodStart: period.periodStart, periodEnd: period.periodEnd, payDate: period.periodEnd,
  }).returning();
  executedRunIds.push(run.id);
  await enqueuePayrollRun(run.id, 25);
  await drainPayrollQueue(10, run.id);
  const rows = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  assert.equal(rows.length, employeeIds.size, `cutoff ${cutoff}: expected ${employeeIds.size} payroll entries, got ${rows.length}`);
  const observed = new Map<string, CutoffObservation>();
  for (const row of rows) {
    const key = employeeIds.get(row.employeeId);
    assert.ok(key, `cutoff ${cutoff}: unknown employee ${row.employeeId}`);
    const items = row.lineItems as Array<{ code?: string; amount?: string | number }>;
    // A payslip must show withholding as one deduction. Taking Math.abs()
    // would silently certify a reversed-sign tax earning or duplicate WHT.
    const whtLines = items.filter((item) => item.code === "WHT");
    assert.equal(whtLines.length, 1, `${key} cutoff ${cutoff}: expected exactly one withholding deduction`);
    const rawWht = whtLines[0].amount;
    assert.ok(rawWht !== undefined && (typeof rawWht !== "string" || rawWht.trim().length > 0),
      `${key} cutoff ${cutoff}: withholding amount missing`);
    const wht = Number(rawWht);
    assert.ok(Number.isFinite(wht) && wht <= 0,
      `${key} cutoff ${cutoff}: withholding must be a finite deduction (negative WHT line), got ${String(rawWht)}`);
    const flags = ((row.trace as { flags?: unknown })?.flags ?? []) as unknown[];
    observed.set(key, {
      runId:run.id,entryId:row.id,employeeId:row.employeeId,payDate:period.periodEnd,
      status: row.status,
      withholding: -wht,
      flags:flags.map(String),
      noBreakdownFlag: flags.some((flag) => String(flag).includes(NO_BREAKDOWN_FLAG)),
      poolFlag: flags.some((flag) => String(flag).includes(POOL_FLAG)),
    });
  }
  return observed;
}

async function runEngine(catalog: Catalog) {
  const results: CaseResult[] = [];
  const specs = Object.entries(catalog.employees);
  const [org] = await db.insert(organizations).values({ name: "Golden P15 provider-switch cutoffs", legalName: "Golden P15 provider-switch cutoffs Inc.", plan: "Core", statutoryDeductionTiming: "split" }).returning();
  const failuresById = new Map<string, string[]>();
  const fail = (id: string, message: string) => failuresById.set(id, [...(failuresById.get(id) ?? []), message]);
  const workers = new Map<string, typeof employees.$inferSelect>();
  const observed = new Map<string, Map<number, CutoffObservation>>(specs.map(([id]) => [id, new Map()]));
  const yearEnds=new Map<string,Record<string,unknown>>();
  let completed=false;
  try {
    for (const [id] of specs) workers.set(id, await hire(org.id, id));
    const idByEmployee = new Map<number, string>([...workers].map(([id, employee]) => [employee.id, id]));
    for (const [id, spec] of specs) {
      const employee = workers.get(id)!;
      for (let month = 1; month <= 6; month++) {
        const payDate = `${TAX_YEAR}-${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`;
        const row = spec.imported;
        await db.insert(historicalPayrollEntries).values({
          organizationId: org.id, employeeId: employee.id, sourceSystem: SOURCE_SYSTEM, sourceReference: `P15-${id}-${month}`, periodLabel: `Previous provider ${payDate}`, payDate,
          grossPay: row.grossPay.toFixed(2), basicSalary: row.basicSalary.toFixed(2), netPay: row.netPay.toFixed(2), taxWithheld: row.taxWithheld.toFixed(2),
          sssEmployee: row.sssEmployee.toFixed(2), philHealthEmployee: row.philHealthEmployee.toFixed(2), pagIbigEmployee: row.pagIbigEmployee.toFixed(2),
          thirteenthMonth: row.thirteenthMonth.toFixed(2), ...(row.deMinimisBreakdown ? { deMinimisBreakdown: row.deMinimisBreakdown } : {}),
        });
      }
      if (spec.grant) {
        await db.insert(deMinimisGrants).values({
          organizationId: org.id, employeeId: employee.id, benefitType: spec.grant.benefitType, amount: spec.grant.amount.toFixed(2),
          frequency: spec.grant.frequency, active: true, effectiveOn: spec.grant.effectiveOn,
        });
      }
    }
    for (let cutoff = 13; cutoff <= 24; cutoff++) {
      const perWorker = await runCutoff(org.id, cutoff, idByEmployee);
      for (const [id, seen] of perWorker) observed.get(id)!.set(cutoff, seen);
      for(const [id,spec]of specs)for(const message of phase15CutoffFailures(id,spec.cutoffs,cutoff,perWorker.get(id)!))fail(id,message);
      assert.equal(failuresById.size,0,`PHASE15_STOP: cutoff ${cutoff} differs; retain payslip/run IDs and do not merge`);
      await assertNoRails();
      // Synthetic annualization fixture ONLY, after all four observed rows pass.
      // This does not perform a human approval, disbursement or real release.
      const runId=perWorker.values().next().value!.runId;
      await db.update(payrollRuns).set({status:"Released"}).where(eq(payrollRuns.id,runId));
    }

    await runYearEndAnnualization(org.id, TAX_YEAR, "golden-phase15");
    const adjustments = await db.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, org.id), eq(yearEndAdjustments.taxYear, TAX_YEAR)));
    for (const [id, spec] of specs) {
      const row = adjustments.find((item) => item.employeeId === workers.get(id)!.id);
      if (!row) { fail(id, "no year-end adjustment row"); continue; }
      const actual = {
        grossCompensation: Number(row.grossCompensation), thirteenthMonth: Number(row.thirteenthMonth), nonTaxable: Number(row.nonTaxable),
        statutoryContributions: Number(row.statutoryContributions), taxableIncome: Number(row.taxableIncome), taxDue: Number(row.taxDue),
        taxWithheld: Number(row.taxWithheld), adjustment: Number(row.adjustment), outcome: row.outcome,
      };
      yearEnds.set(id,{...actual,adjustmentId:row.id});
      for (const message of compare(`${id} year-end`, spec.yearEnd, actual)) fail(id, message);
    }
    await assertNoRails();
    completed=failuresById.size===0;
  } catch(error) {
    const message=errorText(error);
    for(const [id]of specs)fail(id,"STOP / remaining observations NOT_RUN: "+message);
  } finally {
    for(const [id,spec]of specs){
      const cutoffs=Object.fromEntries(observed.get(id)!);
      results.push(outcome(id, "engine", { cutoffs: spec.cutoffs, yearEnd: spec.yearEnd },
        {organizationId:org.id,employeeId:workers.get(id)?.id,runIds:executedRunIds,
          cutoffs,cutoff13:observed.get(id)!.get(13),cutoff24:observed.get(id)!.get(24),
          yearEnd:yearEnds.get(id)??null,taxDue:yearEnds.get(id)?.taxDue,adjustment:yearEnds.get(id)?.adjustment,
          fictionalDatabaseRetainedForFailure:!completed},
        failuresById.get(id) ?? []));
    }
    if(completed){
      await db.delete(yearEndAdjustments).where(eq(yearEndAdjustments.organizationId, org.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  }
  return results;
}

async function requireDisposablePhase15(mode:Phase15Mode) {
  const {rows:[state]}=await pool.query(`SELECT current_setting('server_version_num')::int AS version,
    current_database() AS database, host(inet_server_addr()) AS "serverAddress", host(inet_client_addr()) AS "clientAddress",
    (SELECT count(*)::int FROM organizations) AS employers`);
  requirePhase15Database(state,mode);
  await assertNoRails();
}

async function main() {
  const mode=requirePhase15Environment(process.env);
  const sourceHead=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const sourceFiles=["scripts/golden-payroll-phase15.ts","scripts/qa/golden-phase15-safety.ts",
    "scripts/qa/golden-phase15-observations.ts","src/lib/payroll-engine.ts","src/lib/imported-benefit-prior.ts",
    "src/lib/year-end.ts","src/lib/ph-compliance.ts",catalogPath];
  execFileSync("git",["diff","--quiet","HEAD","--",...sourceFiles],{stdio:"ignore"});
  const database=await import("../src/db");db=database.db;pool=database.pool;
  await requireDisposablePhase15(mode);
  const engine=await import("../src/lib/payroll-engine");
  drainPayrollQueue=engine.drainPayrollQueue;enqueuePayrollRun=engine.enqueuePayrollRun;
  ({runYearEndAnnualization}=await import("../src/lib/year-end"));
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 15 compares exact centavos");
  const results: CaseResult[] = [];
  try {
    results.push(...await runEngine(catalog));
  } catch (error) {
    results.push({ id: "engine", part: "engine", status: "failed", expected: {}, actual: undefined, failures: [errorText(error)] });
  }
  const failed = results.filter((r) => r.status === "failed");
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    evidenceLabel:"SOLO_VERIFIED_DEV_RECOVERY",executionMode:mode,engineCheckoutSha:sourceHead,
    sourceSha256:Object.fromEntries(sourceFiles.map(file=>[file,createHash("sha256").update(readFileSync(file)).digest("hex")])),
    flags:Object.fromEntries(PHASE15_OFF.map(name=>[name,process.env[name]])),
    exactThirteenthCentavosEnabled:false,productionAccepted:false,
    version: catalog.version, catalogSha256: createHash("sha256").update(raw).digest("hex"), status: failed.length ? "failed" : "passed",
    caseCount: results.length, sources: catalog.sources, assumptions: catalog.assumptions, results, limitations: catalog.limitations,
  }, null, 2) + "\n");
  for (const r of failed) console.error(`FAILED ${r.id}\n  ${r.failures.join("\n  ")}`);
  console.log(JSON.stringify({ status: failed.length ? "failed" : "passed", caseCount: results.length, failed: failed.map((r) => r.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error=>{console.error(errorText(error));process.exitCode=1;}).finally(async()=>{if(pool)await pool.end();});
