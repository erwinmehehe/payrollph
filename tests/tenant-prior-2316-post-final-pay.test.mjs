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
import { selectedTargets, verifySixPageCredits } from "../scripts/qa/tenant-six-scoped-page-credit.mjs";

export const SEALED_SOURCES = Object.freeze({
  "src/app/workspace/prior-employer/page.tsx": "e55809f26075c142240675826a0c353d403a20e6",
  "src/app/workspace/2316/page.tsx": "f4badb3f1782812aab672665340e967911cff2cb",
  "src/app/api/year-end/prior-evidence/route.ts": "b7d3cde4a9d66f408c40c9e34ce50cacc3dc540b",
  "src/app/api/year-end/2316-certificate/route.ts": "df2fa42c9f3995f7ebb62a3141ba2c0c3140161d",
  "src/lib/year-end-prior-evidence-server.ts": "c900ac326fc1836fd51602952ce966beeaf8c084",
  "src/lib/bir-2316-certificate-server.ts": "529a78b2fc48fc4dfacb2d5d7b4ffd0e6e08923f",
  "src/lib/bir-2316-employer.ts": "ffe0a3d3b9be43be9befd4e1607d942249eaf7e3",
  "src/lib/final-pay-prior-employer-server.ts": "fe30da71932ec42d6302232891f0f1abd89c1abc",
  "src/app/api/separation/route.ts": "1d4733144baa72e4828cc40a087dbc0dbab3a77f",
  "src/lib/final-pay.ts": "874cd5aaa30eabdad9f12bf9cca4f0224aa18fe6",
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
  // Main's six-page PG16 gate may already carry provisional source-pinned
  // SSR/GET receipts. This source-only review must neither erase those
  // receipts nor turn them into independent review, API or page-action credits.
  const selected = new Set(selectedTargets(read).map(item => item.key));
  assert.ok(selected.has("prior") && selected.has("2316"),
    "POST_FINAL_PAY_REVIEW_REQUIRED: both existing workspace proofs must be selected");
  assert.equal(verifySixPageCredits(m, read), selected.size,
    "POST_FINAL_PAY_REVIEW_REQUIRED: provisional page proofs must be source-current");
  for (const [path, family] of [[PRIOR, "prior"], [CERT, "2316"]]) {
    const matches = m.scopedPages.filter(row => row.path === path);
    assert.equal(matches.length, 1, "Only one scoped page entry " + path);
    const page = matches[0];
    assert.equal(page.blob, SEALED_SOURCES[path],
      "Manifest page source must match inspected application bytes");
    assert.equal(page.status, "COVERED",
      "Existing provisional main page proof may not be silently withdrawn or promoted");
    assert.equal(page.testedBy?.proofFamily, family);
    assert.equal(page.testedBy?.pageProofStatus, "FINAL_HEAD_CI_REQUIRED");
    assert.equal(page.testedBy?.independentlyAccepted, false);
    assert.equal(page.testedBy?.methodCredits, 0);
    assert.equal(page.reviewedUncertified?.pageActionCredits, 0,
      "SSR/API evidence cannot award a whole-page action credit");
    assert.equal(page.reviewedUncertified?.independentlyAccepted, false);
  }
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.ok(Number.isSafeInteger(m.metrics.methods) && m.metrics.methods > 0,
    "Manifest method metrics must be present; live count validated by inventory tests");
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

  // App-level remediation must be checked by the same source-sealed review
  // as the final-pay authority chain, not only by the real browser proof.
  includesAll(priorApi, [
    '"PRIOR_EMPLOYEE_NOT_FOUND"', '"PRIOR_ENTITY_ACCESS_DENIED"',
    '"PRIOR_RECORD_UNAVAILABLE"', '.includes(internalCode)',
  ], "Prior API existence-oracle response parity");
  includesAll(separation, [
    "const selectedEmployerPredicate = selectedLegalEntityId === null",
    "jsonb_typeof(", "sourceFingerprint,employeeLegalEntityId",
    'eq(separationRecords.status, "draft")',
    "eq(employees.legalEntityId, selectedLegalEntityId)",
    "const frozenEmployerId = frozenFinalPayLegalEntityId(sep.computationSnapshot)",
    "const authoritativeEntityId = frozenEmployerId ??",
    "if (!entity.ok) return unavailable();",
    "assertEntityResource(entity.context, authoritativeEntityId)",
    '"Cache-Control": "private, no-store"',
  ], "Released separation historic employer selector");
  const certApi = files["src/app/api/year-end/2316-certificate/route.ts"];
  ordered(certApi, [
    "await getSessionUser()", "await assertOrganizationRole(",
    "await resolveMultiEntityContext(",
    "frozenFinalPayLegalEntityId(frozen.snapshot)",
    "await load2316CertificateSource(scope)",
    "assertEntityResource(entityScope.context, source.legalEntityId)",
    "input.sourceDigest !== sourceDigest", "await render2316CertificatePdf(source, review)",
  ], "2316 API frozen historical employer and unsigned PDF");
  includesAll(certApi, [
    'if (!frozen || assertEntityResource(entityScope.context,',
    '{ error: "Certificate source not found." }, { status: 404, headers }',
    "if (sourceDenied) return Response.json(",
  ], "2316 unknown-vs-ungranted source parity");
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
    productionCertified: false, existingProvisionalPageReceiptsVerified: true };
}

