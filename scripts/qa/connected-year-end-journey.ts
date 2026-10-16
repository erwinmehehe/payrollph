/** Disposable QA only: extend the SAME hired worker and reviewed payroll to an
 * unsigned 2316. No payroll, annualization or settlement rows are seeded here. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readBasicAndThirteenth } from "../../src/lib/final-pay";
import { drainPayrollQueue } from "../../src/lib/payroll-engine";
import { mapConnectedCompensation } from "./connected-year-end-mapping";
import { readValidatedUnsignedCertificatePdf } from "./connected-year-end-artifact";
type Client = {
  ok(path: string, method?: string, data?: unknown): Promise<Record<string, any>>;
  json(path: string, method?: string, data?: unknown): Promise<{ status: number; body: Record<string, any> }>;
  request(path: string, method?: string, data?: unknown): Promise<Response>;
};
type Scope = { organizationId: number; employeeId: number; taxYear: number };
const query = (s: Scope) => new URLSearchParams(Object.entries(s).map(([k,v]) => [k,String(v)]));
const cents = (v: unknown) => {
  assert.ok(typeof v === "string" || typeof v === "number");
  const n = Number(v); assert.ok(Number.isFinite(n));
  const c = Math.round(n * 100); assert.ok(Number.isSafeInteger(c) && Math.abs(n - c / 100) < 1e-8);
  return c;
};
const money = (c: number) => (c / 100).toFixed(2);
export async function completeYearEndIdentity(owner: Client, organizationId: number, employeeId: number) {
  const directory = await owner.ok("/api/legal-entities?organizationId=" + organizationId);
  assert.equal(directory.legalEntities.length, 1);
  await owner.ok("/api/legal-entities", "PATCH", { organizationId, action: "update_entity",
    legalEntityId: directory.legalEntities[0].id, birTin: "123456789", birBranchCode: "0000" });
  // Use the existing audited correction API for fields absent from new-hire
  // intake. This exercises the real product gap rather than rewriting the DB.
  const request = await owner.ok("/api/compliance/data-requests", "POST", {
    organizationId, subjectEmail: "worker.nine@linaw.test", requestType: "correction",
  });
  await owner.ok("/api/compliance/data-requests", "PATCH", { id: request.id, status: "completed",
    executeInApp: true, correction: { birthDate: "1990-02-03", tin: "333222111", tinBranchCode: "0000" },
    fulfillmentEvidence: { reference: "fictional identity completion for isolated annual journey" } });
  const rows = await owner.ok("/api/employees?organizationId=" + organizationId);
  assert.ok(Array.isArray(rows) && rows.some((r: any) => Number(r.id) === employeeId));
}
export async function bindConnectedYearEnd(input: Scope & { runId: number; workDate: string; payroll: Client; owner: Client; employee: Client }) {
  const { payroll, owner, employee, organizationId, employeeId, runId, workDate, taxYear } = input;
  assert.equal(workDate, taxYear + "-12-31");
  const registerPath = "/api/payroll-runs?runId=" + runId + "&include=entries";
  const initial = await payroll.ok(registerPath);
  assert.equal(initial.entries.length, 1);
  const basic = cents(readBasicAndThirteenth(initial.entries[0].lineItems).basic);
  // Independent integer oracle for the paid 13th-month amount, not the helper
  // whose behavior is being tested. Commission is deliberately not BASIC.
  const benefit = Math.floor((basic + 6) / 12);
  assert.ok(benefit > 0);
  for (const earning of [
    { earningType: "13th_month", label: "Fictional 13th month", amount: money(benefit) },
    { earningType: "commission", label: "Fictional commission", amount: "30000.00" },
  ]) await payroll.ok("/api/payroll-earnings", "POST", { organizationId, employeeId,
    effectiveDate: workDate, includeInStatutoryBase: false, ...earning });
  await payroll.ok("/api/payroll-runs/" + runId + "/process", "POST");
  const scopedPrior = "/api/year-end/prior-evidence?" + query({ organizationId, employeeId, taxYear });
  const evidence = { status: "none-confirmed", employerName: "", employerTin: "", periodFrom: "", periodTo: "",
    taxableIncome: "0.00", taxWithheld: "0.00", exemptBenefits: "0.00", sourceReference: "private:fictional-none-declaration",
    sourceSha256: "a".repeat(64), peraCredit: "0.00", peraReference: "", peraSha256: "" };
  assert.equal((await employee.json(scopedPrior)).status, 403);
  await payroll.ok(scopedPrior, "POST", { action: "save", evidence, expectedDigest: "" });
  const saved = await payroll.ok(scopedPrior);
  assert.equal((await payroll.json(scopedPrior, "POST", { action: "approve", expectedDigest: saved.record.digest })).status, 409);
  await owner.ok(scopedPrior, "POST", { action: "approve", expectedDigest: saved.record.digest });
  const before = await payroll.ok(registerPath);
  const beforeMoney = readBasicAndThirteenth(before.entries[0].lineItems);
  assert.equal(cents(beforeMoney.thirteenthPaid), benefit);
  assert.ok(beforeMoney.taxWithheld > 0, "Scenario must exercise an actual year-end refund");
  const bound = await payroll.ok("/api/year-end", "POST", { organizationId, taxYear, applyToPayrollRunId: runId });
  assert.equal(bound.payrollSettlement.payrollRunId, runId);
  assert.ok(bound.totalRefund > 0);
  // Execute the REAL run-scoped queue consumer after HTTP binding. This is
  // worker consumption, not an external-scheduler or unattended-cron claim.
  await drainPayrollQueue(20, runId);
  const calculated = await payroll.ok(registerPath);
  const status = await payroll.ok("/api/payroll-runs?runId=" + runId);
  assert.equal(status.run.status, "Needs review");
  assert.ok(calculated.entries[0].lineItems.some((line: any) => String(line.code).startsWith("YE-TAX-") && Number(line.amount) > 0));
  return { basic, benefit, commission: 3000000, priorDigest: saved.record.digest, preSettlementWithheld: cents(beforeMoney.taxWithheld) };
}
export async function generateConnected2316(input: Scope & { runId: number; owner: Client; employee: Client; tenantB: Client; amounts: Awaited<ReturnType<typeof bindConnectedYearEnd>> }) {
  const { organizationId, employeeId, taxYear, owner, employee, tenantB, amounts } = input;
  const api = "/api/year-end/2316-certificate?" + query({ organizationId, employeeId, taxYear });
  assert.equal((await employee.json(api)).status, 403);
  assert.equal((await tenantB.json(api)).status, 403);
  const loaded = await owner.ok(api), source = loaded.source;
  assert.deepEqual(source.withholding.issues, []);
  assert.equal(source.withholding.actualPresentWithheld, "0.00");
  assert.equal(cents(source.withholding.appliedAdjustment), -amounts.preSettlementWithheld);
  assert.equal(source.approvedPriorEvidence.digest, amounts.priorDigest);
  const register = await owner.ok("/api/payroll-runs?runId=" + input.runId + "&include=entries");
  const entry = register.entries.find((r: any) => Number(r.employeeId) === employeeId);
  assert.equal(cents(source.summary.grossCompensation), cents(entry.grossPay), "No unpaid 13th-month accrual may masquerade as released compensation");
  const contributions = cents(readBasicAndThirteenth(entry.lineItems).contributions);
  const remainder = cents(entry.grossPay) - amounts.basic - amounts.benefit - amounts.commission;
  assert.ok(remainder >= 0);
  const detailItems = mapConnectedCompensation({ gross: cents(entry.grossPay), basic: amounts.basic,
    benefit: amounts.benefit, commission: amounts.commission, contributions });
  const review = { text: { rdo: "039", address: "123 Fictional Street", zip: "1100", homeAddress: "123 Fictional Street", homeZip: "1100", foreignAddress: "", contact: "09171234567", minimumDaily: "0.00", minimumMonthly: "0.00", employerAddress: "456 Fictional Avenue", employerZip: "1200", categoryReference: "Fictional single-run BASIC, commission and premium mapping", peraReference: "Fictional zero PERA declaration", "44A": "", "44B": "", "51A": "", "51B": "Fictional holiday and schedule premiums" }, detailItems, previousEmployer: { status: "none-confirmed" }, peraCredit: "0.00", employerType: "main", acknowledged: true };
  assert.equal((await owner.json(api, "POST", { sourceDigest: "stale", review })).status, 409);
  const pdf = await owner.request(api, "POST", { sourceDigest: loaded.sourceDigest, review });
  // This CI-only fixture does not save failed HTTP response data to disk.
  // Its error summary is restricted to allowlisted codes for the assertion.
  let failureCodes: string[] = [];
  if (pdf.status !== 200) {
    const failure = await pdf.clone().json().catch(() => ({}));
    failureCodes = [failure.code, ...(Array.isArray(failure.issues) ? failure.issues : [])]
      .filter((v): v is string => typeof v === "string" && /^[A-Z][A-Z0-9_]{0,100}$/.test(v));

  }
  assert.equal(pdf.status, 200, "Unsigned certificate: HTTP " + pdf.status + " " + failureCodes.join(","));
  // The actual PDF is intentionally retained as fictional source evidence,
  // but no network bytes are persisted until MIME, cache controls, size,
  // header/trailer and recognizable active-content checks succeed.
  const bytes = await readValidatedUnsignedCertificatePdf(pdf);
  writeFileSync("qa-artifacts/connected-year-end-unsigned.pdf", bytes);
  writeFileSync("qa-artifacts/connected-year-end-review.json", JSON.stringify({
    query: query({ organizationId, employeeId, taxYear }).toString(), review, employeeName: source.employeeName,
  }, null, 2));
  return { result: "PASS", organizationId, employeeId, payrollRunId: input.runId,
    sourceDigest: loaded.sourceDigest, priorDigest: amounts.priorDigest,
    pdfSha256: createHash("sha256").update(bytes).digest("hex"), paidThirteenthCentavos: amounts.benefit,
    refundedTaxCentavos: amounts.preSettlementWithheld, unsigned: true, submitted: false,
    workerMode: "actual run-scoped queue consumer; external scheduler not exercised" };
}
