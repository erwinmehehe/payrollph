/**
 * Source-only cross-boundary review after PR #1975's separation annualization.
 *
 * This test earns ZERO API/page credits. It does not replace real PG16/browser
 * tests or independent payroll-tax, identity, privacy and security acceptance.
 * The source seal deliberately fails closed on any later input drift.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

export const SEALED_SOURCES = Object.freeze({
  "src/app/workspace/prior-employer/page.tsx": "e55809f26075c142240675826a0c353d403a20e6",
  "src/app/workspace/2316/page.tsx": "f4badb3f1782812aab672665340e967911cff2cb",
  "src/app/api/year-end/prior-evidence/route.ts": "d2fc2fa7c4257d7e33545c8a23ea310abae7077d",
  "src/app/api/year-end/2316-certificate/route.ts": "b33979302d7e9db18ba49a1bb7b4c8d7e5e09194",
  "src/lib/year-end-prior-evidence-server.ts": "c900ac326fc1836fd51602952ce966beeaf8c084",
  "src/lib/bir-2316-certificate-server.ts": "34c7be32a808b9a6835ef54e40c7a9fabc695e16",
  "src/lib/bir-2316-employer.ts": "ffe0a3d3b9be43be9befd4e1607d942249eaf7e3",
  "src/lib/final-pay-prior-employer-server.ts": "fe30da71932ec42d6302232891f0f1abd89c1abc",
  "src/app/api/separation/route.ts": "a4d45ab01a5ede8f6f195ba09d3eb3e8f31de3fa",
  "src/lib/final-pay.ts": "bcbcfbc89a6728ffaa08f84df3fad4ce34922189",
  "src/lib/tenant-prior-review-worker.ts": "3d5cf7b07b0970a9912e4ed6fcee31290449bc1e",
  "src/lib/tenant-payroll-review-page.ts": "37766e6f9ec0dd8d1098bc8987bbd5de899a3739",
});
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const PRIOR = "src/app/workspace/prior-employer/page.tsx";
const CERT = "src/app/workspace/2316/page.tsx";

function blobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1")
    .update("blob " + bytes.byteLength + "\0").update(bytes).digest("hex");
}
function ordered(source, fragments, label) {
  let last = -1;
  for (const fragment of fragments) {
    const at = source.indexOf(fragment, last + 1);
    assert.ok(at > last, label + ": missing or out-of-order " + fragment);
    last = at;
  }
}
function includesAll(source, tokens, label) {
  for (const token of tokens) assert.ok(source.includes(token),
    label + ": missing authorization invariant " + token);
}

export function verifyPostFinalPayWorkspaceSources(read = readFileSync) {
  const files = {};
  for (const [path, expected] of Object.entries(SEALED_SOURCES)) {
    const raw = read(path);
    assert.equal(blobSha(raw), expected,
      "POST_FINAL_PAY_REVIEW_REQUIRED: source changed " + path);
    files[path] = String(raw);
  }
  const m = JSON.parse(String(read(MANIFEST, "utf8")));
  for (const path of [PRIOR, CERT]) {
    const matches = m.scopedPages.filter(row => row.path === path);
    assert.equal(matches.length, 1, "Only one scoped page entry " + path);
    const page = matches[0];
    assert.equal(page.blob, SEALED_SOURCES[path],
      "Manifest page source must match inspected application bytes");
    assert.equal(page.status, "GAP", "Unreviewed full-page action must remain GAP");
    assert.equal(page.reviewedUncertified?.pageActionCredits, 0,
      "SSR/API evidence cannot award a whole-page credit");
    assert.equal(page.reviewedUncertified?.independentlyAccepted, false);
  }
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.equal(m.metrics.methods, 498);
  const prior = files[PRIOR], cert = files[CERT];
  ordered(prior, [
    "await getSessionUser()", "explicitPayrollReviewEmployerId(query.organizationId)",
    "await assertOrganizationRole(", "await getAccess(",
    "await resolveMultiEntityContext(", "canonicalPriorReviewWorkerId(employeeId)",
    "const [worker] = await db.select(", "assertEntityResource(entityScope.context, worker.legalEntityId)",
    "<YearEndPriorReview",
  ], "Prior-employer SSR");
  includesAll(prior, [
    "if (denied || !access?.companyWide) notFound()",
    "if (!entityScope.ok || (entityScope.context.enabled && entityScope.context.group)) notFound()",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, selectedWorkerId)",
    "if (!worker || (entityScope.context.enabled &&",
  ], "Prior-employer SSR");

  ordered(cert, [
    "await getSessionUser()", "explicitPayrollReviewEmployerId(query.organizationId)",
    "await assertOrganizationRole(", "await getAccess(",
    "await resolveMultiEntityContext(", "const [worker] = await db.select(",
    "if (selectedSeparationId === null && entityScope.context.enabled &&",
    "const [separation] = await db.select(",
    "frozenFinalPayLegalEntityId(separation.snapshot)", "<Certificate2316Review",
  ], "2316 released historical employer SSR");
  includesAll(cert, [
    "eq(separationRecords.organizationId, organizationId)",
    "eq(separationRecords.employeeId, selectedWorkerId!)",
    "eq(separationRecords.id, selectedSeparationId)",
    'separation.status !== "released"',
    'separation.lastDay.startsWith(String(selectedYear) + "-")',
    "if (entityScope.context.enabled && selectedSeparationId === null)",
  ], "2316 worker/separation source binding");

  const priorApi = files["src/app/api/year-end/prior-evidence/route.ts"];
  const priorServer = files["src/lib/year-end-prior-evidence-server.ts"];
  ordered(priorApi, ["await getSessionUser()", "await assertOrganizationRole(",
    "await getAccess(", "requireSensitiveActionMfa(user)", "await priorIntake(scope, user, input)"],
  "Prior-evidence API");
  ordered(priorServer, ["await resolveMultiEntityContext(", "return db.transaction(async tx => {",
    "const employeeScope = await priorEmployeeScope(tx, scope);",
    "assertEntityResource(entityScope.context, employeeScope.legalEntityId)",
    "const existing = await readPriorEvidence(tx, employeeScope);"],
  "Encrypted prior-employer evidence");
  includesAll(priorServer, [
    'if (!priorEvidenceEnabled()) throw new Error("PRIOR_DISABLED")',
    'isolationLevel: "serializable"',
    "checkerUserId === row.makerUserId",
  ], "Prior-evidence source lock and independent checker");

  const finalPrior = files["src/lib/final-pay-prior-employer-server.ts"];
  ordered(finalPrior, ["await resolveMultiEntityContext(",
    "const employeeScope = await priorEmployeeScope(tx, input);",
    "assertEntityResource(actorEntity.context, employeeScope.legalEntityId)",
    "current = await readPriorEvidence(tx, employeeScope, true);"],
  "PR #1975 approved previous employer source");
  includesAll(finalPrior, [
    'if (!criticalReleaseFlagEnabled("yearEndPriorEvidence")) return null',
    '"FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_REQUIRED"',
    '"FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED"',
    "frozen.digest !== expected.digest",
    "frozen.revision !== expected.revision",
    "frozen.taxYear !== expected.taxYear",
  ], "Final-pay source/frozen revision hold");
  const separation = files["src/app/api/separation/route.ts"];
  ordered(separation, [
    "loadReviewedPriorForFinalPay(priorEvidenceScope, tx)",
    "const result = computeFinalPay(", "priorEvidenceSnapshot(priorEvidence)",
    "await assertFinalPayPriorSnapshot(priorEvidenceScope, computationSnapshot.priorEmployerEvidence, tx)",
  ], "Separation annualization source ordering");
  assert.equal((separation.match(/await assertFinalPayPriorSnapshot\(/g) ?? []).length, 3,
    "Initiation, finance approval and release must each recheck the approved source");

  const certApi = files["src/app/api/year-end/2316-certificate/route.ts"];
  ordered(certApi, [
    "await getSessionUser()", "await assertOrganizationRole(",
    "await resolveMultiEntityContext(",
    "frozenFinalPayLegalEntityId(frozen.snapshot)",
    "await load2316CertificateSource(scope)",
    "assertEntityResource(entityScope.context, source.legalEntityId)",
    "input.sourceDigest !== sourceDigest", "await render2316CertificatePdf(source, review)",
  ], "2316 API frozen historical employer and unsigned PDF");
  const certificateSource = files["src/lib/bir-2316-certificate-server.ts"];
  includesAll(certificateSource, [
    'separation.status !== "released"',
    "historical2316Employer({ organizationId: scope.organizationId, snapshot, entities, legacy: organization })",
    "if (!employer.ok) throw new CertificateSourceError(employer.code)",
    'isolationLevel: "repeatable read", accessMode: "read only"',
  ], "2316 historical separation transaction");
  const historical = files["src/lib/bir-2316-employer.ts"];
  assert.match(historical, /employeeLegalEntityId/);
  return { scope: "source-only exact-current-final-pay", pageActionCredits: 0,
    apiMethodCredits: 0, independentSecurityReview: "PENDING",
    productionCertified: false, bothPageGapsPreserved: true };
}

test("source-current previous employer and BIR 2316 pages retain #1975 employer/grant/revision controls", () => {
  const result = verifyPostFinalPayWorkspaceSources();
  assert.equal(result.bothPageGapsPreserved, true);
  assert.equal(result.pageActionCredits, 0);
  assert.equal(result.productionCertified, false);
});
test("unknown changed source cannot reuse the old cross-page assurance", () => {
  for (const [path, find] of [
    [PRIOR, "assertEntityResource(entityScope.context, worker.legalEntityId)"],
    [CERT, "frozenFinalPayLegalEntityId(separation.snapshot)"],
    ["src/lib/final-pay-prior-employer-server.ts", "frozen.revision !== expected.revision"],
    ["src/app/api/separation/route.ts", "await assertFinalPayPriorSnapshot("],
  ]) {
    const read = (candidate, ...args) => {
      const current = readFileSync(candidate, ...args);
      return candidate === path ? String(current).replace(find, "removed-security-guard") : current;
    };
    assert.throws(() => verifyPostFinalPayWorkspaceSources(read),
      /POST_FINAL_PAY_REVIEW_REQUIRED|authorization invariant|missing or out-of-order/,
      path + " may not borrow a previous successful receipt");
  }
});
test("an invented full-page coverage promotion is rejected without changing the manifest", () => {
  const read = (path, ...args) => {
    const value = readFileSync(path, ...args);
    if (path !== MANIFEST) return value;
    const m = JSON.parse(String(value));
    m.scopedPages.find(item => item.path === PRIOR).status = "COVERED";
    return JSON.stringify(m);
  };
  assert.throws(() => verifyPostFinalPayWorkspaceSources(read), /must remain GAP/);
});