test("source-current previous employer and BIR 2316 pages retain #1975 employer/grant/revision controls", () => {
  const result = verifyPostFinalPayWorkspaceSources();
  assert.equal(result.existingProvisionalPageReceiptsVerified, true);
  assert.equal(result.pageActionCredits, 0);
  assert.equal(result.productionCertified, false);
});
test("post-transfer direct separation GET and Form 2316 denial parity require real synthetic PG16 proof", () => {
  const proof = readFileSync("scripts/qa/tenant-2316-ssr-transfer-http.mjs", "utf8");
  const required = [
    "requireDisposable2316Env();", "verify2316Sources();",
    "const [legacySep] = await db.insert(s.separationRecords)",
    "const [wrongTypeSep] = await db.insert(s.separationRecords)",
    "const [newEmployerOperator] = await db.insert(s.users)",
    "const listA = await separationList(a.cookie, a.org.id)",
    "const listNewBefore = await separationList(newEmployerSession.cookie, a.org.id)",
    "const historicOldEmployerList = await separationList(a.cookie, a.org.id)",
    "const currentNewEmployerList = await separationList(newEmployerSession.cookie, a.org.id)",
    "assert.deepEqual(foreignCert.json, missingCert.json",
    "currentEmployerCannotReadPriorReleasedSeparation: true",
    "frozenEmployerPatchGrantedOnlyToHistoricOwner: true",
    "foreignAndUnknownSeparationPatchResponseParity: true",
    "const newEmployerForeignPatch = await nonMutatingSeparationPatch(",
    "malformedOrLegacyHistoricalSnapshotsFailClosed: true",
    'independentSecurityReview: "PENDING", productionCertified: false',
  ];
  for (const marker of required)
    assert.ok(proof.includes(marker),
      "POST_FINAL_PAY_REVIEW_REQUIRED: missing executable PG16 source proof " + marker);
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
test("a forged prior-employer provisional receipt is rejected without changing the manifest", () => {
  const read = (path, ...args) => {
    const value = readFileSync(path, ...args);
    if (path !== MANIFEST) return value;
    const m = JSON.parse(String(value));
    m.scopedPages.find(item => item.path === PRIOR).testedBy.proofBlobSha = "0".repeat(40);
    return JSON.stringify(m);
  };
  assert.throws(() => verifyPostFinalPayWorkspaceSources(read), /SIX_PAGE_REFUSED/);
});
test("a fabricated page-action credit is rejected even with a valid source receipt", () => {
  const read = (path, ...args) => {
    const value = readFileSync(path, ...args);
    if (path !== MANIFEST) return value;
    const m = JSON.parse(String(value));
    m.scopedPages.find(item => item.path === CERT).reviewedUncertified.pageActionCredits = 1;
    return JSON.stringify(m);
  };
  assert.throws(() => verifyPostFinalPayWorkspaceSources(read),
    /SIX_PAGE_REFUSED|page action credit|page-action credit/);
});

const ACTION_BROWSER = "scripts/qa/tenant-prior-evidence-action-browser.mjs";
export function verifyPriorEvidenceActionBrowserContract(read = readFileSync) {
  const source = String(read(ACTION_BROWSER));
  const required = [
    "requireDisposableBrowserPdf();", "verifyBrowserPdfSources();",
    "verifyPriorWorkerSource();", 'import("../../src/db/index.ts")',
    'import("playwright")', "await context.request.post(ORIGIN + \"/api/auth/login\"",
    "totpCode: generateTotp(browserTotpSecret)",
    "assert.equal(account.status(), 200)",
    'const initialVictim = evidence("VICTIM-" + uuid)',
    "assert.equal(victimSave.status, 200",
    "allProtected[2] = await snapshot(actualVictim.org.id)",
    '["orgUnits", s.orgUnits]', '["yearEndAdjustments", s.yearEndAdjustments]',
    "result.payrollEntries = await db.select().from(s.payrollEntries)",
    ".innerJoin(s.payrollRuns,",
    "assert.deepEqual(await snapshot(ownerA.org.id), beforeDeniedA",
    "assert.deepEqual(await snapshot(ownerB.org.id), beforeDeniedB",
    "await victimsUnchanged(\"Cross-employer and same-parent denial\")",
    "assert.deepEqual(await snapshot(ownerA.org.id), beforeRevokedReads",
    "await victimsUnchanged(\"Revoked grant\")",
    "assert.equal(check.status,200",
    "assert.equal(sameMaker.status, 409",
    "assert.equal(stale.status,409)",
    "assert.equal(bad?.status(),404",
    "assert.equal(refused?.status(),404)",
    "independentSecurityReview:\"PENDING\",productionCertified:false",
    "realProviderCalls:0,pageActionCredits:0,apiMethodCredits:0",
  ];
  for (const marker of required)
    assert.ok(source.includes(marker),
      "POST_FINAL_PAY_REVIEW_REQUIRED: missing action-browser evidence " + marker);
  for (const auth of [
    "requireDisposableBrowserPdf();", "verifyBrowserPdfSources();",
    "verifyPriorWorkerSource();",
  ]) assert.ok(source.indexOf(auth) < source.indexOf('import("../../src/db/index.ts")'),
    "POST_FINAL_PAY_REVIEW_REQUIRED: unsafe application import before " + auth);
  assert.ok(source.indexOf("const beforeDeniedB = await snapshot(ownerB.org.id)") <
    source.indexOf("const otherOrg = await request("),
    "POST_FINAL_PAY_REVIEW_REQUIRED: foreign B SQL must be snapshotted before denial");
  assert.ok(source.indexOf("const beforeDeniedA = await snapshot(ownerA.org.id)") <
    source.indexOf("const sameParent = await request("),
    "POST_FINAL_PAY_REVIEW_REQUIRED: same-parent SQL must be snapshotted before denial");
  assert.doesNotMatch(source, /context\.addCookies\(/,
    "POST_FINAL_PAY_REVIEW_REQUIRED: do not inject privileged browser cookies");
  return true;
}
test("prior-evidence action browser proves populated victim, real MFA and protected denial SQL", () => {
  assert.equal(verifyPriorEvidenceActionBrowserContract(), true);
});
test("removing any foreign-SQL or login check invalidates the action-browser contract", () => {
  for (const marker of [
    "assert.deepEqual(await snapshot(ownerB.org.id), beforeDeniedB",
    "assert.deepEqual(await snapshot(ownerA.org.id), beforeDeniedA",
    "allProtected[2] = await snapshot(actualVictim.org.id)",
    "totpCode: generateTotp(browserTotpSecret)",
  ]) {
    const read = candidate => {
      const original = readFileSync(candidate, "utf8");
      return candidate === ACTION_BROWSER ? original.replace(marker, "REMOVED_SOURCE_PROOF") : original;
    };
    assert.throws(() => verifyPriorEvidenceActionBrowserContract(read),
      /POST_FINAL_PAY_REVIEW_REQUIRED/,
      "No previous successful browser receipt may substitute for " + marker);
  }
});

const TARGETED_WORKFLOWS = [
  ".github/workflows/tenant-prior-review-worker-ssr-qa.yml",
  ".github/workflows/tenant-2316-ssr-transfer-qa.yml",
  ".github/workflows/tenant-2316-browser-pdf-qa.yml",
];
const SHARED_REPROOF_INPUTS = [
  "src/app/workspace/prior-employer/page.tsx",
  "src/app/workspace/2316/page.tsx",
  "src/components/workspace/year-end-prior-review.tsx",
  "src/components/workspace/certificate-2316-review.tsx",
  "src/lib/year-end-prior-evidence.ts",
  "src/lib/year-end-prior-evidence-server.ts",
  "src/lib/multi-entity-policy.ts",
  "src/lib/multi-entity-server.ts",
  "src/lib/auth.ts",
  "src/lib/access.ts",
  "src/lib/permissions.ts",
  "src/lib/organization-auth-policy.ts",
  "src/lib/security-request.ts",
  "src/lib/tenant-prior-review-worker.ts",
  "src/lib/tenant-payroll-review-page.ts",
  "src/lib/critical-release-flags.ts",
  "src/lib/crypto.ts",
  "src/lib/government-id-crypto.ts",
  "src/lib/security-secret.ts",
  "src/lib/totp.ts",
  "src/db/schema.ts",
  "src/db/index.ts",
  "scripts/qa/tenant-table-http.mjs",
  "scripts/qa/apply-isolated-baseline.mjs",
  "tests/tenant-prior-review-worker-contract.test.mjs",
  "tests/tenant-2316-ssr-transfer.test.mjs",
  "tests/tenant-2316-browser-pdf-contract.test.mjs",
  "tests/tenant-2316-legal-employer-worker.test.ts",
  "package.json",
  "package-lock.json"
];

export function verifyTargetedWorkflowWatchers(read = readFileSync) {
  for (const path of TARGETED_WORKFLOWS) {
    const source = String(read(path));
    const selected = source.split("    paths:\n")[1]?.split("  workflow_dispatch:")[0];
    assert.ok(selected,
      "POST_FINAL_PAY_REVIEW_REQUIRED: missing pull-request path triggers " + path);
    for (const dependency of SHARED_REPROOF_INPUTS)
      assert.ok(selected.includes('      - "' + dependency + '"'),
        "POST_FINAL_PAY_REVIEW_REQUIRED: " + path + " ignores " + dependency);
    assert.ok(source.includes("github.event.pull_request.head.sha"),
      "POST_FINAL_PAY_REVIEW_REQUIRED: exact-head PR checkout missing " + path);
    assert.ok(source.includes("image: postgres:16"),
      "POST_FINAL_PAY_REVIEW_REQUIRED: disposable PG16 missing " + path);
  }
  return true;
}
test("all three exact-head PG16 workflows watch shared identity, HR, 2316 and prior-evidence dependencies", () => {
  assert.equal(verifyTargetedWorkflowWatchers(), true);
});
test("dropping any watched private source invalidates the three-workflow regression", () => {
  const sourceToRemove = "src/components/workspace/year-end-prior-review.tsx";
  for (const workflow of TARGETED_WORKFLOWS) {
    const read = (path, ...args) => {
      const contents = String(readFileSync(path, ...args));
      return path === workflow ?
        contents.replace('      - "' + sourceToRemove + '"\n', "") : contents;
    };
    assert.throws(() => verifyTargetedWorkflowWatchers(read),
      /POST_FINAL_PAY_REVIEW_REQUIRED/,
      workflow + " may not silently stop watching prior-employer browser hydration");
  }
});
