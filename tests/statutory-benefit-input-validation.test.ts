import assert from "node:assert/strict";
import test from "node:test";
import {evaluateStatutoryLeave, type StatutoryLeaveInput} from "../src/lib/statutory-leave";
import {
  addCalendarDays, addYears, adscWindow, computeAdsc, computeMaternityBenefit, computeSicknessBenefit, sicknessDeadlines,
  type MaternityBenefitInput, type MonthlyContribution, type SicknessBenefitInput,
} from "../src/lib/sss-employer-benefits";

const contributions: MonthlyContribution[] = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
  .map(month => ({month, monthlySalaryCredit: 12000}));
const maternity: MaternityBenefitInput = {contributions, contingencyDate: "2026-08-10", caseKind: "LIVE_BIRTH"};
const sickness: SicknessBenefitInput = {contributions, sicknessStartDate: "2026-08-10", confinementDays: 10, approvedDays: 10, companySickLeaveExhausted: true};
const leave = (input: unknown) => evaluateStatutoryLeave(input as StatutoryLeaveInput);
const invalidNumbers: unknown[] = [NaN, Infinity, -Infinity, -1, undefined, null, "12"];

test("invalid service records cannot bypass any minimum-service comparison", () => {
  for (const value of invalidNumbers) {
    assert.throws(() => leave({kind: "SERVICE_INCENTIVE", aggregateServiceMonths: value}), RangeError);
    assert.throws(() => leave({kind: "SOLO_PARENT", serviceMonths: value, soloParentStatusConfirmed: true}), RangeError);
    assert.throws(() => leave({kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: value, surgeryCausedByGynecologicalDisorder: true, grossMonthlyCompensation: 30000}), RangeError);
  }
  assert.throws(() => leave({kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: 13, surgeryCausedByGynecologicalDisorder: true, grossMonthlyCompensation: 30000}), RangeError);
});

test("required previous-delivery and requested-day fields are never defaulted to zero", () => {
  for (const value of [...invalidNumbers, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => leave({kind: "PATERNITY", marriedToLegitimateSpouse: true, cohabiting: true, priorPaidDeliveries: value}), RangeError);
    assert.throws(() => leave({kind: "VAWC", victimSurvivorOrChildOfEmployee: true, requestedDays: value}), RangeError);
  }
});

test("optional counters may be omitted, but explicitly malformed counters are rejected", () => {
  const candidates = [
    {kind: "MATERNITY_LIVE_BIRTH", key: "allocatedToFatherOrCaregiver"},
    {kind: "SOLO_PARENT", serviceMonths: 6, soloParentStatusConfirmed: true, key: "usedThisYear"},
    {kind: "VAWC", victimSurvivorOrChildOfEmployee: true, requestedDays: 2, key: "protectionOrderExtensionDays"},
  ];
  for (const {key, ...input} of candidates) {
    assert.ok(leave(input).eligible);
    for (const value of [null, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "0"]) {
      assert.throws(() => leave({...input, [key]: value}), RangeError);
    }
  }
});

test("missing or truthy non-boolean eligibility records cannot grant a leave", () => {
  for (const value of [undefined, null, "false", 1, {}]) {
    assert.throws(() => leave({kind: "PATERNITY", marriedToLegitimateSpouse: value, cohabiting: true, priorPaidDeliveries: 0}), RangeError);
    assert.throws(() => leave({kind: "SOLO_PARENT", serviceMonths: 6, soloParentStatusConfirmed: value}), RangeError);
    assert.throws(() => leave({kind: "VAWC", victimSurvivorOrChildOfEmployee: value, requestedDays: 2}), RangeError);
  }
  assert.throws(() => leave({kind: "MATERNITY_LIVE_BIRTH", soloParent: "false"}), RangeError);
  assert.throws(() => leave({kind: "SERVICE_INCENTIVE", aggregateServiceMonths: 12, alreadyEnjoysSameBenefit: "false"}), RangeError);
});

test("unknown leave kinds and non-record inputs are rejected explicitly", () => {
  for (const input of [null, undefined, [], "PATERNITY", {}, {kind: "__proto__"}, {kind: "UNKNOWN"}]) {
    assert.throws(() => leave(input), RangeError);
  }
});

test("non-finite or unsafe compensation never becomes a maximum-pay recommendation", () => {
  for (const value of [...invalidNumbers, Number.MAX_VALUE]) {
    assert.throws(() => leave({kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: 6, surgeryCausedByGynecologicalDisorder: true, grossMonthlyCompensation: value}), RangeError);
  }
});

test("all sickness day counters reject malformed values, including previously paid limits", () => {
  for (const key of ["confinementDays", "approvedDays", "daysPaidThisCalendarYear", "daysPaidForSameIllness"]) {
    for (const value of [NaN, Infinity, -Infinity, -1, null, 0.5, "10", Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => computeSicknessBenefit({...sickness, [key]: value} as SicknessBenefitInput), RangeError);
    }
  }
  for (const value of [null, undefined, "false", 1]) {
    assert.throws(() => computeSicknessBenefit({...sickness, companySickLeaveExhausted: value} as unknown as SicknessBenefitInput), RangeError);
  }
});

test("invalid maternity case and pay inputs cannot select a benefit or bypass validation via exemption", () => {
  for (const value of [null, undefined, "UNKNOWN"]) {
    assert.throws(() => computeMaternityBenefit({...maternity, caseKind: value} as MaternityBenefitInput), RangeError);
  }
  for (const value of [NaN, Infinity, -Infinity, -1, null, "800", Number.MAX_VALUE]) {
    for (const differentialExemptByDole of [false, true]) {
      assert.throws(() => computeMaternityBenefit({...maternity, fullPayPerLeaveDay: value, differentialExemptByDole} as MaternityBenefitInput), RangeError);
    }
  }
  assert.throws(() => computeMaternityBenefit({...maternity, soloParent: "false"} as unknown as MaternityBenefitInput), RangeError);
  assert.throws(() => computeMaternityBenefit({...maternity, applicationFiledOn: ""}), RangeError);
});

