import assert from "node:assert/strict";
import test from "node:test";
import { payableTimeEvidenceFlagsForPayroll, segmentPayableTime } from "../src/lib/workforce-payroll";
import { evaluatePayrollAssurance } from "../src/lib/payroll-assurance";

const shift = {
  start: "20:00",
  end: "00:00",
  breakMinutes: 60,
  spansMidnight: true,
};

function payrollFromFlags(flags: string[]) {
  return evaluatePayrollAssurance([{
    id: 10,
    employeeId: 101,
    grossPay: "1500.00",
    deductions: "300.00",
    netPay: "1200.00",
    status: flags.length ? "Exception" : "Ready",
    lineItems: [
      {code:"BASIC",label:"Basic",amount:"1500.00"},
      {code:"SSS",label:"SSS",amount:"-100.00"},
      {code:"PHIC",label:"PhilHealth",amount:"-100.00"},
      {code:"HDMF",label:"Pag-IBIG",amount:"-100.00"},
    ],
    trace: {flags},
  }], []);
}

test("unknown break location across daytime/night rates fails release rather than guessing premium buckets", () => {
  const segmented = segmentPayableTime({
    punch: {
      id: 17,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T12:00:00.000Z",
      timeOut: "2026-10-05T16:00:00.000Z",
    },
    shift,
  });
  assert.equal(segmented.allocationComplete, false);
  assert.ok(segmented.flags.some(flag => flag.includes("cross-boundary premium allocation requires review")));
  assert.ok(segmented.segments.some(segment => segment.night));
  assert.ok(segmented.segments.some(segment => !segment.night));
  const assurance = payrollFromFlags(segmented.flags);
  assert.ok(assurance.findings.some(f => f.code === "WFM_PREMIUM_ALLOCATION_UNVERIFIED" && f.blocking));
});

test("located break is excluded exactly before and after night-rate boundary", () => {
  const segmented = segmentPayableTime({
    punch: {
      id: 17,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T12:00:00.000Z",
      timeOut: "2026-10-05T16:00:00.000Z",
      breakStart: "2026-10-05T13:00:00.000Z",
      breakEnd: "2026-10-05T14:00:00.000Z",
    },
    shift,
  });
  assert.equal(segmented.allocationComplete, true);
  assert.deepEqual(segmented.flags, []);
  assert.equal(segmented.segments.reduce((total,part)=>total+part.minutes,0),180);
  assert.equal(segmented.segments.filter(part=>!part.night).reduce((sum,part)=>sum+part.minutes,0),60);
  assert.equal(segmented.segments.filter(part=>part.night).reduce((sum,part)=>sum+part.minutes,0),120);
  assert.equal(payrollFromFlags(segmented.flags).summary.blocking,0);
});

test("oversized punch warning survives the engine trace and blocks checker/release assurance", () => {
  const segmented = segmentPayableTime({
    punch: {
      id: 990,
      workDate: "2026-10-05",
      timeIn: "2026-10-05T00:00:00.000Z",
      timeOut: "2026-10-14T00:00:00.000Z",
    },
    shift: { start: "08:00", end: "17:00", breakMinutes: 0 },
  });
  assert.equal(segmented.allocationComplete, false);
  assert.deepEqual(segmented.segments, []);
  const traceFlags = payableTimeEvidenceFlagsForPayroll(segmented, 9 * 24 * 60);
  assert.ok(traceFlags.some((flag) => flag.includes("WFM_PREMIUM_ALLOCATION_UNVERIFIED")));
  const result = payrollFromFlags(traceFlags.map((flag) => `2026-10-05: ${flag}`));
  assert.ok(result.findings.some((finding) =>
    finding.code === "WFM_PREMIUM_ALLOCATION_UNVERIFIED" && finding.blocking
  ));
  assert.ok(result.summary.blocking > 0);
});

