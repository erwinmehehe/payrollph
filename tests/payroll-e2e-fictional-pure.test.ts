import assert from "node:assert/strict";
import test from "node:test";
import { calculateEmployeePay } from "../src/lib/payroll-engine";
import { buildReleasedPayrollJournal } from "../src/lib/payroll-journal-export";
import { computeFinalPay } from "../src/lib/final-pay";
import { finalPaySignedBalance } from "../src/lib/final-pay-signed-balance";
import { thirteenthMonthFromCentavos } from "../src/lib/thirteenth-month-centavos";
import { resolvePayProfile, resolvePayTimeline, fixedMonthlyBasicForTimeline } from "../src/lib/pay-basis";
import { holidayMultiplier, computeSss, computePhilHealth, computePagIbig } from "../src/lib/payroll-rules";
import { allocateMandatoryDeductions } from "../src/lib/payroll-mandatory-shortfall";
import type { employees, timePunches } from "../src/db/schema";

/**
 * Independent fictional earnings expectations: docs/qa/payroll-e2e-scenario-matrix.md.
 * This is software consistency QA, NOT rate/holiday/remittance certification.
 * The 2026 statutory assumptions and premium treatment are UNVERIFIED RATE.
 */
type Input = Parameters<typeof calculateEmployeePay>[0];
type Calc = ReturnType<typeof calculateEmployeePay>;
type Basis = "monthly" | "daily" | "hourly";
const ruleVersions = { sss: "UNVERIFIED RATE", philHealth: "UNVERIFIED RATE",
  pagIbig: "UNVERIFIED RATE", withholding: "UNVERIFIED RATE" };

// Parse *printed* centavos; no binary-float addition/subtraction in the oracle.
function cents(value: string | number): number {
  const literal = typeof value === "number" ? value.toFixed(2) : value;
  assert.match(literal, /^-?\d+\.\d{2}$/, "Financial values must be printed in centavos");
  const sign = literal.startsWith("-") ? -1 : 1;
  const [whole, fractional] = literal.replace("-", "").split(".");
  const result = sign * (Number(whole) * 100 + Number(fractional));
  assert.ok(Number.isSafeInteger(result));
  return result;
}
function amountOf(result: Calc, code: string) {
  return result.lineItems.filter((line) => line.code === code)
    .reduce((total, line) => total + cents(line.amount), 0);
}
function assertReconciles(result: Calc) {
  assert.equal(cents(result.gross) - cents(result.deductions), cents(result.net),
    "Gross minus applied deductions must equal net to centavo");
  // Classify by *economic bucket*, not sign: unpaid leave reduces gross,
  // while a year-end tax refund is a positive line that reduces deductions.
  const deductionCodes = new Set(["SSS", "PHIC", "HDMF", "HDMF_VOL", "WHT", "LATE", "UT"]);
  const isDeduction = (code: string) => deductionCodes.has(code)
    || code.startsWith("YE-TAX") || code.startsWith("LOAN-")
    || code.startsWith("ADV-") || code.startsWith("BEN-");
  const grossLines = result.lineItems.reduce((sum, line) =>
    sum + (isDeduction(line.code) ? 0 : cents(line.amount)), 0);
  const signedDeductionLines = result.lineItems.reduce((sum, line) =>
    sum + (isDeduction(line.code) ? cents(line.amount) : 0), 0);
  assert.equal(grossLines, cents(result.gross), "Signed earnings buckets must equal gross");
  assert.equal(-signedDeductionLines, cents(result.deductions), "Signed withheld/refunded lines must equal deductions");
  assert.equal(grossLines + signedDeductionLines, cents(result.net), "Payslip lines must equal net");
  assert.ok(result.net >= 0, "Ordinary payroll is not a negative payout");
  assert.match(result.payslipText, new RegExp("Gross: PHP " + result.gross.toFixed(2).replace(".", "\\.")));
  assert.match(result.payslipText, new RegExp("Net pay: PHP " + result.net.toFixed(2).replace(".", "\\.")));
}
function worker(id: number, basis: Basis, rate: number, startDate = "2025-01-01", restDay: string | null = null) {
  const monthly = basis === "monthly" ? rate : basis === "daily" ? rate * 22 : rate * 8 * 22;
  return {
    id, organizationId: 9000, employeeNo: "FICTION-" + id,
    firstName: "Fictional", lastName: "Worker" + id,
    title: "Tester", avatarInitials: "FW", startDate, status: "Active",
    basicRate: monthly.toFixed(2), mwe: false, region: "NCR",
    pagIbigVoluntaryMonthly: "0.00", restDay, bankAccount: null, mobile: null,
  } as unknown as typeof employees.$inferSelect;
}
function fixture(basis: Basis = "monthly", rate = 22000, startDate = "2025-01-01",
  periodStart = "2026-10-01", periodEnd = "2026-10-15", restDay: string | null = null): Input {
  return {
    employee: worker(1, basis, rate, startDate, restDay),
    punches: [], advisories: [], unitName: "Operations",
    periodLabel: "Fictional cutoff", payProfile: {
      payBasis: basis, rateAmount: rate, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8,
    },
    holidayCalendar: [], periodStart, periodEnd, payDate: periodEnd,
    statutoryRuleVersions: ruleVersions,
  };
}
function punch(id: number, date: string, start: string, end: string,
  shiftStart = "09:00", shiftEnd = "18:00",
  breakStart?: string, breakEnd?: string) {
  const stamp = (part: string) => new Date(part + "+08:00");
  return {
    id, workDate: date, status: "Complete", shiftStart, shiftEnd,
    timeIn: stamp(date + "T" + start),
    timeOut: stamp(end.slice(0, 10).includes("-") ? end : date + "T" + end),
    breakStart: breakStart ? stamp(breakStart) : null,
    breakEnd: breakEnd ? stamp(breakEnd) : null,
  } as unknown as typeof timePunches.$inferSelect;
}
function run(input: Input) {
  const result = calculateEmployeePay(input);
  assertReconciles(result);
  assert.equal(JSON.stringify(calculateEmployeePay(input)), JSON.stringify(result),
    "Identical fictional inputs must reproduce exactly the same result bytes");
  return result;
}

