import test from "node:test";
import assert from "node:assert/strict";
import { releasedBir2316Withholding, finalPayBir2316Withholding, type WithholdingEntry, type WithholdingScope } from "../src/lib/bir-2316-withholding";
import { reviewBir2316Summary } from "../src/lib/bir-2316-reconciliation";
import { computeFinalPay } from "../src/lib/final-pay";
const scope = (): WithholdingScope => ({ organizationId: 1, employeeId: 2, legalEntityId: 3, taxYear: 2025, before: "1000.00", expectedAdjustment: "200.00", adjustmentId: 9, boundRunId: 4, historicalCount: 0 });
const entry = (): WithholdingEntry => ({ id: 5, runId: 4, organizationId: 1, employeeId: 2, legalEntityId: 3, payDate: "2025-12-31", status: "Released", lineItems: [{ code: "WHT", amount: "-1000.00" }, { code: "YE-TAX-9", amount: "-200.00" }] });
test("released withholding uses signed actual WHT and bound YE lines, including refunds", () => {
  assert.deepEqual(releasedBir2316Withholding(scope(), [entry()]), { actualPresentWithheld: "1200.00", appliedAdjustment: "200.00", issues: [], entryIds: [5] });
  const e = entry(); e.lineItems = [{ code: "WHT", amount: "-1000.00" }, { code: "YE-TAX-9", amount: "200.00" }];
  const r = releasedBir2316Withholding({ ...scope(), expectedAdjustment: "-200.00" }, [e]);
  assert.equal(r.actualPresentWithheld, "800.00"); assert.equal(r.appliedAdjustment, "-200.00"); assert.deepEqual(r.issues, []);
});
test("approved payroll is not actual withholding; absent settlement line remains unknown", () => {
  const e = entry(); e.status = "Approved";
  assert.equal(releasedBir2316Withholding(scope(), [e]).actualPresentWithheld, null);
  e.status = "Released"; e.lineItems = [{ code: "WHT", amount: "-1000.00" }];
  const r = releasedBir2316Withholding(scope(), [e]); assert.equal(r.actualPresentWithheld, "1000.00"); assert.equal(r.appliedAdjustment, null);
});
test("tenant, worker, employer, year, cutoff and binding mismatches fail closed", () => {
  for (const change of [{ organizationId: 99 }, { employeeId: 99 }, { legalEntityId: 99 }, { payDate: "2024-12-31" }, { runId: 99 }]) {
    assert.equal(releasedBir2316Withholding(scope(), [{ ...entry(), ...change }]).actualPresentWithheld, null);
  }
  assert.equal(releasedBir2316Withholding({ ...scope(), throughDate: "2025-12-15" }, [entry()]).actualPresentWithheld, null);
  assert.equal(releasedBir2316Withholding({ ...scope(), historicalCount: 1 }, [entry()]).actualPresentWithheld, null);
  assert.equal(releasedBir2316Withholding(scope(), [entry(), entry()]).actualPresentWithheld, null);
});
test("unknown tax codes, malformed money, missing or duplicate WHT and duplicate settlement lines are blocked", () => {
  for (const lines of [[], [{ code: "WHT", amount: "" }], [{ code: "WHT", amount: "1.00" }], [{ code: "WHT", amount: "-1.001" }],
    [{ code: "TAX-UNKNOWN", amount: "-1000.00" }], [{ code: "WHT", amount: "-1000.00" }, { code: "WHT", amount: "0.00" }]]) {
    const r = releasedBir2316Withholding(scope(), [{ ...entry(), lineItems: lines }]); assert.ok(r.issues.length); assert.equal(r.actualPresentWithheld, null);
  }
  const e = entry(); (e.lineItems as unknown[]).push({ code: "YE-TAX-9", amount: "0.00" });
  assert.ok(releasedBir2316Withholding(scope(), [e]).issues.length);
});
test("taxable earnings labels are not mistaken for withholding; opening variance and unbound collections remain unknown", () => {
  const e = entry(); (e.lineItems as unknown[]).push({ code: "EARN-10", label: "Taxable allowance", amount: "500.00" });
  assert.deepEqual(releasedBir2316Withholding(scope(), [e]).issues, []);
  assert.equal(releasedBir2316Withholding({ ...scope(), before: "1000.01" }, [e]).actualPresentWithheld, null);
  assert.equal(releasedBir2316Withholding({ ...scope(), boundRunId: null }, [e]).actualPresentWithheld, null);
});
function finalCase() {
  const result = computeFinalPay({ releasedBasicYtd: 600000, historicalBasicYtd: 0, unpaidBasicSalary: 1000, thirteenthPaidYtd: 50000,
    grossCompensationYtd: 600000, statutoryContributionsYtd: 0, taxWithheldYtd: 5000, mwe: false,
    leaveMonetizationPay: 0, separationPay: 0, retirementPay: 0, otherBenefits: 0, loanDeductions: 0 });
  return { result, input: { baseline: { actualPresentWithheld: "5000.00", appliedAdjustment: "0.00", issues: [] as string[], entryIds: [5] },
    before: 5000, expectedAdjustment: result.annualization.adjustment, status: "released", releasedAt: new Date(), releaseReference: "fictional-release",
    preparedByUserId: 1, approvedByUserId: 2, releasedByUserId: 3, appliedTaxCollection: result.appliedTaxCollection,
    unpaidTaxWithholding: result.unpaidTaxWithholding, taxAdjustment: result.taxAdjustment, grossFinalPay: result.grossFinalPay,
    netFinalPay: result.netFinalPay, finalStatutoryDeductions: result.finalStatutoryDeductions, loanDeductions: result.loanDeductions } };
}
test("executed final-pay shortfall shows only released actual collection, not tax due", () => {
  const { result, input } = finalCase(); const actual = finalPayBir2316Withholding(input);
  assert.ok(result.unpaidTaxWithholding > 0); assert.equal(Number(actual.actualPresentWithheld), 5000 + result.appliedTaxCollection);
  assert.notEqual(Number(actual.actualPresentWithheld), result.taxDue); assert.ok(actual.issues.includes("UNSETTLED_ADJUSTMENT"));
  const a = result.annualization;
  const review = reviewBir2316Summary({ grossCompensation: a.grossCompensation, nonTaxable: a.nonTaxable, taxableIncome: a.taxableIncome,
    taxDue: a.taxDue, withheldBeforeYearEnd: a.taxWithheld, yearEndAdjustment: a.adjustment }, undefined, actual);
  assert.equal(review.rows.find(r => r.item === "25A")?.centavos, Math.round((5000 + result.appliedTaxCollection) * 100));
  assert.equal(review.rows.find(r => r.label === "Uncollected tax adjustment")?.centavos, Math.round(result.unpaidTaxWithholding * 100));
  assert.equal(review.rows.find(r => r.item === "25B")?.centavos, null);
});
test("released final-pay refund uses actual net release and cannot infer missing legacy allocation", () => {
  const { input } = finalCase();
  const r = finalPayBir2316Withholding({ ...input, expectedAdjustment: -200, appliedTaxCollection: 0, unpaidTaxWithholding: 0,
    taxAdjustment: 200, grossFinalPay: 0, netFinalPay: 200 });
  assert.equal(r.actualPresentWithheld, "4800.00"); assert.equal(r.appliedAdjustment, "-200.00"); assert.deepEqual(r.issues, []);
  for (const change of [{ status: "approved" }, { preparedByUserId: 2 }, { releaseReference: "" }, { appliedTaxCollection: undefined },
    { unpaidTaxWithholding: undefined }, { netFinalPay: 1 }, { appliedTaxCollection: 999999 }]) assert.equal(finalPayBir2316Withholding({ ...input, ...change }).actualPresentWithheld, null);
});

