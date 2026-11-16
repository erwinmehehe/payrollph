import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStatutoryLeave, STATUTORY_LEAVE_RULES } from "../src/lib/statutory-leave";
import {
  addYears, adscWindow, computeAdsc, computeMaternityBenefit, computeSicknessBenefit, sicknessDeadlines,
  type MonthlyContribution,
} from "../src/lib/sss-employer-benefits";

/**
 * Hand-derived fictional cases. Contingency 2026-08-10 falls in Q3, so the semester is Apr-Sep 2026 and
 * the twelve months run 2025-04 to 2026-03. Six highest MSCs of twelve@12,000 (Oct-Mar) = 72,000; 72,000/180 = 400.
 */
const months = (from: string, count: number, msc: number): MonthlyContribution[] => {
  const [y, m] = from.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const idx = (y * 12 + (m - 1)) + i;
    return { month: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`, monthlySalaryCredit: msc };
  });
};
const base = [...months("2025-04", 6, 10000), ...months("2025-10", 6, 12000)];

test("semester of contingency and twelve-month window across all four quarters", () => {
  assert.deepEqual(adscWindow("2026-08-10"), { semesterStart: "2026-04", semesterEnd: "2026-09", windowStart: "2025-04", windowEnd: "2026-03" });
  assert.deepEqual(adscWindow("2026-02-15"), { semesterStart: "2025-10", semesterEnd: "2026-03", windowStart: "2024-10", windowEnd: "2025-09" });
  assert.deepEqual(adscWindow("2026-01-15"), adscWindow("2026-02-15"));
  assert.deepEqual(adscWindow("2026-05-04"), { semesterStart: "2026-01", semesterEnd: "2026-06", windowStart: "2025-01", windowEnd: "2025-12" });
  assert.deepEqual(adscWindow("2026-11-20"), { semesterStart: "2026-07", semesterEnd: "2026-12", windowStart: "2025-07", windowEnd: "2026-06" });
});

test("ADSC uses six highest MSCs in the window and ignores in-semester and pre-window months", () => {
  const withNoise = [...base, { month: "2026-05", monthlySalaryCredit: 20000 }, { month: "2025-03", monthlySalaryCredit: 20000 }];
  const r = computeAdsc(withNoise, "2026-08-10");
  assert.equal(r.contributionMonths, 12);
  assert.deepEqual(r.usedCredits, [12000, 12000, 12000, 12000, 12000, 12000]);
  assert.equal(r.totalMsc, 72000);
  assert.equal(r.adsc, 400);
  assert.equal(r.eligible, true);
});

test("a contribution paid on or after the semester start does not count", () => {
  const late = base.map((c) => (c.month === "2026-03" ? { ...c, paidOn: "2026-04-01" } : { ...c, paidOn: "2026-03-15" }));
  const r = computeAdsc(late, "2026-08-10");
  assert.equal(r.contributionMonths, 11);
  assert.equal(r.totalMsc, 70000); // five at 12,000 plus the highest remaining 10,000
});

test("MSC is capped at 20,000: six capped credits give ADSC 666.67 and 70,000.00 for 105 days", () => {
  const high = [...months("2025-04", 6, 10000), ...months("2025-10", 6, 35000)];
  const r = computeMaternityBenefit({ contributions: high, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH" });
  assert.equal(r.adsc_detail.totalMsc, 120000);
  assert.equal(r.sssBenefit, 70000);
});

test("maternity: 105, 120 solo parent and 60 miscarriage days at 100% of ADSC", () => {
  const live = computeMaternityBenefit({ contributions: base, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH" });
  assert.equal(live.days, 105);
  assert.equal(live.sssBenefit, 42000);
  assert.equal(live.employerAdvance, 42000);
  const solo = computeMaternityBenefit({ contributions: base, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH", soloParent: true });
  assert.equal(solo.days, 120);
  assert.equal(solo.sssBenefit, 48000);
  const lost = computeMaternityBenefit({ contributions: base, contingencyDate: "2026-08-10", caseKind: "MISCARRIAGE_OR_ETP", soloParent: true });
  assert.equal(lost.days, 60);
  assert.equal(lost.sssBenefit, 24000);
  assert.ok(lost.reviewFlags.includes("SOLO_PARENT_EXTRA_15_DAYS_NOT_APPLIED_TO_MISCARRIAGE_OR_ETP"));
});

test("maternity: advance due in 30 days, differential is full pay less the SSS benefit, prescriptive in 10 years", () => {
  const r = computeMaternityBenefit({
    contributions: base, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH", applicationFiledOn: "2026-08-20", fullPayPerLeaveDay: 800,
  });
  assert.equal(r.advanceDueBy, "2026-09-19");
  assert.equal(r.employerDifferential, 42000);
  assert.equal(r.prescriptiveDeadline, "2036-08-10");
  const exempt = computeMaternityBenefit({ contributions: base, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH", differentialExemptByDole: true });
  assert.equal(exempt.employerDifferential, 0);
  const unpriced = computeMaternityBenefit({ contributions: base, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH" });
  assert.equal(unpriced.employerDifferential, null);
  assert.ok(unpriced.reviewFlags.includes("FULL_PAY_PER_LEAVE_DAY_REQUIRED_TO_PRICE_THE_DIFFERENTIAL"));
});

test("fewer than three contribution months: no SSS benefit and an explicit liability flag, never a guess", () => {
  const r = computeMaternityBenefit({
    contributions: months("2025-04", 2, 12000), contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH", fullPayPerLeaveDay: 800,
  });
  assert.equal(r.eligibleForSssBenefit, false);
  assert.equal(r.sssBenefit, 0);
  assert.equal(r.employerDifferential, null);
  assert.ok(r.reviewFlags.some((f) => f.startsWith("EMPLOYER_LIABILITY_WHEN_SSS_INELIGIBLE_NOT_VERIFIED")));
});

test("sickness: 90% of ADSC, day limits, confinement and sick-leave conditions", () => {
  const input = { contributions: base, sicknessStartDate: "2026-08-10", confinementDays: 10, approvedDays: 10, companySickLeaveExhausted: true };
  const ok = computeSicknessBenefit(input);
  assert.equal(ok.dailyBenefit, 360);
  assert.equal(ok.payableDays, 10);
  assert.equal(ok.sssBenefit, 3600);
  const nearYearLimit = computeSicknessBenefit({ ...input, daysPaidThisCalendarYear: 115 });
  assert.equal(nearYearLimit.payableDays, 5);
  assert.equal(nearYearLimit.sssBenefit, 1800);
  const sameIllness = computeSicknessBenefit({ ...input, daysPaidForSameIllness: 235 });
  assert.equal(sameIllness.payableDays, 5);
  assert.deepEqual(computeSicknessBenefit({ ...input, confinementDays: 3 }).blockers, ["CONFINEMENT_UNDER_FOUR_DAYS"]);
  assert.deepEqual(computeSicknessBenefit({ ...input, companySickLeaveExhausted: false }).blockers, ["COMPANY_SICK_LEAVE_NOT_EXHAUSTED"]);
  assert.deepEqual(computeSicknessBenefit({ ...input, daysPaidThisCalendarYear: 120 }).blockers, ["ANNUAL_OR_SAME_ILLNESS_DAY_LIMIT_REACHED"]);
  assert.equal(computeSicknessBenefit({ ...input, daysPaidThisCalendarYear: 120 }).sssBenefit, 0);
});

test("sickness deadlines: home five-day chain, late notice and hospital one-year rule", () => {
  const home = sicknessDeadlines({ confinement: "HOME", confinementStart: "2026-08-10", employeeNotifiedEmployerOn: "2026-08-14" });
  assert.deepEqual(home, {
    employeeNoticeToEmployerBy: "2026-08-15", employerNoticeToSssBy: "2026-08-19", reimbursementClaimBy: "2027-08-10", earliestDeemedStart: null,
  });
  const late = sicknessDeadlines({ confinement: "HOME", confinementStart: "2026-08-10", employeeNotifiedEmployerOn: "2026-08-20" });
  assert.equal(late.earliestDeemedStart, "2026-08-15");
  assert.equal(late.employerNoticeToSssBy, "2026-08-25");
  const hospital = sicknessDeadlines({ confinement: "HOSPITAL", confinementStart: "2026-08-10", dischargeDate: "2026-08-20" });
  assert.equal(hospital.employerNoticeToSssBy, "2027-08-20");
  assert.equal(hospital.employeeNoticeToEmployerBy, null);
  assert.throws(() => sicknessDeadlines({ confinement: "HOSPITAL", confinementStart: "2026-08-10" }), RangeError);
  assert.equal(addYears("2024-02-29", 1), "2025-02-28");
});

test("bad input fails closed instead of producing a number", () => {
  assert.throws(() => computeAdsc([{ month: "2025-13", monthlySalaryCredit: 1 }], "2026-08-10"), RangeError);
  assert.throws(() => computeAdsc([...base, { month: "2025-04", monthlySalaryCredit: 1 }], "2026-08-10"), /Duplicate/);
  assert.throws(() => computeAdsc(base, "2026-02-30"), /Invalid calendar date/);
  assert.throws(() => computeAdsc([{ month: "2025-04", monthlySalaryCredit: -1 }], "2026-08-10"), RangeError);
});

test("service incentive leave: one year, five days, listed exemptions block", () => {
  assert.equal(evaluateStatutoryLeave({ kind: "SERVICE_INCENTIVE", aggregateServiceMonths: 12 }).entitled, 5);
  assert.deepEqual(evaluateStatutoryLeave({ kind: "SERVICE_INCENTIVE", aggregateServiceMonths: 11 }).blockers, ["LESS_THAN_ONE_YEAR_OF_AGGREGATE_SERVICE"]);
  assert.deepEqual(
    evaluateStatutoryLeave({ kind: "SERVICE_INCENTIVE", aggregateServiceMonths: 24, establishmentRegularlyEmploysFewerThanTen: true }).blockers,
    ["EXEMPT_ESTABLISHMENT_UNDER_TEN_EMPLOYEES"],
  );
  const d = evaluateStatutoryLeave({ kind: "SERVICE_INCENTIVE", aggregateServiceMonths: 24, grantsAtLeastFivePaidVacationDays: true });
  assert.equal(d.eligible, false);
  assert.equal(d.entitled, 0);
  assert.ok(d.reviewFlags.some((f) => f.startsWith("SOURCE_NOT_FULLY_VERIFIED")));
});

test("maternity leave: 105/120/60 days, father allocation up to 7, unpaid extension only for live birth", () => {
  assert.equal(evaluateStatutoryLeave({ kind: "MATERNITY_LIVE_BIRTH" }).entitled, 105);
  const solo = evaluateStatutoryLeave({ kind: "MATERNITY_LIVE_BIRTH", soloParent: true, allocatedToFatherOrCaregiver: 7, electsUnpaidExtension: true });
  assert.equal(solo.entitled, 120);
  assert.deepEqual(solo.extras, {
    totalPaidLeaveDays: 120, allocatedToFatherOrCaregiver: 7, paidLeaveDaysForMother: 113, minimumPostnatalDays: 60, unpaidExtensionDays: 30,
  });
  assert.deepEqual(evaluateStatutoryLeave({ kind: "MATERNITY_LIVE_BIRTH", allocatedToFatherOrCaregiver: 8 }).blockers, ["ALLOCATION_EXCEEDS_SEVEN_DAYS"]);
  assert.throws(() => evaluateStatutoryLeave({ kind: "MATERNITY_LIVE_BIRTH", allocatedToFatherOrCaregiver: -1 }), RangeError);
  const lost = evaluateStatutoryLeave({ kind: "MATERNITY_MISCARRIAGE_OR_ETP", soloParent: true });
  assert.equal(lost.entitled, 60);
  assert.ok(lost.reviewFlags.some((f) => f.startsWith("SOLO_PARENT_EXTRA_15_DAYS_NOT_GRANTED")));
});

test("paternity: seven days, married and cohabiting, first four deliveries only", () => {
  const ok = evaluateStatutoryLeave({ kind: "PATERNITY", marriedToLegitimateSpouse: true, cohabiting: true, priorPaidDeliveries: 0 });
  assert.equal(ok.entitled, 7);
  assert.equal(ok.extras.deliveriesRemainingAfterThis, 3);
  assert.deepEqual(
    evaluateStatutoryLeave({ kind: "PATERNITY", marriedToLegitimateSpouse: true, cohabiting: true, priorPaidDeliveries: 4 }).blockers,
    ["FIRST_FOUR_DELIVERIES_ALREADY_PAID"],
  );
  assert.deepEqual(
    evaluateStatutoryLeave({ kind: "PATERNITY", marriedToLegitimateSpouse: false, cohabiting: false, priorPaidDeliveries: 0 }).blockers,
    ["NOT_MARRIED_TO_LEGITIMATE_SPOUSE", "NOT_COHABITING_WITH_SPOUSE"],
  );
});

test("solo parent leave: six months, confirmed status, seven working days, forfeitable", () => {
  assert.equal(evaluateStatutoryLeave({ kind: "SOLO_PARENT", serviceMonths: 6, soloParentStatusConfirmed: true }).entitled, 7);
  assert.equal(evaluateStatutoryLeave({ kind: "SOLO_PARENT", serviceMonths: 6, soloParentStatusConfirmed: true, usedThisYear: 3 }).entitled, 4);
  assert.deepEqual(
    evaluateStatutoryLeave({ kind: "SOLO_PARENT", serviceMonths: 5, soloParentStatusConfirmed: false }).blockers,
    ["LESS_THAN_SIX_MONTHS_OF_SERVICE", "SOLO_PARENT_STATUS_NOT_CONFIRMED"],
  );
  assert.deepEqual(
    evaluateStatutoryLeave({ kind: "SOLO_PARENT", serviceMonths: 12, soloParentStatusConfirmed: true, usedThisYear: 7 }).blockers,
    ["ANNUAL_PARENTAL_LEAVE_ALREADY_USED"],
  );
  assert.equal(STATUTORY_LEAVE_RULES.SOLO_PARENT.cumulative, false);
});

test("VAWC leave: up to ten paid days, extendable only by the protection order", () => {
  assert.equal(evaluateStatutoryLeave({ kind: "VAWC", victimSurvivorOrChildOfEmployee: true, requestedDays: 12 }).entitled, 10);
  assert.equal(evaluateStatutoryLeave({ kind: "VAWC", victimSurvivorOrChildOfEmployee: true, requestedDays: 12, protectionOrderExtensionDays: 5 }).entitled, 12);
  assert.deepEqual(
    evaluateStatutoryLeave({ kind: "VAWC", victimSurvivorOrChildOfEmployee: false, requestedDays: 3 }).blockers,
    ["NOT_A_VICTIM_UNDER_RA_9262"],
  );
});

test("gynecological special leave: six months in the last twelve, two months pay on gross monthly compensation", () => {
  const ok = evaluateStatutoryLeave({
    kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: 6, surgeryCausedByGynecologicalDisorder: true, grossMonthlyCompensation: 30000,
  });
  assert.equal(ok.entitled, 2);
  assert.equal(ok.unit, "months");
  assert.equal(ok.extras.maximumPay, 60000);
  assert.deepEqual(
    evaluateStatutoryLeave({
      kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: 5, surgeryCausedByGynecologicalDisorder: true, grossMonthlyCompensation: 30000,
    }).blockers,
    ["LESS_THAN_SIX_MONTHS_SERVICE_IN_LAST_TWELVE"],
  );
});

test("every rule cites a source and none claims verification it does not have", () => {
  for (const rule of Object.values(STATUTORY_LEAVE_RULES)) {
    assert.match(rule.url, /^https:\/\//);
    assert.ok(rule.citation.length > 0);
  }
  assert.equal(STATUTORY_LEAVE_RULES.SERVICE_INCENTIVE.verification, "SUMMARY_ONLY");
});