test("S01/S02: monthly basis on semi-monthly cutoff reconciles deductions, net, employer-only costs and balanced GL", () => {
  const result = run(fixture());
  assert.equal(amountOf(result, "BASIC"), 1100000);
  assert.equal(amountOf(result, "SSS"), -55000);
  assert.equal(amountOf(result, "PHIC"), -27500);
  assert.equal(amountOf(result, "HDMF"), -10000);
  assert.equal(amountOf(result, "WHT"), 0);
  assert.equal(cents(result.gross), 1100000);
  assert.equal(cents(result.deductions), 92500);
  assert.equal(cents(result.net), 1007500);
  assert.ok(result.trace.inputs.includes("employerStatutoryCost=1490.00"));
  const lines = buildReleasedPayrollJournal([{
    id: 101, organizationId: 9000, legalEntityId: 100,
    status: "Released", periodLabel: "Fictional cutoff", payDate: "2026-10-15",
    grossPay: "11000.00", netPay: "10075.00",
  }]);
  assert.equal(lines.reduce((sum, row) => sum + row.debitCentavos, 0), 1100000);
  assert.equal(lines.reduce((sum, row) => sum + row.creditCentavos, 0), 1100000);
  assert.equal(lines.find((row) => row.accountCode === "2100")?.creditCentavos, 92500);
});

test("S03/S04: ten daily or hourly worked shifts pay ten days and do not manufacture a full salary", () => {
  for (const [basis, rate] of [["daily", 800], ["hourly", 100]] as const) {
    const input = fixture(basis, rate);
    input.punches = Array.from({ length: 10 }, (_, index) =>
      punch(index + 1, "2026-10-" + String(index + 1).padStart(2, "0"), "09:00", "18:00"));
    const result = run(input);
    assert.equal(amountOf(result, "BASIC"), 800000, basis);
    assert.equal(amountOf(result, "SSS"), -40000, basis);
    assert.equal(amountOf(result, "PHIC"), -22000, basis);
    assert.equal(amountOf(result, "HDMF"), -10000, basis);
    assert.equal(cents(result.net), 728000, basis);
  }
});

