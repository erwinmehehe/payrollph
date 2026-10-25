import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";
import test from "node:test";
import { annualize } from "../src/lib/annualization";
import { annualizeWithPrior, assertPriorApproval, parsePriorEvidence, priorEvidenceDigest, type PriorEvidence, type PriorScope } from "../src/lib/year-end-prior-evidence";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { decryptGovernmentId, encryptGovernmentId } from "../src/lib/government-id-crypto";
import { prepare2316Certificate } from "../src/lib/bir-2316-certificate";
import { certificateReview, certificateSource } from "./fixtures/bir-2316-certificate";
const scope: PriorScope = { organizationId: 1, employeeId: 2, taxYear: 2025, legalEntityId: null, startDate: "2025-07-01", employeeTin: "fictional" };
const evidence: PriorEvidence = { status: "verified", employerName: "Fictional prior employer", employerTin: "123456789-0000", periodFrom: "2025-01-01", periodTo: "2025-06-30", taxableIncome: "100000.00", taxWithheld: "10000.00", exemptBenefits: "0.00", sourceReference: "private:fixture-2316", sourceSha256: "a".repeat(64), peraCredit: "100.00", peraReference: "private:fixture-pera-credit", peraSha256: "b".repeat(64) };
const present = annualize({ grossCompensation: 600000, thirteenthMonth: 0, statutoryContributions: 100000, taxWithheld: 40000, mwe: false });
test("midyear prior income and PERA produce exact collection without reclassifying present WHT", () => {
  const reviewed = parsePriorEvidence(evidence, scope);
  const result = annualizeWithPrior(present, reviewed, 2025);
  assert.equal(result.taxableIncome, 500000); assert.equal(result.grossCompensation, 600000);
  assert.equal(result.taxDue, 62500); assert.equal(result.taxWithheld, 40000);
  assert.equal(result.adjustment, 12400); assert.equal(result.outcome, "collect");
  assert.equal(result.adjustment > 1000, true, "a final gross of 1000 must not be reported as full tax collection");
  assert.deepEqual(present, annualize({ grossCompensation: 600000, thirteenthMonth: 0, statutoryContributions: 100000, taxWithheld: 40000, mwe: false }));
});
test("refund and balanced outcomes preserve actual present withholding", () => {
  assert.equal(annualizeWithPrior({ ...present, taxWithheld: 60000 }, evidence, 2025).adjustment, -7600);
  assert.equal(annualizeWithPrior({ ...present, taxWithheld: 52400 }, evidence, 2025).outcome, "balanced");
  assert.throws(() => annualizeWithPrior(present, { ...evidence, taxWithheld: "70000.00" }, 2025), /PRIOR_CREDITS_EXCEED/);
  assert.throws(() => annualizeWithPrior(present, { ...evidence, peraCredit: "70000.00" }, 2025), /PERA_EXCEEDS/);
  assert.throws(() => annualizeWithPrior({ ...present, mwe: true }, evidence, 2025), /MWE/);
});
test("prior and present benefits share one 90k exemption; a one-cent excess is taxable exactly once", () => {
  const current = annualize({ grossCompensation: 600000, thirteenthMonth: 50000, statutoryContributions: 0, taxWithheld: 40000, mwe: false });
  const result = annualizeWithPrior(current, { ...evidence, exemptBenefits: "50000.01" }, 2025);
  assert.equal(result.exemptBenefitPool, 39999.99);
  assert.equal(result.taxableIncome, 560000.01);
  assert.equal(result.nonTaxable, 39999.99);
  assert.equal(result.taxableThirteenthMonth, 10000.01);
  assert.equal(result.taxDue, 74500);
  assert.equal(result.adjustment, 24400);
  assert.equal(current.taxableIncome, 550000);
  assert.throws(() => parsePriorEvidence({ ...evidence, exemptBenefits: "90000.01" }, scope), /BENEFIT_CAP/);
});
test("unknown, contradictory zero, same-time employment, invalid dates and amounts reject", () => {
  for (const change of [{ status: "unknown" }, { status: "none-confirmed" }, { sourceSha256: "" }, { peraSha256: "" }, { taxableIncome: "1.001" }, { periodTo: "2025-07-01" }, { periodFrom: "2025-02-30" }, { employerTin: "" }]) assert.throws(() => parsePriorEvidence({ ...evidence, ...change }, scope));
  const none = parsePriorEvidence({ ...evidence, status: "none-confirmed", employerName: "", employerTin: "", periodFrom: "", periodTo: "", taxableIncome: "0", taxWithheld: "0", peraCredit: "0", peraReference: "", peraSha256: "" }, scope);
  assert.equal(none.taxableIncome, "0.00");
});
test("independent approval binds hash, worker, tax year, start date and legal employer; settled blocks", () => {
  const digest = priorEvidenceDigest(scope, evidence);
  assert.doesNotThrow(() => assertPriorApproval({ digest, expectedDigest: digest, makerId: 1, checkerId: 2, settled: false }));
  assert.throws(() => assertPriorApproval({ digest, expectedDigest: digest, makerId: 1, checkerId: 1, settled: false }), /INDEPENDENT/);
  assert.throws(() => assertPriorApproval({ digest, expectedDigest: digest, makerId: 1, checkerId: 2, settled: true }), /SETTLED/);
  for (const change of [{ organizationId: 3 }, { employeeId: 3 }, { taxYear: 2026 }, { legalEntityId: 3 }, { startDate: "2025-08-01" }, { employeeTin: "changed" }]) {
    const changed = priorEvidenceDigest({ ...scope, ...change }, evidence);
    assert.notEqual(changed, digest);
    assert.throws(() => assertPriorApproval({ digest: changed, expectedDigest: digest, makerId: 1, checkerId: 2, settled: false }), /SOURCE_CHANGED/);
  }
  assert.notEqual(priorEvidenceDigest(scope, { ...evidence, sourceSha256: "c".repeat(64) }), digest);
});
test("dedicated required encryption protects evidence and rotates without plaintext fallback", () => {
  const key = "12".repeat(32), rotated = "34".repeat(32);
  const plain = JSON.stringify(evidence);
  assert.throws(() => encryptGovernmentId(plain, { required: true, env: { NODE_ENV: "test" } }), /PII_ENCRYPTION_KEY/);
  const encrypted = encryptGovernmentId(plain, { required: true, env: { NODE_ENV: "test", PII_ENCRYPTION_KEY: key } })!;
  assert.ok(!encrypted.includes(evidence.employerTin));
  assert.equal(decryptGovernmentId(encrypted, { NODE_ENV: "test", PII_ENCRYPTION_KEY: rotated, PII_ENCRYPTION_KEY_PREVIOUS: key }), plain);
});
test("flag is exact true/default-off and certificate rejects changed approved evidence", () => {
  for (const value of [undefined, "false", "TRUE", "1"]) assert.equal(criticalReleaseFlagEnabled("yearEndPriorEvidence", { YEAR_END_PRIOR_EVIDENCE_ENABLED: value }), false);
  assert.equal(criticalReleaseFlagEnabled("yearEndPriorEvidence", { YEAR_END_PRIOR_EVIDENCE_ENABLED: "true" }), true);
  const source = { ...certificateSource, approvedPriorEvidence: { digest: "a".repeat(64), revision: 1, evidence } };
  assert.ok(prepare2316Certificate(source, certificateReview()).issues.includes("APPROVED_PRIOR_EVIDENCE_MISMATCH"));
});

