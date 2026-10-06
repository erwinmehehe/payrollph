import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import {
  employeePayProfiles,
  employees,
  organizations,
  payrollEntries,
  payrollRuns,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";
import { generateJournalCsv } from "../src/lib/exporters";

type Expected = {
  grossPay: number;
  sss: number;
  philHealth: number;
  pagIbig: number;
  taxableCompensation: number;
  withholdingTax: number;
  deductions: number;
  netPay: number;
  sssEmployer: number;
  ecEmployer: number;
  philHealthEmployer: number;
  pagIbigEmployer: number;
};

type Scenario = {
  id: string;
  monthlySalary: number;
  expected: Expected;
};

type Catalog = {
  version: string;
  description: string;
  period: {
    start: string;
    end: string;
    payDate: string;
    statutoryDeductionTiming: string;
  };
  assumptions: string[];
  sources: Record<string, string>;
  scenarios: Scenario[];
  expectedJournal: Record<string, number>;
};

type PayrollLine = { code?: string; amount?: string | number; label?: string };

const catalogPath = "certification/golden-payroll-phase2a.json";
const artifactPath = "qa-artifacts/golden-payroll-phase2a-reconciliation.json";
const tolerance = 0.01;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertMoney(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(round2(actual) - round2(expected)) <= tolerance,
    `${label}: expected ₱${expected.toFixed(2)}, got ₱${actual.toFixed(2)}`,
  );
}

function lines(entry: typeof payrollEntries.$inferSelect) {
  return Array.isArray(entry.lineItems) ? entry.lineItems as PayrollLine[] : [];
}

function lineAmount(entry: typeof payrollEntries.$inferSelect, code: string) {
  const line = lines(entry).find((item) => String(item.code ?? "").toUpperCase() === code.toUpperCase());
  return line ? Math.abs(Number(line.amount ?? 0)) : 0;
}

function traceNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return null;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return null;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  if (typeof raw !== "string") return null;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) ? value : null;
}

