import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { annualBirItems, buildComplianceCalendar, nominalBir1601CDueDate } from "../src/lib/compliance-calendar";

test("BIR 1601-C uses the conservative non-eFPS target and December exception", () => {
  assert.equal(nominalBir1601CDueDate("2026-09"), "2026-10-10");
  assert.equal(nominalBir1601CDueDate("2026-12"), "2027-01-15");
});

test("annual 2316 and 1604-C deadlines surface from November through April only", () => {
  assert.deepEqual(annualBirItems(2026, "2026-10-31"), []);
  assert.deepEqual(annualBirItems(2026, "2027-05-01"), []);

  const november = annualBirItems(2026, "2026-11-15");
  assert.deepEqual(
    november.map((item) => [item.id, item.dueDate, item.status]),
    [
      ["BIR-2316-EMPLOYEE-2026", "2027-01-31", "upcoming"],
      ["BIR-1604C-2026", "2027-01-31", "upcoming"],
      ["BIR-2316-BIR-2026", "2027-02-28", "upcoming"],
    ],
  );

  const lateJanuary = annualBirItems(2026, "2027-01-26");
  assert.equal(lateJanuary.find((item) => item.id === "BIR-1604C-2026")?.status, "due-soon");
  const february = annualBirItems(2026, "2027-02-01");
  assert.equal(february.find((item) => item.id === "BIR-2316-EMPLOYEE-2026")?.status, "verification-required");
  assert.equal(february.find((item) => item.id === "BIR-2316-BIR-2026")?.status, "upcoming");
});

test("annual items track the tax year in its Nov–Apr window only when payroll ran that year", async () => {
  const { annualTaxYearCandidates } = await import("../src/lib/compliance-calendar-server");
  assert.deepEqual(annualTaxYearCandidates("2026-11-03", [2026]), [2026]);
  assert.deepEqual(annualTaxYearCandidates("2027-04-20", [2026, 2027]), [2026], "April still covers the prior tax year");
  assert.deepEqual(annualTaxYearCandidates("2026-07-01", [2026]), []);
  assert.deepEqual(annualTaxYearCandidates("2027-02-01", [2027]), [], "no payroll in the tax year means no annual items");
});

test("the calendar includes annual items for the tax year of recent pay months", () => {
  const items = buildComplianceCalendar({
    today: "2027-01-20",
    currentMonth: "2027-01",
    applicableMonths: ["2026-12"],
    birApplicableMonths: ["2026-12"],
    legalName: "Acme Payroll Inc.",
    philHealthEmployerNo: "00-123456789-3",
    batches: [],
  });
  assert.ok(items.some((item) => item.id === "BIR-1604C-2026"));
  assert.ok(!items.some((item) => item.id.endsWith("-2027")));
});

test("calendar resolves current employer remittance schedules without inventing completion", () => {
  const items = buildComplianceCalendar({
    today: "2026-10-05",
    currentMonth: "2026-10",
    applicableMonths: ["2026-09"],
    legalName: "Acme Payroll Inc.",
    philHealthEmployerNo: "00-123456789-3",
    batches: [],
  });

  const byAgency = new Map(items.map((item) => [item.agency, item]));
  assert.equal(byAgency.get("BIR")?.dueDate, "2026-10-10");
  assert.equal(byAgency.get("BIR")?.exactness, "conservative-target");
  assert.equal(byAgency.get("SSS")?.dueDate, "2026-10-31");
  assert.equal(byAgency.get("PhilHealth")?.dueDate, "2026-10-15");
  assert.equal(byAgency.get("Pag-IBIG")?.dueDate, "2026-10-14");
  assert.notEqual(byAgency.get("BIR")?.status, "complete");
  assert.notEqual(byAgency.get("SSS")?.status, "complete");
});

test("reconciled remittance evidence closes only the matching agency obligation", () => {
  const items = buildComplianceCalendar({
    today: "2026-11-02",
    currentMonth: "2026-11",
    applicableMonths: ["2026-09"],
    legalName: "Metro Payroll Inc.",
    philHealthEmployerNo: "00-123456789-8",
    batches: [{
      agency: "SSS",
      applicableMonth: "2026-09",
      dueDate: "2026-10-31",
      status: "reconciled",
      pendingPostingCount: 0,
      exceptionCount: 0,
    }],
  });

  assert.equal(items.find((item) => item.agency === "SSS")?.status, "complete");
  assert.equal(items.find((item) => item.agency === "BIR")?.status, "verification-required");
  assert.equal(items.find((item) => item.agency === "PhilHealth")?.status, "overdue");
});

test("PhilHealth deadline fails closed when the employer number is unavailable", () => {
  const items = buildComplianceCalendar({
    today: "2026-10-05",
    currentMonth: "2026-10",
    applicableMonths: ["2026-09"],
    legalName: "Acme Payroll Inc.",
    philHealthEmployerNo: null,
    batches: [],
  });
  const philHealth = items.find((item) => item.agency === "PhilHealth");
  assert.equal(philHealth?.dueDate, null);
  assert.equal(philHealth?.status, "configuration-required");
});

test("Compliance Center wiring keeps the calendar authenticated and evidence-aware", () => {
  const route = readFileSync("src/app/api/compliance/calendar/route.ts", "utf8");
  const loader = readFileSync("src/lib/compliance-calendar-server.ts", "utf8");
  const panel = readFileSync("src/components/workspace/compliance-calendar-panel.tsx", "utf8");
  const compliance = readFileSync("src/components/workspace/panels.tsx", "utf8");

  assert.ok(route.includes("getSessionUser"));
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("loadComplianceCalendar"));
  assert.ok(loader.includes("buildComplianceCalendar"));
  assert.ok(loader.includes("statutoryRemittanceBatches.organizationId"));
  assert.ok(panel.includes("conservative internal target"));
  assert.ok(panel.includes("What is due, what is proven, what still needs evidence."));
  assert.ok(compliance.includes("ComplianceCalendarPanel"));
});