test("S05/S06/S07: independent calendar-day proration, hire exclusion and documented exit input gap", () => {
  const newHire = run(fixture("monthly", 22000, "2026-10-08"));
  assert.equal(amountOf(newHire, "BASIC"), 586667, "8 of 15 inclusive days at 11000 / cutoff");
  const timeline = resolvePayTimeline({
    currentProfile: { payBasis: "monthly", rateAmount: 22000, standardWorkDaysPerMonth: 22, standardHoursPerDay: 8 },
    revisions: [], periodStart: "2026-10-01", periodEnd: "2026-10-15",
  });
  assert.equal(cents(fixedMonthlyBasicForTimeline(timeline, "2026-10-01", "2026-10-15",
    "2025-01-01", "2026-10-09")), 660000,
  "Independent exit end-day arithmetic: 9 / 15 x 11000");
  const exited = fixture();
  exited.employmentEndDate = "2026-10-09";
  assert.equal(amountOf(run(exited), "BASIC"), 660000,
    "Approved Oct 9 separation must not pay Oct 10-15");
  const exitedDaily = fixture("daily", 800);
  exitedDaily.employmentEndDate = "2026-10-09";
  exitedDaily.punches = [
    punch(41, "2026-10-08", "09:00", "18:00"),
    punch(42, "2026-10-09", "09:00", "18:00"),
    punch(43, "2026-10-10", "09:00", "18:00"),
  ];
  assert.equal(amountOf(run(exitedDaily), "BASIC"), 160000,
    "Only two 800/day workdays were within approved employment");
  const daily = fixture("daily", 800, "2026-10-08");
  daily.punches = [punch(1, "2026-10-07", "09:00", "18:00"), punch(2, "2026-10-08", "09:00", "18:00")];
  assert.equal(amountOf(run(daily), "BASIC"), 80000, "pre-hire time must not be paid");
});

test("S08: approved unpaid day and late/undertime are deducted exactly once", () => {
  const input = fixture("monthly", 35200);
  input.approvedLeave = [{
    id: 1, leaveType: "Unpaid leave", payTreatment: "unpaid",
    startDate: "2026-10-08", endDate: "2026-10-08", overlapDays: 1,
    paidPercentage: 0, paidDays: 0, unpaidDays: 1,
  }] as Input["approvedLeave"];
  input.punches = [punch(3, "2026-10-09", "10:05", "17:30")];
  const result = run(input);
  assert.equal(amountOf(result, "BASIC"), 1760000);
  assert.equal(amountOf(result, "LEAVE-1"), -160000);
  assert.equal(amountOf(result, "LATE"), -20000);
  assert.equal(amountOf(result, "UT"), -10000);
  // Negative leave is part of gross, whereas LATE and UT are cash deductions.
  assert.equal(cents(result.gross), 1600000);
});

test("S09-S14: all six worked-day and OT classes use independent premium arithmetic", () => {
  const cases = [
    { date: "2026-01-05", kind: "ordinary", rest: null, ot: 25000, premium: 0 },
    { date: "2026-01-04", kind: "ordinary", rest: "Sunday", ot: 33800, premium: 24000 },
    { date: "2026-02-17", kind: "special", rest: null, ot: 33800, premium: 24000 },
    { date: "2026-01-01", kind: "regular", rest: null, ot: 52000, premium: 80000 },
    { date: "2026-01-01", kind: "regular", rest: "Thursday", ot: 67600, premium: 128000 },
    { date: "2026-02-17", kind: "special", rest: "Tuesday", ot: 39000, premium: 40000 },
  ] as const;
  cases.forEach((scenario, i) => {
    const start = scenario.date.slice(0, 7) + "-01";
    const end = scenario.date.slice(0, 7) + "-28";
    const input = fixture("hourly", 100, "2025-01-01", start, end, scenario.rest);
    input.holidayCalendar = scenario.kind === "ordinary" ? [] : [{
      date: scenario.date, name: "Fictional calendar classification", kind: scenario.kind,
    }];
    input.punches = [punch(i + 1, scenario.date, "09:00", "20:00")];
    const result = run(input);
    assert.equal(amountOf(result, "OT"), scenario.ot, scenario.date + " overtime");
    assert.equal(amountOf(result, "HOLIDAY"), scenario.premium, scenario.date + " worked premium");
    assert.equal(amountOf(result, "BASIC"), 80000);
  });
  assert.equal(holidayMultiplier({ holiday: "regular", worked: true, restDay: true, overtime: true }), 3.38);
});

test("S15: one overnight shift belongs to its source cutoff and is never counted again in next cutoff", () => {
  const first = fixture("hourly", 100);
  first.punches = [punch(9, "2026-10-15", "22:00", "2026-10-16T06:00",
    "22:00", "06:00", "2026-10-16T01:00", "2026-10-16T02:00")];
  const worked = run(first);
  const futurePunch = punch(10, "2026-10-16", "09:00", "18:00");
  assert.equal(cents(run({ ...first, punches: [...first.punches, futurePunch] }).gross), 77000,
    "Pure engine must ignore explicitly supplied next-cutoff hours");
  assert.equal(amountOf(worked, "BASIC"), 70000);
  assert.equal(amountOf(worked, "ND"), 7000);
  // Defense-in-depth: pure function must not accept a stale punch in the second cutoff.
  const second: Input = { ...first, periodStart: "2026-10-16",
    periodEnd: "2026-10-31", payDate: "2026-10-31" };
  const later = run(second);
  assert.equal(cents(later.gross), 0);
  assert.equal(cents(worked.gross) + cents(later.gross), 77000);
  assert.equal(later.status, "Exception", "Zero wages with unpaid mandatory contribution must block release");
});