test("missing segmentation of worked time cannot be ignored even without pricing classes", () => {
  const traceFlags = payableTimeEvidenceFlagsForPayroll({
    segments: [],
    attendanceCalendarDates: [],
    allocationComplete: false,
    flags: ["Payable-time segmentation requires valid 24-hour shift start/end times."],
  }, 120);
  assert.ok(traceFlags.some((flag) => flag.startsWith("WFM_PREMIUM_ALLOCATION_UNVERIFIED:")));
  assert.ok(payrollFromFlags(traceFlags).summary.blocking > 0);
});

test("unpriced worked attendance fails closed even when upstream segment flags are absent", () => {
  for (const reportedComplete of [false, true]) {
    const flagged = payableTimeEvidenceFlagsForPayroll({
      segments: [],
      attendanceCalendarDates: [],
      allocationComplete: reportedComplete,
      flags: [],
    }, 180);
    assert.equal(flagged.length, 1);
    assert.match(flagged[0], /^WFM_PREMIUM_ALLOCATION_UNVERIFIED:/);
    assert.ok(payrollFromFlags(flagged).summary.blocking > 0);
  }
  assert.deepEqual(payableTimeEvidenceFlagsForPayroll({
    segments: [],
    attendanceCalendarDates: [],
    allocationComplete: false,
    flags: [],
  }, 0), [], "no independent worked-time minutes means there is no premium amount to allocate");
});

test("explicit premium blocker cannot be suppressed by a wrongly completed segmentation", () => {
  const traceFlags = payableTimeEvidenceFlagsForPayroll({
    segments: [{
      punchId: 992, sourceWorkDate: "2026-10-05", calendarDate: "2026-10-05",
      start: "2026-10-05T00:00:00.000Z", end: "2026-10-05T01:00:00.000Z",
      minutes: 60, overtime: false, night: false,
    }],
    attendanceCalendarDates: ["2026-10-05"],
    allocationComplete: true,
    flags: ["WFM_PREMIUM_ALLOCATION_UNVERIFIED: manual correction is mandatory"],
  }, 60);
  assert.equal(traceFlags.length, 1);
  assert.match(traceFlags[0], /^WFM_PREMIUM_ALLOCATION_UNVERIFIED:/);
  assert.ok(payrollFromFlags(traceFlags).summary.blocking > 0);
});

test("invalid worked-minute totals cannot be silently priced as zero", () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0.5]) {
    const evidence = payableTimeEvidenceFlagsForPayroll({
      segments: [],
      attendanceCalendarDates: [],
      allocationComplete: true,
      flags: [],
    }, invalid);
    assert.equal(evidence.length, 1, `invalid derived worked time: ${String(invalid)}`);
    assert.match(evidence[0], /^WFM_PREMIUM_ALLOCATION_UNVERIFIED:/);
    assert.ok(payrollFromFlags(evidence).summary.blocking > 0);
  }
});

test("invalid Gregorian punch work dates are rejected without payroll premium guesses", () => {
  for (const workDate of ["2026-02-30", "2026-13-01", "2026-00-09", "2026-2-09", "not-a-date"]) {
    const segmentation = segmentPayableTime({
      punch: {
        id: 993,
        workDate,
        timeIn: "2026-10-05T01:00:00.000Z",
        timeOut: "2026-10-05T03:00:00.000Z",
      },
      shift: { start: "08:00", end: "17:00", breakMinutes: 0 },
    });
    assert.equal(segmentation.allocationComplete, false, workDate);
    assert.deepEqual(segmentation.segments, []);
    assert.match(segmentation.flags.join(" "), /real YYYY-MM-DD work date/);
    const evidence = payableTimeEvidenceFlagsForPayroll(segmentation, 120);
    assert.ok(payrollFromFlags(evidence).summary.blocking > 0);
  }
  const leapDay = segmentPayableTime({
    punch: {
      id: 994, workDate: "2024-02-29",
      timeIn: "2024-02-29T01:00:00.000Z",
      timeOut: "2024-02-29T02:00:00.000Z",
    },
    shift: { start: "08:00", end: "17:00", breakMinutes: 0 },
  });
  assert.equal(leapDay.allocationComplete, true);
  assert.equal(leapDay.segments.reduce((sum, segment) => sum + segment.minutes, 0), 60);
  assert.deepEqual(payableTimeEvidenceFlagsForPayroll(leapDay, 60), []);
});

