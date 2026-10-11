import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  employeePayProfiles,
  employees,
  organizations,
  overtimeRequests,
  payPolicies,
  payPolicyRules,
  payrollEntries,
  payrollRuns,
  timePunches,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import {
  HOLIDAY_REST_DAY_PREMIUM_EVENT,
  NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
  OVERTIME_PREMIUM_EVENT,
  resolveHolidayRestDayPremium,
  resolveNightDifferentialPremium,
  resolveOvertimePremium,
  resolveWorkedTimePremium,
  WORKED_TIME_PREMIUM_EVENT,
  type PayPolicyRecord,
  type PayPolicyRuleRecord,
} from "../src/lib/pay-policy-engine";

type CatalogFamily = {
  eventType: string;
  linePrefix: string;
  direct: Record<string, unknown>;
  payroll: {
    workDate: string;
    timeIn: string;
    timeOut: string;
    shiftStart: string;
    shiftEnd: string;
    breakStart: string;
    breakEnd: string;
    restDay: string | null;
    approvedOvertimeMinutes?: number;
    expectedStatutoryLineCode: string | null;
    expectedStatutoryAmount: number;
    expectedOverlayAmount: number;
    expectedGrossDelta: number;
  };
  outcome: Record<string, unknown>;
  conditions: Record<string, unknown>;
};

type Catalog = {
  version: string;
  tolerancePeso: number;
  baseEmployee: {
    monthlySalary: number;
    standardWorkDaysPerMonth: number;
    standardHoursPerDay: number;
    hourlyRate: number;
  };
  families: CatalogFamily[];
  invariants: string[];
};

type PayrollLine = { code?: string; amount?: string | number; label?: string; notes?: string[] };

const catalogPath = "certification/golden-pay-rules-phase3.json";
const artifactPath = "qa-artifacts/golden-pay-rules-phase3-reconciliation.json";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertMoney(actual: number, expected: number, label: string, tolerance: number) {
  assert.ok(
    Math.abs(round2(actual) - round2(expected)) <= tolerance,
    `${label}: expected ₱${expected.toFixed(2)}, got ₱${actual.toFixed(2)}`,
  );
}

function lines(entry: typeof payrollEntries.$inferSelect) {
  return Array.isArray(entry.lineItems) ? entry.lineItems as PayrollLine[] : [];
}

function lineAmount(entry: typeof payrollEntries.$inferSelect, code: string) {
  return Number(lines(entry).find((line) => String(line.code ?? "") === code)?.amount ?? 0);
}

function overlayLine(entry: typeof payrollEntries.$inferSelect, prefix: string) {
  return lines(entry).filter((line) => String(line.code ?? "").startsWith(prefix));
}

function traceValue(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return null;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return null;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof raw === "string" ? raw.slice(prefix.length) : null;
}

function traceNumber(trace: unknown, key: string) {
  const value = Number(traceValue(trace, key));
  return Number.isFinite(value) ? value : Number.NaN;
}

function familyTraceKeys(eventType: string) {
  switch (eventType) {
    case WORKED_TIME_PREMIUM_EVENT:
      return {
        amount: "companyPremium",
        taxable: "companyPremiumTaxable",
        sssExcluded: "companyPremiumExcludedFromSssBase",
        pagIbigExcluded: "companyPremiumExcludedFromPagIbigBase",
        appliedRules: "companyPremiumAppliedRules",
      };
    case HOLIDAY_REST_DAY_PREMIUM_EVENT:
      return {
        amount: "holidayRestDayPremium",
        taxable: "holidayRestDayPremiumTaxable",
        sssExcluded: "holidayRestDayPremiumExcludedFromSssBase",
        pagIbigExcluded: "holidayRestDayPremiumExcludedFromPagIbigBase",
        appliedRules: "holidayRestDayPremiumAppliedRules",
      };
    case OVERTIME_PREMIUM_EVENT:
      return {
        amount: "overtimePremium",
        taxable: "overtimePremiumTaxable",
        sssExcluded: "overtimePremiumExcludedFromSssBase",
        pagIbigExcluded: "overtimePremiumExcludedFromPagIbigBase",
        appliedRules: "overtimePremiumAppliedRules",
      };
    case NIGHT_DIFFERENTIAL_PREMIUM_EVENT:
      return {
        amount: "nightDifferentialPremium",
        taxable: "nightDifferentialPremiumTaxable",
        sssExcluded: "nightDifferentialPremiumExcludedFromSssBase",
        pagIbigExcluded: "nightDifferentialPremiumExcludedFromPagIbigBase",
        appliedRules: "nightDifferentialPremiumAppliedRules",
      };
    default:
      throw new Error(`Unknown premium family ${eventType}`);
  }
}