test("accepted BIR acknowledgement closes the monthly calendar obligation without claiming file-format proof", () => {
  const items = buildComplianceCalendar({
    today: "2026-10-12",
    currentMonth: "2026-10",
    applicableMonths: ["2026-09"],
    legalName: "Acme Payroll Inc.",
    philHealthEmployerNo: "00-123456789-3",
    bir1601cOperationalMonths: ["2026-09"],
    batches: [],
  });
  const bir = items.find((item) => item.agency === "BIR");
  assert.equal(bir?.status, "complete");
  assert.match(bir?.detail ?? "", /operational filing/);
  assert.match(bir?.detail ?? "", /not that PayrollPH produced an official BIR upload file/);
});


test("BIR follows pay month independently from contribution month", () => {
  const items = buildComplianceCalendar({
    today: "2026-11-05",
    currentMonth: "2026-11",
    applicableMonths: ["2026-09"],
    birApplicableMonths: ["2026-10"],
    legalName: "Acme Payroll Inc.",
    philHealthEmployerNo: "00-123456789-3",
    batches: [],
  });

  assert.equal(items.find((item) => item.agency === "BIR")?.applicableMonth, "2026-10");
  assert.equal(items.find((item) => item.agency === "SSS")?.applicableMonth, "2026-09");
  assert.equal(items.some((item) => item.agency === "BIR" && item.applicableMonth === "2026-09"), false);
});

test("company-wide remittance cannot be marked reconciled by just one legal employer", async () => {
  const { aggregateEmployerRemittanceBatches } = await import("../src/lib/compliance-calendar-server");
  const runs = [
    { periodEnd: "2026-09-15", legalEntityId: 101 },
    { periodEnd: "2026-09-30", legalEntityId: 202 },
  ];
  const batch = (legalEntityId: number, status: string, pendingPostingCount = 0, exceptionCount = 0) => ({
    legalEntityId, agency: "SSS", applicableMonth: "2026-09",
    dueDate: "2026-10-31", status, pendingPostingCount, exceptionCount,
  });
  const month = ["2026-09"];
  const statusFor = (rows: ReturnType<typeof aggregateEmployerRemittanceBatches>) =>
    buildComplianceCalendar({
      today: "2026-11-02", currentMonth: "2026-11",
      applicableMonths: month, legalName: "Example Inc.",
      philHealthEmployerNo: "00123456789",
      batches: rows,
    }).find(item => item.id === "SSS-2026-09")?.status;

  assert.equal(statusFor(aggregateEmployerRemittanceBatches(runs,
    [batch(101, "open"), batch(202, "reconciled")], month)), "overdue",
    "A reconciled last row must not mask the first employer's open liability");
  assert.equal(statusFor(aggregateEmployerRemittanceBatches(runs,
    [batch(202, "reconciled"), batch(101, "open")], month)), "overdue",
    "Calendar status cannot depend on result-row order");
  assert.equal(statusFor(aggregateEmployerRemittanceBatches(runs,
    [batch(101, "reconciled")], month)), "verification-required",
    "Missing employer batch must not be presented as a company-wide clearance");
  assert.equal(statusFor(aggregateEmployerRemittanceBatches(runs,
    [batch(101, "reconciled"), batch(202, "reconciled")], month)), "complete");
  assert.equal(statusFor(aggregateEmployerRemittanceBatches([
    ...runs, { periodEnd: "2026-09-30", legalEntityId: null },
  ], [batch(101, "reconciled"), batch(202, "reconciled")], month)), "verification-required",
  "Legacy unscoped payroll must never inherit another employer's cleared batch");
  assert.equal(statusFor(aggregateEmployerRemittanceBatches(runs,
    [batch(101, "reconciled"), batch(202, "exception", 0, 1)], month)), "exception");
  assert.equal(statusFor(aggregateEmployerRemittanceBatches(runs,
    [batch(101, "reconciled"), batch(202, "paid", 1)], month)), "posting-pending");
});

test("monthly BIR 1601-C clearance requires accepted evidence for every legal employer", async () => {
  const { fullyConfirmedBirMonths } = await import("../src/lib/compliance-calendar-server");
  const runs = [
    { payDate: "2026-09-15", legalEntityId: 101 },
    { payDate: "2026-09-30", legalEntityId: 202 },
  ];
  const month = ["2026-09"];
  const good = (legalEntityId: number, payrollRunLegalEntityId: number | null = legalEntityId) => ({
    payDate: "2026-09-15", legalEntityId, payrollRunLegalEntityId,
  });
  assert.deepEqual(fullyConfirmedBirMonths(runs, [good(101)], month), [],
    "One employer's BIR filing cannot close another employer's annualized monthly obligation");
  assert.deepEqual(fullyConfirmedBirMonths(runs, [good(101), good(202)], month), month);
  assert.deepEqual(fullyConfirmedBirMonths(runs, [good(101), good(202, 101)], month), [],
    "Cross-entity run linkage must never count as a valid filing receipt");
  assert.deepEqual(fullyConfirmedBirMonths([...runs, { payDate: "2026-09-30", legalEntityId: null }],
    [good(101), good(202)], month), [],
    "Unscoped historic runs cannot be cleared by known employer filings");
});
