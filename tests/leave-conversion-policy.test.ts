import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  approvedLeaveConversionCap, leaveConversionAllowance, validateLeaveConversionDays,
} from "../src/lib/leave-conversion-policy";

test("no organization/type cap means leave monetization is disabled, even with positive balance", () => {
  assert.equal(approvedLeaveConversionCap(12, "Vacation Leave", {}), null);
  assert.equal(leaveConversionAllowance({
    available: 250, reserved: 0, alreadyConverted: 0, policyAnnualDays: 250,
    approvedAnnualConversionCap: null,
  }), 0);
});

test("explicit tenant and leave type authorizes only its configured annual limit", () => {
  const env = { LEAVE_CONVERSION_MAX_DAYS_JSON: '{"12":{"vacation leave":5.5},"14":{"service incentive leave":5}}' };
  assert.equal(approvedLeaveConversionCap(12, " VACATION LEAVE ", env), 5.5);
  assert.equal(approvedLeaveConversionCap(14, "service incentive leave", env), 5);
  assert.equal(approvedLeaveConversionCap(12, "Service Incentive Leave", env), null);
  assert.equal(approvedLeaveConversionCap(13, "vacation leave", env), null);
  assert.equal(approvedLeaveConversionCap(0, "vacation leave", env), null);
});

test("policy and balance cap block malicious 200-day conversion and duplicate reservation", () => {
  const limits = {
    available: 220, reserved: 3, alreadyConverted: 3,
    policyAnnualDays: 15, approvedAnnualConversionCap: 5.5,
  };
  assert.equal(leaveConversionAllowance(limits), 2.5);
  assert.ok(200 > leaveConversionAllowance(limits));
  assert.equal(leaveConversionAllowance({ ...limits, reserved: 5.5, alreadyConverted: 5.5 }), 0);
  assert.equal(leaveConversionAllowance({ ...limits, available: 2.5, reserved: 2 }), 0.5);
});

test("policy parsing and fractional-day inputs fail closed", () => {
  for (const raw of ['{"12":{"vacation leave":2000}}','{"12":{"vacation leave":"5"}}','{"12":{"vacation leave":0}}','{"12":{"vacation leave":5.55}}','["invalid"]',"{"]) {
    assert.equal(approvedLeaveConversionCap(12, "Vacation Leave", { LEAVE_CONVERSION_MAX_DAYS_JSON: raw }), null);
  }
  for (const v of [200.03, 0, -1, Number.NaN, Infinity, "2.5", null, 367]) {
    assert.equal(validateLeaveConversionDays(v), false);
  }
  assert.equal(validateLeaveConversionDays(2.5), true);
});

test("route locks authoritative balance and records conversion and audit in the same transaction", () => {
  const source = readFileSync("src/app/api/leave/conversion/route.ts", "utf8");
  assert.ok(source.includes("await db.transaction(async (tx) =>"));
  assert.ok(source.includes('.for("update")'));
  assert.ok(source.includes("approvedLeaveConversionCap(organizationId, leaveType)"));
  assert.ok(source.indexOf("tx.insert(leaveConversions)") < source.indexOf("tx.insert(auditEvents)"));
  assert.ok(source.includes("LEAVE_CONVERSION_CAP_EXCEEDED"));
  assert.ok(source.includes("year !== manilaYear"));
});