test("year-end prior evidence enforces persisted legal employer within serializable evidence transaction (source guard)", () => {
  const helper = readFileSync("src/lib/year-end-prior-evidence-server.ts", "utf8");
  const route = readFileSync("src/app/api/year-end/prior-evidence/route.ts", "utf8");
  assert.match(helper, /resolveMultiEntityContext\(\{/);
  assert.match(helper, /userId: actor\.id, organizationId: scope\.organizationId/);
  assert.match(helper, /if \(!entityScope\.ok\) throw new Error\("PRIOR_ENTITY_ACCESS_DENIED"\)/);
  assert.match(helper, /assertEntityResource\(entityScope\.context, employeeScope\.legalEntityId\)/);
  const transaction = helper.indexOf("return db.transaction(async tx => {");
  const persistedEmployee = helper.indexOf("const employeeScope = await priorEmployeeScope(tx, scope);", transaction);
  const accessCheck = helper.indexOf("assertEntityResource(entityScope.context, employeeScope.legalEntityId)");
  const encryptedRead = helper.indexOf("const existing = await readPriorEvidence(tx, employeeScope);", transaction);
  const write = helper.indexOf('if (input.action === "save")', transaction);
  assert.ok(transaction > 0 && persistedEmployee > transaction && accessCheck > persistedEmployee
    && encryptedRead > accessCheck && write > accessCheck,
  "Grant selection must be checked against actual worker employer before decrypt/save/approve");
  assert.match(helper, /isolationLevel: "serializable"/);
  assert.match(helper, /if \(!priorEvidenceEnabled\(\)\) throw new Error\("PRIOR_DISABLED"\)/);
  assert.match(route, /await priorIntake\(scope, user, input\)/,
    "Existing API calls both GET and POST through the tenant-checked helper");
  const own = decideEntityAccess({
    role: "owner", availableEntityIds: [401, 402], grantedEntityIds: [401], requested: 401,
  });
  assert.equal(entityResourceAllowed(own, 401), true);
  assert.equal(entityResourceAllowed(own, 402), false,
    "Organization-wide owner cannot decrypt another legal employer's prior wage or government evidence");
  assert.equal(entityResourceAllowed(own, null), false);
  const forged = decideEntityAccess({
    role: "owner", availableEntityIds: [401, 402], grantedEntityIds: [401], requested: 402,
  });
  assert.equal(forged.ok, false);
});
