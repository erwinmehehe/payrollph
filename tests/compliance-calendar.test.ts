import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildComplianceCalendar, nominalBir1601CDueDate } from "../src/lib/compliance-calendar";

test("BIR 1601-C uses the conservative non-eFPS target and December exception", () => {
  assert.equal(nominalBir1601CDueDate("2026-09"), "2026-10-10");
  assert.equal(nominalBir1601CDueDate("2026-12"), "2027-01-15");
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
  const panel = readFileSync("src/components/workspace/compliance-calendar-panel.tsx", "utf8");
  const compliance = readFileSync("src/components/workspace/panels.tsx", "utf8");

  assert.ok(route.includes("getSessionUser"));
  assert.ok(route.includes("company-wide"));
  assert.ok(route.includes("buildComplianceCalendar"));
  assert.ok(route.includes("statutoryRemittanceBatches.organizationId"));
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

test("annual 1604-C/Alphalist and 2316 certificate issuance are separately labeled Jan 31 reminders", () => {
  const items = buildComplianceCalendar({
    today: "2026-10-10", currentMonth: "2026-10",
    applicableMonths: ["2026-09"],
    birApplicableMonths: ["2026-09"],
    legalName: "Annual Testing Inc.",
    philHealthEmployerNo: "00-123456789-3", batches: [],
    includeAnnualObligations: true,
  });
  const alphalist = items.find((item) => item.id === "BIR-1604C-ALPHALIST-2026");
  const issuance = items.find((item) => item.id === "BIR-2316-ISSUANCE-2026");
  assert.equal(alphalist?.dueDate, "2027-01-31");
  assert.equal(issuance?.dueDate, "2027-01-31");
  assert.match(alphalist?.detail ?? "", /authoritative BIR acknowledgement/);
  assert.match(issuance?.obligation ?? "", /Issue BIR Form 2316/);
  assert.match(issuance?.detail ?? "", /ISSUANCE deadline/);
  assert.doesNotMatch(issuance?.obligation ?? "", /file|submit/i);
  assert.notEqual(alphalist?.status, "complete");
  assert.notEqual(issuance?.status, "complete");
});

test("annual reminders never invent filing success when previous year is overdue", () => {
  const items = buildComplianceCalendar({
    today: "2027-02-02", currentMonth: "2027-02",
    applicableMonths: ["2026-12"], legalName: "Annual Testing Inc.",
    philHealthEmployerNo: "00-123456789-3", batches: [],
    includeAnnualObligations: true,
  });
  assert.equal(items.find((item) => item.id === "BIR-1604C-ALPHALIST-2026")?.status, "verification-required");
  assert.equal(items.find((item) => item.id === "BIR-2316-ISSUANCE-2026")?.status, "verification-required");
});

test("government worksheet UX and HTTP download both clearly disclose non-certified status", () => {
  const ui = readFileSync("src/components/workspace/exports.tsx", "utf8");
  const route = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  const exporter = readFileSync("src/lib/exporters.ts", "utf8");
  const calendarRoute = readFileSync("src/app/api/compliance/calendar/route.ts", "utf8");
  assert.ok(calendarRoute.includes("includeAnnualObligations: true"));
  assert.ok(ui.includes("data-government-draft-warning"));
  assert.ok(ui.includes("not certified portal upload files"));
  assert.ok(ui.includes("not Form 2316"));
  assert.ok(route.includes('"X-Linaw-Government-File-Status"'));
  assert.ok(route.includes('"Cache-Control": "private, no-store"'));
  assert.ok(exporter.includes("DRAFT ONLY, not a certified government submission file"));
});