function parseCsvRow(row: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '"') {
      if (quoted && row[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function journalTotals(body: string) {
  const rows = body.trim().split("\n").slice(1).map(parseCsvRow);
  return rows.reduce(
    (sum, row) => ({
      debit: round2(sum.debit + Number(row[3] || 0)),
      credit: round2(sum.credit + Number(row[4] || 0)),
    }),
    { debit: 0, credit: 0 },
  );
}

async function main() {
  mkdirSync("qa-artifacts", { recursive: true });
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Catalog;
  assert.equal(catalog.scenarios.length, 50, "Phase 2A must retain exactly 50 employee-level golden scenarios.");

  const catalogSha256 = createHash("sha256")
    .update(readFileSync(catalogPath))
    .digest("hex");

  let organizationId: number | null = null;
  try {
    const [org] = await db.insert(organizations).values({
      name: "Golden Payroll Phase 2A",
      legalName: "Golden Payroll Phase 2A Inc.",
      plan: "Core",
      statutoryDeductionTiming: "split",
    }).returning();
    organizationId = org.id;

    const createdEmployees = await db.insert(employees).values(
      catalog.scenarios.map((scenario) => ({
        organizationId: org.id,
        employeeNo: scenario.id,
        firstName: "Golden",
        lastName: scenario.id,
        title: "Certification Employee",
        avatarInitials: "GP",
        basicRate: scenario.monthlySalary.toFixed(2),
        mwe: false,
        region: "NCR",
        startDate: "2026-01-01",
      })),
    ).returning();

    assert.equal(createdEmployees.length, catalog.scenarios.length);

    await db.insert(employeePayProfiles).values(
      createdEmployees.map((employee) => ({
        employeeId: employee.id,
        organizationId: org.id,
        payBasis: "monthly",
        rateAmount: employee.basicRate,
        standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      })),
    );

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Golden Phase 2A · Sep 1–15, 2026",
      periodStart: catalog.period.start,
      periodEnd: catalog.period.end,
      scopeLabel: "All locations",
      status: "Draft",
      payDate: catalog.period.payDate,
    }).returning();

    await enqueuePayrollRun(run.id, 25);
    await drainPayrollQueue(10, run.id);

    const rows = await db.select({
      entry: payrollEntries,
      employeeNo: employees.employeeNo,
    })
      .from(payrollEntries)
      .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
      .where(eq(payrollEntries.payrollRunId, run.id));

    assert.equal(rows.length, catalog.scenarios.length, "Every golden employee must produce exactly one payroll entry.");

    const entryByEmployeeNo = new Map(rows.map((row) => [row.employeeNo, row.entry]));
    const reconciliations = catalog.scenarios.map((scenario) => {
      const entry = entryByEmployeeNo.get(scenario.id);
      assert.ok(entry, `Missing payroll entry for ${scenario.id}`);
      const expected = scenario.expected;
      const taxableCompensation = traceNumber(entry.trace, "taxableCompensation");
      const sssEmployer = traceNumber(entry.trace, "sssEmployerCutoff");
      const ecEmployer = traceNumber(entry.trace, "sssEmployerEcCutoff");
      const philHealthEmployer = traceNumber(entry.trace, "philHealthEmployerCutoff");
      const pagIbigEmployer = traceNumber(entry.trace, "pagIbigEmployerCutoff");

      const actual = {
        grossPay: Number(entry.grossPay),
        basic: Number(lines(entry).find((item) => item.code === "BASIC")?.amount ?? 0),
        sss: lineAmount(entry, "SSS"),
        philHealth: lineAmount(entry, "PHIC"),
        pagIbig: lineAmount(entry, "HDMF"),
        taxableCompensation: taxableCompensation ?? Number.NaN,
        withholdingTax: lineAmount(entry, "WHT"),
        deductions: Number(entry.deductions),
        netPay: Number(entry.netPay),
        sssEmployer: sssEmployer ?? Number.NaN,
        ecEmployer: ecEmployer ?? Number.NaN,
        philHealthEmployer: philHealthEmployer ?? Number.NaN,
        pagIbigEmployer: pagIbigEmployer ?? Number.NaN,
        status: entry.status,
      };

      assertMoney(actual.grossPay, expected.grossPay, `${scenario.id} gross pay`);
      assertMoney(actual.basic, expected.grossPay, `${scenario.id} basic line`);
      assertMoney(actual.sss, expected.sss, `${scenario.id} SSS employee`);
      assertMoney(actual.philHealth, expected.philHealth, `${scenario.id} PhilHealth employee`);
      assertMoney(actual.pagIbig, expected.pagIbig, `${scenario.id} Pag-IBIG employee`);
      assertMoney(actual.taxableCompensation, expected.taxableCompensation, `${scenario.id} taxable compensation`);
      assertMoney(actual.withholdingTax, expected.withholdingTax, `${scenario.id} withholding tax`);
      assertMoney(actual.deductions, expected.deductions, `${scenario.id} deductions`);
      assertMoney(actual.netPay, expected.netPay, `${scenario.id} net pay`);
      assertMoney(actual.sssEmployer, expected.sssEmployer, `${scenario.id} SSS employer`);
      assertMoney(actual.ecEmployer, expected.ecEmployer, `${scenario.id} EC employer`);
      assertMoney(actual.philHealthEmployer, expected.philHealthEmployer, `${scenario.id} PhilHealth employer`);
      assertMoney(actual.pagIbigEmployer, expected.pagIbigEmployer, `${scenario.id} Pag-IBIG employer`);
      assert.equal(actual.status, "Ready", `${scenario.id} should have no payroll exception`);

      return {
        id: scenario.id,
        monthlySalary: scenario.monthlySalary,
        expected,
        actual,
        passed: true,
      };
    });

    const [finishedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.ok(finishedRun);
    assert.equal(finishedRun.employeeCount, 50);
    assertMoney(Number(finishedRun.grossPay), catalog.expectedJournal.gross, "Payroll run gross");
    assertMoney(Number(finishedRun.netPay), catalog.expectedJournal.netPayroll, "Payroll run net");
    assert.equal(finishedRun.exceptions, 0, "Golden baseline run must contain no engine exceptions.");

    const journal = await generateJournalCsv(run.id);
    const totals = journalTotals(journal.body);

    assertMoney(journal.summary.sss, catalog.expectedJournal.sss, "GL SSS liability");
    assertMoney(journal.summary.philHealth, catalog.expectedJournal.philHealth, "GL PhilHealth liability");
    assertMoney(journal.summary.pagIbig, catalog.expectedJournal.pagIbig, "GL Pag-IBIG liability");
    assertMoney(journal.summary.birWithholding, catalog.expectedJournal.birWithholding, "GL BIR withholding");
    assertMoney(
      journal.summary.totalStatutoryLiabilities,
      catalog.expectedJournal.totalStatutoryLiabilities,
      "GL total statutory liabilities",
    );
    assertMoney(journal.summary.netPayroll, catalog.expectedJournal.netPayroll, "GL net payroll");
    assertMoney(
      journal.summary.employerStatutoryExpense,
      catalog.expectedJournal.employerStatutoryExpense,
      "GL employer statutory expense",
    );
    assertMoney(totals.debit, catalog.expectedJournal.debitTotal, "GL debit total");
    assertMoney(totals.credit, catalog.expectedJournal.creditTotal, "GL credit total");
    assertMoney(totals.debit, totals.credit, "GL debit/credit balance");

    const report = {
      generatedAt: new Date().toISOString(),
      status: "passed",
      phase: "2A",
      catalogVersion: catalog.version,
      catalogSha256,
      employeeScenarioCount: reconciliations.length,
      tolerancePeso: tolerance,
      period: catalog.period,
      independence:
        "Expected values are immutable literals in certification/golden-payroll-phase2a.json. The reconciliation script does not import PayrollPH statutory calculators to generate expectations.",
      sources: catalog.sources,
      assumptions: catalog.assumptions,
      run: {
        payrollRunId: run.id,
        grossPay: Number(finishedRun.grossPay),
        netPay: Number(finishedRun.netPay),
        exceptions: finishedRun.exceptions,
      },
      journal: {
        summary: journal.summary,
        debitTotal: totals.debit,
        creditTotal: totals.credit,
        sha256: createHash("sha256").update(journal.body).digest("hex"),
      },
      reconciliations,
      limitations: [
        "Phase 2A proves 50 monthly-salaried employee gross-to-net and GL cases across statutory/tax ranges.",
        "Complex lifecycle cases (90k benefit-pool crossing, hire/separation, retro, leave, loans, holiday/rest-day/OT/NSD) are tracked separately in Phase 2B.",
        "Passing engineering reconciliation is not CPA/payroll-practitioner sign-off and does not replace real parallel payroll, government acceptance, or bank UAT evidence.",
      ],
    };

    writeFileSync(artifactPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      status: report.status,
      employeeScenarioCount: report.employeeScenarioCount,
      catalogSha256,
      grossPay: report.run.grossPay,
      netPay: report.run.netPay,
      journalDebit: totals.debit,
      journalCredit: totals.credit,
    }, null, 2));
  } finally {
    if (organizationId != null) {
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  }
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