test("partial or malformed actual break timestamps block payroll even in one daytime rate bucket", () => {
  const malformedBreaks = [
    { breakStart: "2026-10-05T04:00:00.000Z", breakEnd: null },
    { breakStart: null, breakEnd: "2026-10-05T05:00:00.000Z" },
    { breakStart: "not-a-timestamp", breakEnd: "2026-10-05T05:00:00.000Z" },
    { breakStart: "", breakEnd: null },
    { breakStart: "2026-10-05T04:00:00.000Z", breakEnd: "2026-10-05T09:00:00.000Z" },
    { breakStart: "2026-10-05T05:00:00.000Z", breakEnd: "2026-10-05T04:00:00.000Z" },
  ];
  for (const [index, evidence] of malformedBreaks.entries()) {
    const segmented = segmentPayableTime({
      punch: {
        id: 995 + index, workDate: "2026-10-05",
        timeIn: "2026-10-05T00:00:00.000Z",
        timeOut: "2026-10-05T08:00:00.000Z",
        ...evidence,
      },
      shift: { start: "08:00", end: "16:00", breakMinutes: 60 },
    });
    assert.equal(segmented.allocationComplete, false, `case ${index}`);
    const flags = payableTimeEvidenceFlagsForPayroll(segmented, 420);
    assert.ok(flags.some(flag => flag.startsWith("WFM_PREMIUM_ALLOCATION_UNVERIFIED:")), `case ${index}`);
    assert.ok(payrollFromFlags(flags).summary.blocking > 0, `case ${index}`);
  }
});

test("valid located daytime break remains payable and does not block", () => {
  const segmented = segmentPayableTime({
    punch: {
      id: 1002, workDate: "2026-10-05",
      timeIn: "2026-10-05T00:00:00.000Z",
      timeOut: "2026-10-05T08:00:00.000Z",
      breakStart: "2026-10-05T04:00:00.000Z",
      breakEnd: "2026-10-05T05:00:00.000Z",
    },
    shift: { start: "08:00", end: "16:00", breakMinutes: 60 },
  });
  assert.equal(segmented.allocationComplete, true);
  assert.equal(segmented.segments.reduce((sum, segment) => sum + segment.minutes, 0), 420);
  assert.deepEqual(payableTimeEvidenceFlagsForPayroll(segmented, 420), []);
});

test("unlocated break confined to one premium bucket stays reviewable", () => {
  const segmented = segmentPayableTime({
    punch: {
      id: 991, workDate: "2026-10-05",
      timeIn: "2026-10-05T00:00:00.000Z",
      timeOut: "2026-10-05T08:00:00.000Z",
    },
    shift: { start: "08:00", end: "16:00", breakMinutes: 60 },
  });
  assert.equal(segmented.allocationComplete, false);
  assert.deepEqual(payableTimeEvidenceFlagsForPayroll(segmented, 420), []);
});

test("payroll engine and approval/release routes wire the same hard-blocking assurance", async () => {
  const { readFileSync } = await import("node:fs");
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  const submit = readFileSync("src/app/api/payroll-runs/[id]/submit-review/route.ts", "utf8");
  const approve = readFileSync("src/app/api/approvals/[id]/route.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  assert.ok(engine.includes("payableTimeEvidenceFlagsForPayroll(\n      segmentation,\n      derived.workedMinutes,"));
  assert.ok(submit.includes("finding.blocking"));
  assert.ok(approve.includes("finding.blocking"));
  assert.ok(release.includes("finding.blocking"));
  assert.ok(submit.includes("blockingFindings: blockers"));
  assert.ok(approve.includes("blockingFindings: blockers"));
  assert.ok(release.includes("blockingFindings,"));
});
