import assert from "node:assert/strict";
import test from "node:test";
import { segmentPayableTime } from "../src/lib/workforce-payroll";
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
