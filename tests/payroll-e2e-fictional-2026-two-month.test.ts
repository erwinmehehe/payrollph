/**
 * 2026 original-source parity review, not agency/CPA certification.
 *
 * Four fictional non-MWE employees; both cutoffs of July and September 2026.
 * Fixed integer-centavo oracles were worked from first-party SSS Circular
 * 2024-006, PhilHealth 2026 5% announcement (PIA government reporting and
 * 2025 advisory MBS rules), Pag-IBIG Circular 460, BIR Annex E 2023 onward,
 * and DOLE LA 21-26. See docs/payroll-certification/
 * 2026-ph-statutory-source-matrix.md.
 *
 * Cutoff allocation is existing Linaw software policy, not agency approval.
 * Do not use this as a signoff for odd-cent employee/employer premium sharing,
 * MWE classifications, retro remittances, employer policies or bank/agency
 * posting. Do not access Neon or live production data.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { nationalHolidayCalendarForDate } from "../src/lib/wage-orders";
import {
  computeSss, computePhilHealth, computePagIbig,
  computeSemiMonthlyWithholdingTax, computeMonthlyWithholdingTax,
} from "../src/lib/payroll-rules";
import { thirteenthMonthFromCentavos } from "../src/lib/thirteenth-month-centavos";

type Half = {
  gross: number; sss: number; phic: number; hdmf: number;
  wht: number; net: number;
  erSss: number; erEc: number; erPhic: number; erHdmf: number;
};
type Worker = {
  id: string; salary: number; msc: number;
  monthly: {
    gross: number; sss: number; erSss: number; erEc: number;
    phic: number; erPhic: number; hdmf: number; erHdmf: number;
    wht: number; net: number; employerCost: number;
  };
  first: Half; second: Half;
};

// All expected values are independent, fixed manual official-table /
// semi-monthly Annex E arithmetic, NOT results generated from PayrollPH.
const workers: readonly Worker[] = [
  {
    id: "F01", salary: 25250, msc: 25500,
    monthly: { gross: 25250, sss: 1275, erSss: 2550, erEc: 30,
      phic: 631.25, erPhic: 631.25, hdmf: 200, erHdmf: 200,
      wht: 346.46, net: 22797.29, employerCost: 28661.25 },
    first: { gross: 12625, sss: 637.5, phic: 315.63, hdmf: 100,
      wht: 173.23, net: 11398.64, erSss: 1275, erEc: 15,
      erPhic: 315.63, erHdmf: 100 },
    second: { gross: 12625, sss: 637.5, phic: 315.62, hdmf: 100,
      wht: 173.23, net: 11398.65, erSss: 1275, erEc: 15,
      erPhic: 315.62, erHdmf: 100 },
  },
  {
    id: "F02", salary: 34749.99, msc: 34500,
    monthly: { gross: 34749.99, sss: 1725, erSss: 3450, erEc: 30,
      phic: 868.75, erPhic: 868.75, hdmf: 200, erHdmf: 200,
      wht: 1668.34, net: 30287.90, employerCost: 39298.74 },
    first: { gross: 17375, sss: 862.5, phic: 434.38, hdmf: 100,
      wht: 834.17, net: 15143.95, erSss: 1725, erEc: 15,
      erPhic: 434.38, erHdmf: 100 },
    second: { gross: 17374.99, sss: 862.5, phic: 434.37, hdmf: 100,
      wht: 834.17, net: 15143.95, erSss: 1725, erEc: 15,
      erPhic: 434.37, erHdmf: 100 },
  },
  {
    id: "F03", salary: 34750, msc: 35000,
    monthly: { gross: 34750, sss: 1750, erSss: 3500, erEc: 30,
      phic: 868.75, erPhic: 868.75, hdmf: 200, erHdmf: 200,
      wht: 1664.58, net: 30266.67, employerCost: 39348.75 },
    first: { gross: 17375, sss: 875, phic: 434.38, hdmf: 100,
      wht: 832.29, net: 15133.33, erSss: 1750, erEc: 15,
      erPhic: 434.38, erHdmf: 100 },
    second: { gross: 17375, sss: 875, phic: 434.37, hdmf: 100,
      wht: 832.29, net: 15133.34, erSss: 1750, erEc: 15,
      erPhic: 434.37, erHdmf: 100 },
  },
  {
    id: "F04", salary: 100000, msc: 35000,
    monthly: { gross: 100000, sss: 1750, erSss: 3500, erEc: 30,
      phic: 2500, erPhic: 2500, hdmf: 200, erHdmf: 200,
      wht: 15762.40, net: 79787.60, employerCost: 106230 },
    first: { gross: 50000, sss: 875, phic: 1250, hdmf: 100,
      wht: 7881.20, net: 39893.80, erSss: 1750, erEc: 15,
      erPhic: 1250, erHdmf: 100 },
    second: { gross: 50000, sss: 875, phic: 1250, hdmf: 100,
      wht: 7881.20, net: 39893.80, erSss: 1750, erEc: 15,
      erPhic: 1250, erHdmf: 100 },
  },
];

const periods = [
  { month: "2026-07", first: { periodStart: "2026-07-01", periodEnd: "2026-07-15", payDate: "2026-07-15" },
    second: { periodStart: "2026-07-16", periodEnd: "2026-07-31", payDate: "2026-07-31" } },
  { month: "2026-09", first: { periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-15" },
    second: { periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-09-30" } },
] as const;

const expectedAggregate = {
  gross: 194749.99, sss: 6500, erSss: 13000, erEc: 120,
  phic: 4868.75, erPhic: 4868.75, hdmf: 800, erHdmf: 800,
  wht: 19441.78, net: 163139.46, employerCost: 213538.74,
} as const;
type Component = keyof typeof expectedAggregate;
const components = Object.keys(expectedAggregate) as Component[];

function cents(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(n) ? n : null;
}
function exact(actual: number, expected: number, description: string) {
  const observed = cents(actual);
  assert.notEqual(observed, null, description + " is not representable in integer centavos");
  assert.equal(observed, cents(expected), description + ": expected " + expected + ", observed " + actual);
}

function disposableCiDatabase() {
  return process.env.CI === "true" &&
    /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db(?:\?.*)?$/.test(process.env.DATABASE_URL ?? "") &&
    process.env.DEMO_MODE === "false";
}

test("2026 statutory reference cents: monthly SSS/PHIC/HDMF plus BIR semi-monthly source table", () => {
  for (const w of workers) {
    const s = computeSss(w.salary, "2026-09-30");
    exact(s.monthlySalaryCredit, w.msc, w.id + " MSC");
    exact(s.employee, w.monthly.sss, w.id + " SSS EE");
    exact(s.employer, w.monthly.erSss, w.id + " SSS ER");
    exact(s.employerEC, w.monthly.erEc, w.id + " SSS ER EC");
    const p = computePhilHealth(w.salary, "2026-09-30");
    exact(p.employee, w.monthly.phic, w.id + " PHIC EE");
    exact(p.employer, w.monthly.erPhic, w.id + " PHIC ER");
    const h = computePagIbig(w.salary, "2026-09-30");
    exact(h.employee, w.monthly.hdmf, w.id + " HDMF EE");
    exact(h.employer, w.monthly.erHdmf, w.id + " HDMF ER");
    for (const half of [w.first, w.second]) {
      // Actual Annex E source is taxable semi-monthly pay, not gross pay.
      const taxable = half.gross - half.sss - half.phic - half.hdmf;
      exact(computeSemiMonthlyWithholdingTax(taxable, false, "2026-09-30"),
        half.wht, w.id + " BIR semi-monthly gross-to-taxable");
    }
  }
  // Pure original-source checks must not depend on a database or prior live
  // company data. These values come from Annex E bracket arithmetic.
  exact(computeMonthlyWithholdingTax(25000, false, "2026-09-30"), 625.05, "BIR Annex E monthly column 2");
  exact(computeSemiMonthlyWithholdingTax(12000, false, "2026-09-30"), 237.45, "BIR Annex E semi-monthly column 2");
  exact(thirteenthMonthFromCentavos(228010.04), 19000.84, "DOLE 2026 LA 21 example");
  exact(thirteenthMonthFromCentavos(301200), 25100, "Fictional 2025 basic plus sourced retro (entitlement only)");
  exact(thirteenthMonthFromCentavos(360000), 30000, "Fictional 2026 basic excludes 2025-only retro");
});

test("four cutoffs have a certified 2026 national holiday pack without holiday-work input", () => {
  for (const p of periods) for (const half of [p.first, p.second]) {
    const calendar = nationalHolidayCalendarForDate(half.periodEnd);
    assert.ok(calendar.length > 0, "national 2026 calendar required");
    const inside = calendar.filter(d => d.date >= half.periodStart && d.date <= half.periodEnd);
    assert.deepEqual(inside, [], "No national holiday may be silently ignored in " + half.periodStart);
  }
});

test("two completed 2026 months, four real payroll cutoffs: independent employee, employer and journal bridge centavos", {
  skip: disposableCiDatabase() ? false : "Only GitHub Actions disposable localhost PG16/18; no Neon or customer DB",
}, async () => {
  const { eq } = await import("drizzle-orm");
  const { db, pool } = await import("../src/db");
  const { employees, employeePayProfiles, organizations, payrollEntries, payrollRuns } = await import("../src/db/schema");
  const { enqueuePayrollRun, drainPayrollQueue } = await import("../src/lib/payroll-engine");
  let organizationId: number | null = null;
  const mismatches: Array<{ month: string; cutoff: string; worker: string; component: string; expected: number; observed: number; deltaCentavos: number | null }> = [];
  const evidence: unknown[] = [];
  const byMonth: Record<string, Array<{ worker: string; actual: Record<Component, number> }>> = {};
  const check = (month: string, cutoff: string, worker: string, component: string, observed: number, expected: number) => {
    const a = cents(observed), b = cents(expected);
    const deltaCentavos = a === null || b === null ? null : a - b;
    if (deltaCentavos !== 0) mismatches.push({ month, cutoff, worker, component, expected, observed, deltaCentavos });
    return { expected, observed, deltaCentavos };
  };
  try {
    const [org] = await db.insert(organizations).values({
      name: "2026 statutory four-cutoff fictional proof",
      legalName: "Fictional employer (no production use)", plan: "Core",
      statutoryDeductionTiming: "split",
    }).returning();
    organizationId = org.id;
    for (const w of workers) {
      const [employee] = await db.insert(employees).values({
        organizationId: org.id, employeeNo: "PH26-" + w.id,
        firstName: "Fictional", lastName: w.id, title: "Source comparison", avatarInitials: "PH",
        basicRate: w.salary.toFixed(2), startDate: "2025-01-01", restDay: null, region: "NCR",
      }).returning();
      await db.insert(employeePayProfiles).values({
        employeeId: employee.id, organizationId: org.id, payBasis: "monthly",
        rateAmount: w.salary.toFixed(2), standardWorkDaysPerMonth: "22.00",
        standardHoursPerDay: "8.00",
      });
    }
    const people = await db.select().from(employees).where(eq(employees.organizationId, org.id));
    const employeeNumbers = new Map(people.map(p => [p.id, p.employeeNo]));
    const amount = (entry: { lineItems: unknown }, code: string) => {
      const lines = Array.isArray(entry.lineItems)
        ? entry.lineItems as Array<{ code?: string; amount?: string | number }>
        : [];
      return Math.abs(Number(lines.find(x => x.code === code)?.amount ?? 0));
    };
    const trace = (entry: { trace: unknown }, key: string) => {
      const inputs = (entry.trace as { inputs?: unknown } | null)?.inputs;
      const part = Array.isArray(inputs)
        ? inputs.find(x => typeof x === "string" && x.startsWith(key + "=")) : undefined;
      return typeof part === "string" ? Number(part.slice(key.length + 1)) : Number.NaN;
    };
    for (const p of periods) {
      byMonth[p.month] = [];
      for (const [index, cutoff] of [p.first, p.second].entries()) {
        const cutoffName = index === 0 ? "first" : "second";
        const [run] = await db.insert(payrollRuns).values({
          organizationId: org.id, periodLabel: "Fictional " + p.month + " " + cutoffName,
          scopeLabel: "All locations", status: "Draft", ...cutoff,
        }).returning();
        await enqueuePayrollRun(run.id, 25);
        await drainPayrollQueue(10, run.id);
        const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
        assert.equal(entries.length, workers.length, "Four actual engine entries required for " + p.month + " " + cutoffName);
        const entriesByWorker = new Map(entries.map(e => [employeeNumbers.get(e.employeeId), e]));
        for (const w of workers) {
          const entry = entriesByWorker.get("PH26-" + w.id);
          assert.ok(entry, "Missing " + w.id + " at " + p.month + " " + cutoffName);
          const expected = index === 0 ? w.first : w.second;
          const actual: Record<keyof Half, number> = {
            gross: Number(entry.grossPay),
            sss: amount(entry, "SSS"),
            phic: amount(entry, "PHIC"),
            hdmf: amount(entry, "HDMF"),
            wht: amount(entry, "WHT"),
            net: Number(entry.netPay),
            erSss: trace(entry, "sssEmployerCutoff"),
            erEc: trace(entry, "sssEmployerEcCutoff"),
            erPhic: trace(entry, "philHealthEmployerCutoff"),
            erHdmf: trace(entry, "pagIbigEmployerCutoff"),
          };
          const comparisons = Object.fromEntries((Object.keys(expected) as Array<keyof Half>)
            .map(k => [k, check(p.month, cutoffName, w.id, k, actual[k], expected[k])]));
          check(p.month, cutoffName, w.id, "payslip gross minus deductions",
            Number(entry.grossPay) - Number(entry.deductions), Number(entry.netPay));
          evidence.push({ month: p.month, cutoff: cutoffName, employee: w.id, comparisons,
            status: "FICTIONAL ENGINE ONLY; original-source/effective date and PH policy remain subject to independent acceptance" });
          byMonth[p.month].push({ worker: w.id, actual: actual as Record<Component, number> });
        }
        // Only a direct synthetic DB status marker, NOT real approval/release.
        // This exists solely for the later cutoff's prior-run true-up path.
        await db.update(payrollRuns).set({ status: "Released" }).where(eq(payrollRuns.id, run.id));
      }
      const grouped: Record<string, Record<Component, number>> = {};
      for (const row of byMonth[p.month]) {
        grouped[row.worker] ||= Object.fromEntries(components.map(k => [k, 0])) as Record<Component, number>;
        for (const k of components.filter(k => k !== "employerCost")) {
          grouped[row.worker][k] += row.actual[k];
        }
      }
      const aggregate = Object.fromEntries(components.map(k => [k, 0])) as Record<Component, number>;
      for (const w of workers) {
        const result = grouped[w.id];
        assert.ok(result, "Missing monthly aggregate for " + w.id);
        result.employerCost = result.gross + result.erSss + result.erEc + result.erPhic + result.erHdmf;
        for (const k of components) {
          check(p.month, "month", w.id, k, result[k], w.monthly[k]);
          aggregate[k] += result[k];
        }
      }
      for (const k of components) check(p.month, "month", "ALL", k, aggregate[k], expectedAggregate[k]);
      const employerContributions = aggregate.erSss + aggregate.erEc + aggregate.erPhic + aggregate.erHdmf;
      const debitBridge = aggregate.gross + employerContributions;
      const creditBridge = aggregate.net + aggregate.sss + aggregate.phic + aggregate.hdmf + aggregate.wht + employerContributions;
      check(p.month, "journal-bridge", "ALL", "debits", debitBridge, 213538.74);
      check(p.month, "journal-bridge", "ALL", "credits", creditBridge, 213538.74);
      check(p.month, "journal-bridge", "ALL", "debits-vs-credits", debitBridge, creditBridge);
      console.log("PH_2026_MONTHLY_LEDGER " + JSON.stringify({ month: p.month, expectedAggregate, actualAggregate: aggregate,
        debitBridge, creditBridge,
        caveat: "manual expense/payable bridge only; actual GL exporter and portal acceptance NOT RUN" }));
    }
    console.log("PH_2026_TWO_MONTH_CUTOFF_EVIDENCE " + JSON.stringify(evidence));
    console.log("PH_2026_TWO_MONTH_CUTOFF_DISAGREEMENTS " + JSON.stringify({
      months: periods.map(p => p.month), cutoffs: 4, workers: workers.length, mismatches,
      qualifiedPayrollReview: "NOT RUN", agencyPortalAcceptance: "NOT RUN", realEmployer: "NOT RUN",
    }));
    assert.deepEqual(mismatches, [], "Preserve all source-vs-engine signed centavo mismatches and keep #1999 open for independent review");
  } finally {
    if (organizationId !== null) await db.delete(organizations).where(eq(organizations.id, organizationId));
    await pool.end();
  }
});