test("S16: unworked special day has no minimum premium and regular holiday eligibility remains evidenced", () => {
  const base = fixture("daily", 800, "2025-01-01", "2026-01-01", "2026-01-15");
  base.holidayCalendar = [{ date: "2026-01-01", name: "Fictional regular holiday", kind: "regular" }];
  const missing = run(base);
  assert.equal(amountOf(missing, "HOLIDAY_UNWORKED"), 0);
  assert.equal(missing.status, "Exception");
  const proven = { ...base, holidayEligibilityAttendanceDates: ["2025-12-31"] };
  const entitled = run(proven);
  assert.equal(amountOf(entitled, "HOLIDAY_UNWORKED"), 80000);
  const special = { ...base, holidayCalendar: [{ date: "2026-01-01", name: "Fictional special day", kind: "special" as const }] };
  assert.equal(amountOf(run(special), "HOLIDAY_UNWORKED"), 0);
});

test("S18-S20: boundary rates are UNVERIFIED RATE and never treated as approval", () => {
  for (const [salary, expected] of [[5250, 835], [20250, 3105], [34750, 5280]]) {
    assert.equal(cents(computeSss(salary).total), expected * 100);
  }
  for (const salary of [8000, 10000, 100000, 150000]) {
    const actual = computePhilHealth(salary);
    assert.equal(cents(actual.total), Math.min(100000, Math.max(10000, salary)) * 5);
    assert.equal(cents(actual.employee) + cents(actual.employer), cents(actual.total));
  }
  assert.equal(computePagIbig(1500).employee, 15);
  assert.equal(computePagIbig(10000).employee, 200);
});

test("S21/S22: optional loan shortfall defers rather than overdraws, mandatory deficit blocks release", () => {
  const input = fixture("monthly", 4000);
  input.loans = [
    { id: 2, loanType: "Company Loan", referenceNo: "C", cutoffDeduction: 1200, remainingBalance: 1200 },
    { id: 1, loanType: "SSS Loan", referenceNo: "G", cutoffDeduction: 800, remainingBalance: 800 },
  ];
  const result = run(input);
  assert.equal(cents(result.net), 0);
  assert.ok(amountOf(result, "LOAN-1") <= 0);
  assert.ok(amountOf(result, "LOAN-2") <= 0);
  assert.ok(result.trace.flags.length > 0, "Uncollected optional amounts remain visible");
  const impossible = allocateMandatoryDeductions(100, {
    sss: 130, philHealth: 0, pagIbig: 0, withholding: 0,
    yearEndTaxAdjustment: 0, tardiness: 0, undertime: 0,
  });
  assert.equal(cents(impossible.appliedTotal), 10000);
  assert.equal(cents(impossible.totalUncollected), 3000);
  assert.equal(cents(impossible.disposableBeforeOptional), 0);
});