function directPolicy(eventType: string): PayPolicyRecord {
  return {
    id: 1,
    organizationId: 7,
    code: `GOLDEN-${eventType.toUpperCase()}`,
    name: `Golden ${eventType}`,
    policyKind: "cba",
    version: "CERT-2026.10",
    scopeType: "employee",
    scopeOrgUnitId: null,
    scopeEmployeeId: 42,
    priority: 500,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    active: true,
    approvedAt: "2026-01-01T00:00:00Z",
  };
}

function directRule(family: CatalogFamily): PayPolicyRuleRecord {
  return {
    id: 1,
    policyId: 1,
    ruleKey: `GOLDEN-${family.eventType.toUpperCase()}`,
    eventType: family.eventType,
    conditions: family.conditions,
    outcome: family.outcome,
    priority: 500,
    statutoryFloorProtected: true,
    enabled: true,
  };
}

function runDirectGolden(family: CatalogFamily, tolerance: number) {
  const policy = directPolicy(family.eventType);
  const rule = directRule(family);
  const d = family.direct as Record<string, any>;
  const common = {
    organizationId: 7,
    employeeId: 42,
    orgUnitIds: [],
    workDate: family.payroll.workDate,
    minutes: Number(d.minutes),
    hourlyRate: Number(d.hourlyRate),
    shiftCode: null,
    worksiteId: null,
    policies: [policy],
    rules: [rule],
  };

  let result:
    | ReturnType<typeof resolveWorkedTimePremium>
    | ReturnType<typeof resolveHolidayRestDayPremium>
    | ReturnType<typeof resolveOvertimePremium>
    | ReturnType<typeof resolveNightDifferentialPremium>;

  if (family.eventType === WORKED_TIME_PREMIUM_EVENT) {
    result = resolveWorkedTimePremium(common);
  } else if (family.eventType === HOLIDAY_REST_DAY_PREMIUM_EVENT) {
    result = resolveHolidayRestDayPremium({
      ...common,
      holidayType: d.holidayType,
      restDay: d.restDay,
      statutoryMultiplier: d.statutoryMultiplier,
    });
  } else if (family.eventType === OVERTIME_PREMIUM_EVENT) {
    result = resolveOvertimePremium({
      ...common,
      holidayType: d.holidayType,
      restDay: d.restDay,
      statutoryMultiplier: d.statutoryMultiplier,
    });
  } else if (family.eventType === NIGHT_DIFFERENTIAL_PREMIUM_EVENT) {
    result = resolveNightDifferentialPremium({
      ...common,
      holidayType: d.holidayType,
      restDay: d.restDay,
      overtime: d.overtime,
      statutoryMultiplier: d.statutoryMultiplier,
    });
  } else {
    throw new Error(`Unsupported pay-rule golden family ${family.eventType}`);
  }

  assert.equal(result.statutoryFloorMode, "additive-only");
  assert.equal(result.applied.length, 1);
  assertMoney(result.amount, Number(d.expectedAmount), `${family.eventType} direct amount`, tolerance);
  assertMoney(result.taxableAmount, Number(d.expectedTaxableAmount), `${family.eventType} direct taxable`, tolerance);
  assertMoney(result.sssIncludedAmount, Number(d.expectedSssIncludedAmount), `${family.eventType} direct SSS base`, tolerance);
  assertMoney(result.pagIbigIncludedAmount, Number(d.expectedPagIbigIncludedAmount), `${family.eventType} direct Pag-IBIG base`, tolerance);

  if (family.eventType === OVERTIME_PREMIUM_EVENT) {
    assert.equal((result as ReturnType<typeof resolveOvertimePremium>).authorizationMode, "evidence-only");
  }
  if (family.eventType === NIGHT_DIFFERENTIAL_PREMIUM_EVENT) {
    assert.equal((result as ReturnType<typeof resolveNightDifferentialPremium>).statutoryDifferentialPercent, 10);
  }

  return {
    amount: result.amount,
    taxableAmount: result.taxableAmount,
    sssIncludedAmount: result.sssIncludedAmount,
    pagIbigIncludedAmount: result.pagIbigIncludedAmount,
    statutoryFloorMode: result.statutoryFloorMode,
    appliedRuleKey: result.applied[0]?.ruleKey,
  };
}

function toManilaDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`);
}

async function runPayrollGolden(family: CatalogFamily, catalog: Catalog) {
  const [org] = await db.insert(organizations).values({
    name: `Golden Pay Rule ${family.eventType}`,
    legalName: `Golden Pay Rule ${family.eventType} Inc.`,
    plan: "Core",
    statutoryDeductionTiming: "split",
  }).returning();

  try {
    const [baseline, overlay] = await db.insert(employees).values([
      {
        organizationId: org.id,
        employeeNo: `BASE-${family.eventType.slice(0, 12)}`,
        firstName: "Golden",
        lastName: "Baseline",
        title: "Certification Employee",
        avatarInitials: "GB",
        basicRate: catalog.baseEmployee.monthlySalary.toFixed(2),
        startDate: "2026-01-01",
        restDay: family.payroll.restDay,
        region: "NCR",
      },
      {
        organizationId: org.id,
        employeeNo: `RULE-${family.eventType.slice(0, 12)}`,
        firstName: "Golden",
        lastName: "Overlay",
        title: "Certification Employee",
        avatarInitials: "GO",
        basicRate: catalog.baseEmployee.monthlySalary.toFixed(2),
        startDate: "2026-01-01",
        restDay: family.payroll.restDay,
        region: "NCR",
      },
    ]).returning();

    await db.insert(employeePayProfiles).values([baseline, overlay].map((employee) => ({
      employeeId: employee.id,
      organizationId: org.id,
      payBasis: "monthly",
      rateAmount: catalog.baseEmployee.monthlySalary.toFixed(2),
      standardWorkDaysPerMonth: catalog.baseEmployee.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: catalog.baseEmployee.standardHoursPerDay.toFixed(2),
    })));

    const [policy] = await db.insert(payPolicies).values({
      organizationId: org.id,
      code: `CERT-${family.eventType.toUpperCase()}`,
      name: `Certification ${family.eventType}`,
      policyKind: "cba",
      version: "CERT-2026.10",
      scopeType: "employee",
      scopeEmployeeId: overlay.id,
      priority: 500,
      effectiveFrom: "2026-01-01",
      active: true,
      description: "Golden certification policy",
      createdBy: "Golden certification",
      approvedBy: "Golden certification",
      approvedAt: new Date("2026-01-01T00:00:00Z"),
    }).returning();

    const [rule] = await db.insert(payPolicyRules).values({
      policyId: policy.id,
      ruleKey: `CERT-${family.eventType.toUpperCase()}`,
      eventType: family.eventType,
      conditions: family.conditions,
      outcome: family.outcome,
      priority: 500,
      statutoryFloorProtected: true,
      enabled: true,
    }).returning();

    await db.insert(timePunches).values([baseline, overlay].map((employee) => ({
      organizationId: org.id,
      employeeId: employee.id,
      workDate: family.payroll.workDate,
      timeIn: toManilaDateTime(family.payroll.workDate, family.payroll.timeIn),
      timeOut: toManilaDateTime(family.payroll.workDate, family.payroll.timeOut),
      breakStart: toManilaDateTime(family.payroll.workDate, family.payroll.breakStart),
      breakEnd: toManilaDateTime(family.payroll.workDate, family.payroll.breakEnd),
      shiftStart: family.payroll.shiftStart,
      shiftEnd: family.payroll.shiftEnd,
      status: "Complete",
    })));

    if (family.payroll.approvedOvertimeMinutes) {
      await db.insert(overtimeRequests).values([baseline, overlay].map((employee) => ({
        organizationId: org.id,
        employeeId: employee.id,
        workDate: family.payroll.workDate,
        requestedMinutes: family.payroll.approvedOvertimeMinutes!,
        reason: "Golden certification overtime",
        requestKind: "pre_approved",
        status: "approved",
        requestedBy: "Golden certification",
        decidedBy: "Golden certification",
        decidedAt: new Date(`${family.payroll.workDate}T08:00:00+08:00`),
        decisionNote: "Approved golden case",
      })));
    }

    const month = family.payroll.workDate.slice(0, 7);
    const day = Number(family.payroll.workDate.slice(8, 10));
    const periodStart = day <= 15 ? `${month}-01` : `${month}-16`;
    const periodEnd = day <= 15
      ? `${month}-15`
      : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

    // A final cutoff's statutory ledger is not a blank first half: produce
    // the earlier cutoff from the *real* payroll engine in this synthetic
    // test tenant and mark it released only for certification. M-7 correctly
    // fails closed when this prior-cutoff input is absent in production.
    if (day > 15) {
      const [prior] = await db.insert(payrollRuns).values({
        organizationId: org.id,
        periodLabel: `Golden prior cutoff ${family.eventType}`,
        periodStart: `${month}-01`,
        periodEnd: `${month}-15`,
        scopeLabel: "All locations",
        status: "Draft",
        payDate: `${month}-15`,
      }).returning();
      await enqueuePayrollRun(prior.id, 25);
      await drainPayrollQueue(10, prior.id);
      const priorEntries = await db.select()
        .from(payrollEntries).where(eq(payrollEntries.payrollRunId, prior.id));
      assert.equal(priorEntries.length, 2, "Both golden employees require earlier-cutoff ledger entries");
      assert.ok(priorEntries.every((entry) => entry.status === "Ready"),
        "Synthetic earlier-cutoff entries must be calculated without exceptions");
      await db.update(payrollRuns).set({ status: "Released" })
        .where(eq(payrollRuns.id, prior.id));
    }

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: `Golden ${family.eventType}`,
      periodStart,
      periodEnd,
      scopeLabel: "All locations",
      status: "Draft",
      payDate: periodEnd,
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 2);
    const baselineEntry = entries.find((entry) => entry.employeeId === baseline.id)!;
    const overlayEntry = entries.find((entry) => entry.employeeId === overlay.id)!;

    assert.ok(baselineEntry);
    assert.ok(overlayEntry);
    assert.equal(baselineEntry.status, "Ready", `${family.eventType} baseline should be Ready`);
    assert.equal(overlayEntry.status, "Ready", `${family.eventType} overlay should be Ready`);

    const baselineOverlayLines = overlayLine(baselineEntry, family.linePrefix);
    const overlayLines = overlayLine(overlayEntry, family.linePrefix);
    assert.equal(baselineOverlayLines.length, 0, `${family.eventType} baseline must not receive employee-scoped overlay`);
    assert.equal(overlayLines.length, 1, `${family.eventType} overlay must produce exactly one policy line`);
    assert.equal(overlayLines[0].code, `${family.linePrefix}${rule.id}`);

    assertMoney(
      Number(overlayLines[0].amount ?? 0),
      family.payroll.expectedOverlayAmount,
      `${family.eventType} payroll overlay line`,
      catalog.tolerancePeso,
    );
    assertMoney(
      Number(overlayEntry.grossPay) - Number(baselineEntry.grossPay),
      family.payroll.expectedGrossDelta,
      `${family.eventType} gross delta`,
      catalog.tolerancePeso,
    );

    assertMoney(
      lineAmount(overlayEntry, "BASIC"),
      lineAmount(baselineEntry, "BASIC"),
      `${family.eventType} basic statutory/base pay unchanged`,
      catalog.tolerancePeso,
    );

    if (family.payroll.expectedStatutoryLineCode) {
      const code = family.payroll.expectedStatutoryLineCode;
      assertMoney(
        lineAmount(baselineEntry, code),
        family.payroll.expectedStatutoryAmount,
        `${family.eventType} baseline statutory line ${code}`,
        catalog.tolerancePeso,
      );
      assertMoney(
        lineAmount(overlayEntry, code),
        family.payroll.expectedStatutoryAmount,
        `${family.eventType} overlay statutory line ${code} unchanged`,
        catalog.tolerancePeso,
      );
    }

    const traceKeys = familyTraceKeys(family.eventType);
    assertMoney(traceNumber(overlayEntry.trace, traceKeys.amount), family.payroll.expectedOverlayAmount, `${family.eventType} trace amount`, catalog.tolerancePeso);
    assertMoney(traceNumber(overlayEntry.trace, traceKeys.taxable), family.payroll.expectedOverlayAmount, `${family.eventType} trace taxable`, catalog.tolerancePeso);
    assertMoney(traceNumber(overlayEntry.trace, traceKeys.sssExcluded), 0, `${family.eventType} trace SSS excluded`, catalog.tolerancePeso);
    assertMoney(traceNumber(overlayEntry.trace, traceKeys.pagIbigExcluded), family.payroll.expectedOverlayAmount, `${family.eventType} trace Pag-IBIG excluded`, catalog.tolerancePeso);
    assertMoney(traceNumber(baselineEntry.trace, traceKeys.amount), 0, `${family.eventType} baseline trace amount`, catalog.tolerancePeso);

    const execution = overlayEntry.trace && typeof overlayEntry.trace === "object"
      ? (overlayEntry.trace as Record<string, any>).payPolicyExecution
      : null;
    assert.equal(execution?.statutoryFloorMode, "additive-only");
    assert.ok(Array.isArray(execution?.migratedRuleFamilies));
    assert.ok(execution.migratedRuleFamilies.includes(family.eventType));
    assert.ok(Array.isArray(execution?.appliedRules));

    const familyApplications = execution.appliedRules.filter(
      (item: any) => item.eventType === family.eventType,
    );
    assert.ok(familyApplications.length >= 1, `${family.eventType} must record at least one applied segment`);
    assert.equal(
      traceNumber(overlayEntry.trace, traceKeys.appliedRules),
      familyApplications.length,
      `${family.eventType} trace application count must match execution evidence`,
    );
    assert.equal(
      new Set(familyApplications.map((item: any) => item.ruleId)).size,
      1,
      `${family.eventType} golden case must resolve to exactly one unique policy rule`,
    );
    assertMoney(
      familyApplications.reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0),
      family.payroll.expectedOverlayAmount,
      `${family.eventType} applied segment total`,
      catalog.tolerancePeso,
    );

    return {
      baseline: {
        grossPay: Number(baselineEntry.grossPay),
        netPay: Number(baselineEntry.netPay),
        status: baselineEntry.status,
        statutoryLine: family.payroll.expectedStatutoryLineCode
          ? lineAmount(baselineEntry, family.payroll.expectedStatutoryLineCode)
          : null,
      },
      overlay: {
        grossPay: Number(overlayEntry.grossPay),
        netPay: Number(overlayEntry.netPay),
        status: overlayEntry.status,
        overlayLineCode: overlayLines[0].code,
        overlayAmount: Number(overlayLines[0].amount ?? 0),
        statutoryLine: family.payroll.expectedStatutoryLineCode
          ? lineAmount(overlayEntry, family.payroll.expectedStatutoryLineCode)
          : null,
        traceAmount: traceNumber(overlayEntry.trace, traceKeys.amount),
        traceTaxable: traceNumber(overlayEntry.trace, traceKeys.taxable),
        traceSssExcluded: traceNumber(overlayEntry.trace, traceKeys.sssExcluded),
        tracePagIbigExcluded: traceNumber(overlayEntry.trace, traceKeys.pagIbigExcluded),
      },
      grossDelta: round2(Number(overlayEntry.grossPay) - Number(baselineEntry.grossPay)),
      policyId: policy.id,
      ruleId: rule.id,
    };
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
}

function executablePremiumFamiliesFromSource() {
  const source = readFileSync("src/lib/pay-policy-engine.ts", "utf8");
  return [...source.matchAll(/export const [A-Z0-9_]+_PREMIUM_EVENT\s*=\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
}

async function main() {
  mkdirSync("qa-artifacts", { recursive: true });
  const rawCatalog = readFileSync(catalogPath);
  const catalog = JSON.parse(rawCatalog.toString("utf8")) as Catalog;

  const sourceFamilies = executablePremiumFamiliesFromSource();
  const catalogFamilies = catalog.families.map((family) => family.eventType).sort();
  assert.deepEqual(
    catalogFamilies,
    sourceFamilies,
    "Every executable *_PREMIUM_EVENT family must have exactly one Phase 3 golden case.",
  );
  assert.equal(new Set(catalogFamilies).size, catalogFamilies.length, "Duplicate golden pay-rule family in catalog.");

  const results: Record<string, unknown> = {};
  for (const family of catalog.families) {
    results[family.eventType] = {
      direct: runDirectGolden(family, catalog.tolerancePeso),
      payroll: await runPayrollGolden(family, catalog),
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    status: "passed",
    phase: "3-pay-rules",
    catalogVersion: catalog.version,
    catalogSha256: createHash("sha256").update(rawCatalog).digest("hex"),
    engineSourceSha256: createHash("sha256").update(readFileSync("src/lib/pay-policy-engine.ts")).digest("hex"),
    tolerancePeso: catalog.tolerancePeso,
    executableFamilies: sourceFamilies,
    certifiedFamilyCount: catalog.families.length,
    invariants: catalog.invariants,
    results,
    limitations: [
      "Engineering golden reconciliation for executable configurable premium families only.",
      "This does not convert draft/unmigrated policy ideas into executable rules.",
      "Statutory payroll remains authoritative; external practitioner sign-off and real payroll certification remain separate gates.",
    ],
  };

  writeFileSync(artifactPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    status: report.status,
    certifiedFamilyCount: report.certifiedFamilyCount,
    executableFamilies: report.executableFamilies,
    catalogSha256: report.catalogSha256,
  }, null, 2));
}

main()
  .catch((error) => {
    mkdirSync("qa-artifacts", { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        status: "failed",
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      }, null, 2),
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
