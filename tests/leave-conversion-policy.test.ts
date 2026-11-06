import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  approvedLeaveConversionCap, leaveConversionAllowance, leaveConversionTaxReviewAcknowledged, validateLeaveConversionDays,
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
  assert.ok(source.includes("const daysConverted: unknown = body.daysConverted"), "route must not coerce booleans or strings into payable leave days");
  assert.ok(source.includes("year !== manilaYear"));
});

test("tax review attestation is a separate fail-closed organization gate", () => {
  assert.equal(leaveConversionTaxReviewAcknowledged(12, {}), false);
  assert.equal(leaveConversionTaxReviewAcknowledged(12, { LEAVE_CONVERSION_TAX_REVIEWED_ORG_IDS: "13" }), false);
  const env = { LEAVE_CONVERSION_TAX_REVIEWED_ORG_IDS: "12, 14,0,12junk,9007199254740992" };
  assert.equal(leaveConversionTaxReviewAcknowledged(12, env), true);
  assert.equal(leaveConversionTaxReviewAcknowledged(14, env), true);
  assert.equal(leaveConversionTaxReviewAcknowledged(0, env), false);
  assert.equal(leaveConversionTaxReviewAcknowledged(13, env), false);
});

test("approved leave cash conversion enforces fiscal review and privileged MFA", () => {
  const route = readFileSync("src/app/api/leave/conversion/route.ts", "utf8");
  assert.ok(route.includes("leaveConversionTaxReviewAcknowledged(organizationId)"));
  assert.ok(route.includes("LEAVE_CONVERSION_TAX_REVIEW_REQUIRED"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("Number.isSafeInteger(Math.round(cashAmount * 100))"));
  assert.ok(route.includes("eq(employees.organizationId, organizationId)"));
});

test("the 12-day leave monetization exemption is annual and splits a request that crosses it", async () => {
  const { splitLeaveConversionExemption, LEAVE_CONVERSION_ANNUAL_EXEMPT_DAYS } = await import("../src/lib/leave-conversion-policy");
  assert.equal(LEAVE_CONVERSION_ANNUAL_EXEMPT_DAYS, 12);
  // First conversion of the year, within the limit: wholly exempt.
  assert.deepEqual(splitLeaveConversionExemption({ daysConverted: 10, dailyRate: 1363.64, exemptDaysAlreadyUsed: 0 }),
    [{ daysConverted: 10, cashAmount: 13636.4, taxExempt: true }]);
  // A second 10-day conversion after 10 exempt days: 2 exempt + 8 taxable (previously all 10 were marked exempt).
  assert.deepEqual(splitLeaveConversionExemption({ daysConverted: 10, dailyRate: 1363.64, exemptDaysAlreadyUsed: 10 }), [
    { daysConverted: 2, cashAmount: 2727.28, taxExempt: true },
    { daysConverted: 8, cashAmount: 10909.12, taxExempt: false },
  ]);
  // One 13-day conversion: 12 exempt + 1 taxable (previously wholly taxable).
  assert.deepEqual(splitLeaveConversionExemption({ daysConverted: 13, dailyRate: 1000, exemptDaysAlreadyUsed: 0 }), [
    { daysConverted: 12, cashAmount: 12000, taxExempt: true },
    { daysConverted: 1, cashAmount: 1000, taxExempt: false },
  ]);
  // Exemption already used up: wholly taxable.
  assert.deepEqual(splitLeaveConversionExemption({ daysConverted: 3, dailyRate: 1000, exemptDaysAlreadyUsed: 12 }),
    [{ daysConverted: 3, cashAmount: 3000, taxExempt: false }]);
  // Tenths of a day and odd centavos: parts add up exactly to the whole.
  const parts = splitLeaveConversionExemption({ daysConverted: 2.5, dailyRate: 1363.67, exemptDaysAlreadyUsed: 10.7 });
  assert.deepEqual(parts.map((part) => [part.daysConverted, part.taxExempt]), [[1.3, true], [1.2, false]]);
  assert.equal(Math.round(parts.reduce((sum, part) => sum + part.cashAmount, 0) * 100), Math.round(2.5 * 136367));
  assert.throws(() => splitLeaveConversionExemption({ daysConverted: 0, dailyRate: 1000, exemptDaysAlreadyUsed: 0 }));
});