test("malformed contribution records are rejected even when they lie outside the calculation window", () => {
  for (const paidOn of ["", "2025-02-30", null, 1]) {
    assert.throws(() => computeAdsc([...contributions, {month: "2024-01", monthlySalaryCredit: 12000, paidOn}] as MonthlyContribution[], maternity.contingencyDate), RangeError);
  }
  for (const input of [null, {}, [null], [{month: null, monthlySalaryCredit: 12000}]]) {
    assert.throws(() => computeAdsc(input as MonthlyContribution[], maternity.contingencyDate), RangeError);
  }
});

test("date offsets and derived deadlines stay within the supported calendar format", () => {
  for (const value of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => addCalendarDays("2026-08-10", value), RangeError);
    assert.throws(() => addYears("2026-08-10", value), RangeError);
  }
  assert.throws(() => addCalendarDays("9999-12-31", 1), RangeError);
  assert.throws(() => addYears("9999-01-01", 1), RangeError);
  assert.throws(() => addYears("0100-01-01", -1), RangeError);
  assert.equal(addCalendarDays("2026-08-10", -5), "2026-08-05");
  assert.equal(addYears("2024-02-29", 1), "2025-02-28");
  assert.equal(addYears("0100-01-01", 1), "0101-01-01");
  assert.throws(() => adscWindow("0100-08-10"), RangeError);
  assert.equal(adscWindow("0102-08-10").windowStart, "0101-04");
});

test("unknown confinement kinds and invalid hospital dates cannot generate filing deadlines", () => {
  for (const confinement of ["UNKNOWN", null, undefined]) {
    assert.throws(() => sicknessDeadlines({confinement, confinementStart: "2026-08-10"} as Parameters<typeof sicknessDeadlines>[0]), RangeError);
  }
  assert.throws(() => sicknessDeadlines({confinement: "HOSPITAL", confinementStart: "invalid", dischargeDate: "2026-08-12"}), RangeError);
  assert.throws(() => sicknessDeadlines({confinement: "HOSPITAL", confinementStart: "2026-08-10", dischargeDate: "2026-08-09"}), RangeError);
});

test("finite inputs still cannot overflow derived day counts or monetary amounts", () => {
  assert.throws(() => leave({kind: "VAWC", victimSurvivorOrChildOfEmployee: true, requestedDays: 1, protectionOrderExtensionDays: Number.MAX_SAFE_INTEGER}), RangeError);
  assert.throws(() => leave({kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: 6, surgeryCausedByGynecologicalDisorder: true, grossMonthlyCompensation: 9e13}), RangeError);
  assert.throws(() => computeMaternityBenefit({...maternity, fullPayPerLeaveDay: 1e12}), RangeError);
  assert.throws(() => computeAdsc([{month: "2025-10", monthlySalaryCredit: Number.MAX_VALUE}], maternity.contingencyDate), RangeError);
});

test("all optional factual flags reject strings instead of using JavaScript truthiness", () => {
  for (const field of ["alreadyEnjoysSameBenefit", "grantsAtLeastFivePaidVacationDays", "establishmentRegularlyEmploysFewerThanTen", "exemptedByLaborSecretary"]) {
    assert.throws(() => leave({kind: "SERVICE_INCENTIVE", aggregateServiceMonths: 12, [field]: "false"}), RangeError);
  }
  for (const field of ["soloParent", "electsUnpaidExtension", "employerNotifiedOfPregnancy"]) {
    assert.throws(() => leave({kind: "MATERNITY_LIVE_BIRTH", [field]: "false"}), RangeError);
  }
  assert.throws(() => leave({kind: "PATERNITY", marriedToLegitimateSpouse: true, cohabiting: "false", priorPaidDeliveries: 0}), RangeError);
  assert.throws(() => leave({kind: "GYNECOLOGICAL_SURGERY", serviceMonthsInLastTwelve: 6, surgeryCausedByGynecologicalDisorder: "false", grossMonthlyCompensation: 30000}), RangeError);
  assert.throws(() => computeMaternityBenefit({...maternity, differentialExemptByDole: "false"} as unknown as MaternityBenefitInput), RangeError);
});

test("validation errors do not echo untrusted date or month contents", () => {
  const privateMarker="FICTIONAL-PRIVATE-INPUT";
  for(const call of [()=>addCalendarDays(privateMarker,1),()=>computeAdsc([{month:privateMarker,monthlySalaryCredit:12000}],maternity.contingencyDate)]){
    assert.throws(call,(error:unknown)=>error instanceof RangeError&&!error.message.includes(privateMarker));
  }
});

test("valid fractional service, omitted optional fields and benefit amounts retain their existing behavior", () => {
  assert.equal(leave({kind: "SOLO_PARENT", serviceMonths: 5.5, soloParentStatusConfirmed: true}).eligible, false);
  assert.equal(leave({kind: "SOLO_PARENT", serviceMonths: 6.5, soloParentStatusConfirmed: true}).entitled, 7);
  assert.equal(leave({kind: "PATERNITY", marriedToLegitimateSpouse: true, cohabiting: true, priorPaidDeliveries: 0}).entitled, 7);
  const before=structuredClone(contributions);
  assert.equal(computeMaternityBenefit(maternity).sssBenefit, 42000);
  assert.equal(computeSicknessBenefit({...sickness, daysPaidThisCalendarYear: 115}).sssBenefit, 1800);
  assert.deepEqual(contributions,before);
});