test("new evidence flag off leaves the existing parent-enabled worksheet byte-identical even if evidence is supplied", async () => {
  const { renderBir2316ReviewHtml } = await import("../src/lib/bir-2316-print");
  const saved = [process.env.BIR_2316_RECONCILIATION_ENABLED, process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED];
  try {
    process.env.BIR_2316_RECONCILIATION_ENABLED = "true"; delete process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED;
    const input = { taxYear: 2025, employerName: "Fictional", employerTin: "123456789-0000", employeeNo: "FICT", employeeName: "Fictional", employeeTin: "987654321-0000", employmentStart: "2025-01-01", mwe: false, sourceStatus: "settled", ruleVersion: "fictional", grossCompensation: 10000, exemptBenefitPool: 0, deMinimis: 0, statutoryContributions: 0, nonTaxable: 0, taxableIncome: 10000, taxDue: 1200, withheldBeforeYearEnd: 1000, yearEndAdjustment: 200 };
    const legacy = renderBir2316ReviewHtml(input);
    assert.equal(renderBir2316ReviewHtml({ ...input, withholdingEvidence: releasedBir2316Withholding(scope(), [entry()]) }), legacy);
    process.env.BIR_2316_WITHHOLDING_EVIDENCE_ENABLED = "true";
    const updated = renderBir2316ReviewHtml({ ...input, withholdingEvidence: releasedBir2316Withholding(scope(), [entry()]) });
    assert.notEqual(updated, legacy); assert.match(updated, /Item 25A[^<]*<\/dt><dd>1,200\.00/);
    assert.doesNotMatch(updated, /SETTLEMENT_UNVERIFIED/);
  } finally { for (const [i, name] of ["BIR_2316_RECONCILIATION_ENABLED", "BIR_2316_WITHHOLDING_EVIDENCE_ENABLED"].entries()) { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; } }
});