test("S23-S25: 13th-month exact-centavos, partial year, final pay floor and signed accounting remain independent", () => {
  assert.equal(thirteenthMonthFromCentavos(120000), 10000);
  assert.equal(thirteenthMonthFromCentavos(60000), 5000);
  assert.equal(thirteenthMonthFromCentavos(30000) - 1000, 1500);
  const exit = computeFinalPay({
    releasedBasicYtd: 30000, historicalBasicYtd: 0, unpaidBasicSalary: 0,
    thirteenthPaidYtd: 1000, grossCompensationYtd: 30000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: false,
    leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0,
    otherBenefits: 0, loanDeductions: 10000,
  });
  assert.equal(exit.thirteenthDue, 1500);
  assert.equal(exit.loanDeductions, 1500);
  assert.equal(exit.netFinalPay, 0);
  assert.equal(exit.deferredLoanBalance, 8500);
  const resignation = computeFinalPay({
    releasedBasicYtd: 30000, historicalBasicYtd: 0, unpaidBasicSalary: 2000,
    thirteenthPaidYtd: 1166.67, grossCompensationYtd: 30000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: false,
    leaveMonetizationPay: 500, separationPay: 0, retirementPay: 0,
    otherBenefits: 0, loanDeductions: 1000,
  });
  const termination = computeFinalPay({
    releasedBasicYtd: 30000, historicalBasicYtd: 0, unpaidBasicSalary: 2000,
    thirteenthPaidYtd: 1166.67, grossCompensationYtd: 30000,
    statutoryContributionsYtd: 0, taxWithheldYtd: 0, mwe: false,
    leaveMonetizationPay: 500, separationPay: 2000, retirementPay: 0,
    otherBenefits: 0, loanDeductions: 1000,
  });
  assert.equal(resignation.thirteenthDue, 1500);
  assert.equal(resignation.grossFinalPay, 4000);
  assert.equal(resignation.netFinalPay, 3000);
  assert.equal(termination.grossFinalPay, 6000);
  assert.equal(termination.netFinalPay, 5000);
  assert.equal(finalPaySignedBalance({ grossFinalPay: "0.00",
    taxAdjustment: "-7500.00", finalStatutoryDeductions: "0.00", loanDeductions: "0.00" }), -7500);
});

test("S28: 51 half-cent monthly salary buckets accumulate rounded per-worker, not after grand total", () => {
  let grossCentavos = 0;
  for (let i = 1; i <= 51; i++) {
    const input = fixture("monthly", 22000.01);
    input.employee = worker(i, "monthly", 22000.01);
    const result = run(input);
    assert.equal(cents(result.gross), 1100001);
    grossCentavos += cents(result.gross);
  }
  assert.equal(grossCentavos, 56100051);
  // Exactly 51 x (22000.01 / 2) pesos = 561000.255, rounded once = 561000.26.
  assert.notEqual(grossCentavos, 56100026);
});

test("seeded property matrix: 192 fictional employee combinations are deterministic and centavo-reconciled", () => {
  let state = 0x26ab1027;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
  const bases: Basis[] = ["monthly", "daily", "hourly"];
  let exceptions = 0;
  for (let i = 0; i < 192; i++) {
    const n = next();
    const basis = bases[n % 3];
    const rate = basis === "monthly" ? 16000 + 1000 * ((n >>> 8) % 50)
      : basis === "daily" ? 800 + 25 * ((n >>> 8) % 30)
        : 100 + 5 * ((n >>> 8) % 30);
    const hired = (n & 8) !== 0;
    const input = fixture(basis, rate, hired ? "2026-10-08" : "2025-01-01");
    input.employee = worker(i + 50, basis, rate, hired ? "2026-10-08" : "2025-01-01");
    if (basis !== "monthly" && (n & 1)) {
      input.punches = [punch(i + 100, "2026-10-09", "09:00", "18:00")];
    }
    if ((n & 16) !== 0) input.loans = [
      { id: 900 + i, loanType: "Fictional loan", referenceNo: "F",
        cutoffDeduction: 50000, remainingBalance: 50000 },
    ];
    const result = run(input);
    if (result.status === "Exception") exceptions++;
  }
  assert.ok(exceptions >= 1, "The seed must exercise exceptions as well as standard pay");
});

test("journal negative deduction control: a year-end refund increases net and must balance without negative credits", () => {
  // Independent accounting: DR wage expense 11000 + DR signed deduction control 575
  // = CR net payable 11575 (925 contributions less 1500 tax refund).
  const input = fixture("monthly", 22000);
  input.yearEndTaxAdjustment = { id: 19, taxYear: 2026, adjustment: -1500, outcome: "refund" };
  const result = run(input);
  assert.equal(cents(result.gross), 1100000);
  assert.equal(cents(result.net), 1157500, "Net = 11000 - 925 statutory + 1500 refund");
  const lines = buildReleasedPayrollJournal([{
    id: 201, organizationId: 9000, legalEntityId: 100,
    status: "Released", periodLabel: "Fictional refund", payDate: "2026-10-15",
    grossPay: result.gross.toFixed(2), netPay: result.net.toFixed(2),
  }]);
  assert.deepEqual(lines.map((line) =>
    [line.accountCode, line.debitCentavos, line.creditCentavos]), [
      ["6000", 1100000, 0], ["2100", 57500, 0], ["2200", 0, 1157500],
    ]);
  assert.equal(lines.reduce((sum, line) => sum + line.debitCentavos, 0),
    lines.reduce((sum, line) => sum + line.creditCentavos, 0));
});
