import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseRemittanceMonthCloseRead } from "../src/lib/remittance-month-close-read";

const digest = (char: string) => char.repeat(64);
const validRead = () => ({
  organizationId: 17,
  applicableMonth: "2026-09",
  legalEntity: { id: 88, code: "FICT", displayName: "Fictional employer" },
  certificationRole: "independent-reviewer",
  evaluation: {
    ready: false, blockers: ["SSS posting evidence missing."],
    snapshotHash: digest("a"), agencyCount: 1, memberCount: 1,
    batches: [{ id: 101, agency: "SSS", status: "pending", snapshotHash: digest("b"), pendingPostingCount: 1, exceptionCount: 0 }],
    members: [{ batchId: 101, employeeId: 201, postingStatus: "pending" }],
    paymentEvidence: [], corrections: [], issueCases: [],
  },
  closure: null,
  certificationHistory: [],
  certificationValid: false,
});

const parse = (value: unknown, entity: number | null = 88) =>
  parseRemittanceMonthCloseRead(value, 17, entity, "2026-09");

test("complete blocked and ready responses are distinguishable from unknown", () => {
  const blocked = validRead();
  assert.equal(parse(blocked)?.evaluation.ready, false);
  const ready = { ...blocked, evaluation: { ...blocked.evaluation, blockers: [], ready: true } };
  assert.equal(parse(ready)?.evaluation.ready, true);
  assert.equal(parse(ready, null)?.legalEntity.id, 88);
  assert.equal(parse({}), null);
  assert.equal(parse({ ...ready, evaluation: undefined }), null);
});

test("failed/malformed successes cannot display 0, ready or certification for a foreign scope", () => {
  const valid = validRead();
  const invalid: unknown[] = [
    { ...valid, organizationId: 18 },
    { ...valid, applicableMonth: "2026-08" },
    { ...valid, legalEntity: { ...valid.legalEntity, id: 89 } },
    { ...valid, legalEntity: undefined },
    { ...valid, certificationRole: "owner" },
    { ...valid, evaluation: { ...valid.evaluation, ready: true } },
    { ...valid, evaluation: { ...valid.evaluation, blockers: [], ready: false } },
    { ...valid, evaluation: { ...valid.evaluation, agencyCount: 0 } },
    { ...valid, evaluation: { ...valid.evaluation, memberCount: 0 } },
    { ...valid, evaluation: { ...valid.evaluation, memberCount: -1 } },
    { ...valid, evaluation: { ...valid.evaluation, snapshotHash: "missing" } },
    { ...valid, evaluation: { ...valid.evaluation, members: undefined } },
    { ...valid, evaluation: { ...valid.evaluation, batches: [{ ...valid.evaluation.batches[0], pendingPostingCount: "0" }] } },
    { ...valid, evaluation: { ...valid.evaluation, batches: [valid.evaluation.batches[0], valid.evaluation.batches[0]], agencyCount: 2 } },
    { ...valid, evaluation: { ...valid.evaluation, members: [{ batchId: 102, employeeId: 201, postingStatus: "posted" }] } },
    { ...valid, certificationHistory: undefined },
    { ...valid, certificationValid: true },
    { closure: null, evaluation: valid.evaluation, certificationValid: true }, // short POST response, not GET
  ];
  for (const input of invalid) assert.equal(parse(input), null);
  assert.equal(parseRemittanceMonthCloseRead(valid, 18, 88, "2026-09"), null);
  assert.equal(parseRemittanceMonthCloseRead(valid, 17, 88, "2026-08"), null);
});

test("claimed certification requires matched immutable closure, source scope and history", () => {
  const current = validRead();
  const ready = { ...current, evaluation: { ...current.evaluation, ready: true, blockers: [] } };
  const closure = {
    id: 55, organizationId: 17, legalEntityId: 88,
    applicableMonth: "2026-09", status: "certified",
    certifiedByName: "Fictional independent reviewer",
    certifiedAt: "2026-10-19T10:00:00.000Z", snapshotHash: digest("a"),
  };
  const certified = { ...ready, closure, certificationHistory: [closure], certificationValid: true };
  assert.equal(parse(certified)?.certificationValid, true);
  assert.equal(parse({ ...certified, closure: { ...closure, snapshotHash: digest("c") } }), null);
  assert.equal(parse({ ...certified, closure: { ...closure, organizationId: 18 } }), null);
  assert.equal(parse({ ...certified, certificationHistory: [{ ...closure, legalEntityId: 89 }] }), null);
  assert.equal(parse({ ...certified, certificationHistory: [closure, closure] }), null);
  assert.equal(parse({ ...certified, certificationValid: false }), null);
  assert.equal(parse({ ...certified, closure: null }), null);
  const stale = { ...certified, evaluation: { ...ready.evaluation, snapshotHash: digest("d") }, certificationValid: false };
  assert.equal(parse(stale)?.certificationValid, false);
});

test("the client refuses incomplete read and re-reads after write before showing success", () => {
  const ui = readFileSync("src/components/workspace/statutory-remittance-month-close.tsx", "utf8");
  const api = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");
  assert.match(api, /\.\.\.publicResult,\s*organizationId,\s*applicableMonth,/);
  assert.match(ui, /setState\(null\)/);
  assert.match(ui, /parseRemittanceMonthCloseRead\(/);
  assert.match(ui, /if \(loading\)/);
  assert.match(ui, /if \(!state\)/);
  assert.match(ui, /Certification status unavailable/);
  assert.match(ui, /const verified = await load\(\)/);
  assert.match(ui, /verified\?\.certificationValid && verified\.closure\?\.snapshotHash === requestedSnapshot/);
  assert.doesNotMatch(ui, /setState\(body as CloseState\)/);
});


test("new method-level tenant proof survives CI/source drift (GET and POST)", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const path = "src/app/api/compliance/remittance-month-close/route.ts";
  const record = manifest.allApiRouteFiles[path];
  assert.equal(manifest.metrics.methods, 493, "493 actual methods including the three inherited #641 handlers");
  // Pin the current ledger exactly: the two DL-01 vault methods and eight
  // money-input methods retain their independent proofs; MNY-02 adds six
  // separately linked contractor/EWT methods, with 337 methods still GAP after the extra group-report GET.
  // This is provisional coverage; no production or global audit sign-off.
  for (const [vaultRoute, vaultMethod] of [
    ["src/app/api/employee-vault/route.ts", "GET"],
    ["src/app/api/employee-vault/[id]/route.ts", "DELETE"],
  ]) {
    const method = manifest.allApiRouteFiles[vaultRoute]?.methods.find(
      (item: { name: string }) => item.name === vaultMethod,
    );
    assert.equal(method?.status, "COVERED", vaultMethod + " vault requires distinct own/foreign HTTP proof");
    assert.equal(method?.testedBy?.file, "scripts/qa/tenant-dl01-vault-http.mjs");
  }
  // Main contributes independent legal-employer scoped government-loan and DOLE proofs.
  // PR #1325 contributes three other real HTTP proofs; never double-credit these.
  assert.equal(manifest.metrics.coveredAfter, 146, "Preserve main/BIR/vault, eight money inputs and six source-pinned contractor methods");
  assert.equal(manifest.metrics.publicByDesign, 10);
  assert.equal(manifest.metrics.gap, 337, "Retain the remaining unproven methods as GAP");
  // Preserve the 91 pre-sweep proofs, not an obsolete total. New suites
  // can only close GAPs if every method cites the corresponding isolated HTTP
  // suite, executed for both attacker employers against real victim rows.
  const newSuites = [
    { file: "scripts/qa/compliance-read-sweep-http.mjs",
      entry: "verifyComplianceReadSweep",
      keys: [
        "GET bir/annual-employer/module-evidence", "POST bir/annual-employer/module-evidence",
        "GET compliance/dole-13th-month", "POST compliance/dole-13th-month",
        "GET compliance/government-loan-remittances", "POST compliance/government-loan-remittances",
        "GET compliance/statutory-remittances/payment-evidence",
        "POST compliance/statutory-remittances/payment-evidence",
      ] },
    { file: "scripts/qa/hcm-probation-sweep-http.mjs",
      entry: "verifyHcmProbationSweep",
      keys: [
        "GET hcm/probation-reviews", "POST hcm/probation-reviews",
        "PATCH hcm/probation-reviews",
      ] },
  ];
  const harnessLines = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8").split("\n");
  let newlySourcePinned = 0;
  for (const suite of newSuites) {
    const inheritedMainProof = new Map([
      ["GET compliance/statutory-remittances/payment-evidence", "scripts/qa/tenant-manifest-driven-http.mjs"],
        ["POST compliance/statutory-remittances/payment-evidence", "scripts/qa/tenant-manifest-driven-http.mjs"],
      ["GET compliance/dole-13th-month", "scripts/qa/dole-13th-month-http.mjs"],
      ["POST compliance/dole-13th-month", "scripts/qa/dole-13th-month-http.mjs"],
      ["GET compliance/government-loan-remittances", "scripts/qa/government-loan-read-http.mjs"],
      ["POST compliance/government-loan-remittances", "scripts/qa/government-loan-read-http.mjs"],
    ]);
    const methods = suite.keys.map((key) => {
      const [name, route] = key.split(" ");
      const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]
        ?.methods.find((entry: { name: string }) => entry.name === name);
      assert.ok(method, key + ": method must exist");
      assert.ok(method.status === "GAP" ||
        (method.status === "COVERED" && (method.testedBy?.file === suite.file ||
          inheritedMainProof.get(key) === method.testedBy?.file)),
        key + ": only actual source-pinned own/victim HTTP tests may close a GAP");
      if (method.status === "GAP") assert.equal(method.testedBy, null);
      return method;
    });
    const externalMain = methods.filter((method, index) => method.status === "COVERED" &&
      inheritedMainProof.get(suite.keys[index]) === method.testedBy?.file).length;
    const added = methods.filter((method) => method.status === "COVERED" &&
      method.testedBy?.file === suite.file).length;
    assert.ok(added === 0 || added + externalMain === suite.keys.length,
      suite.file + ": partial HTTP suites cannot receive method-level credit");
    if (!added) continue;
    assert.ok(harnessLines.some(line => line.includes(suite.entry + "(f, { request, expectStatus })")),
      suite.file + ": proof must run in the guarded PG16 second-pass HTTP job");
    const source = readFileSync(suite.file, "utf8").split("\n");
    assert.ok(source.some(line => line.includes("for (const idx of [1, 2])")),
      suite.file + ": exercise two independent attackers");
    for (const method of methods.filter(method => method.testedBy?.file === suite.file)) {
      const { ownPositiveLine, foreignDenialLine, unchangedDbLine } = method.testedBy;
      assert.match(source[ownPositiveLine - 1] ?? "", /expectStatus\(await request(?:Multipart)?\(/,
        method.name + ": authenticated own-employer success required");
      assert.match(source[foreignDenialLine - 1] ?? "", /403\s*,/,
        method.name + ": foreign-employer 403 required");
      if (method.name !== "GET") assert.match(source[unchangedDbLine - 1] ?? "",
        /assert\.deepEqual\(/,
        method.name + ": denied mutation must leave victim rows unchanged");
    }
    // The HCM probation methods are inherited from main/#1326: validate their
    // own/foreign evidence above, but do not subtract them as newly added here.
    if (suite.entry === "verifyComplianceReadSweep") newlySourcePinned += added;
  }
  assert.equal(newlySourcePinned, 2, "PR #1325 adds exactly the two BIR method proofs; other suites are inherited");
  const moneyMethods = (Object.values(manifest.allApiRouteFiles) as Array<{
    methods: Array<{ status: string; testedBy?: { file: string } }>;
  }>).flatMap(route => route.methods).filter(method =>
    method.testedBy?.file === "scripts/qa/tenant-money-lifecycle-http.mjs");
  assert.equal(moneyMethods.length, 8, "Only the separately executed eight money-input cases are additional credits");
  assert.ok(moneyMethods.every(method => method.status === "COVERED"));
  const groupReport = manifest.allApiRouteFiles["src/app/api/multi-entity/reports/route.ts"]
    ?.methods.find((method: { name: string }) => method.name === "GET");
  assert.equal(groupReport?.status, "COVERED", "Group report cannot receive a credit without its own GET proof");
  assert.equal(groupReport?.testedBy?.file, "scripts/qa/multi-entity-group-report-http.mjs",
    "Group report may not borrow a money-input or unrelated source proof");
  const groupReportLines = readFileSync(groupReport.testedBy.file, "utf8").split("\n");
  assert.match(groupReportLines[groupReport.testedBy.line - 1] ?? "", /const bVictims = await database\.query\(/);
  assert.match(groupReportLines[groupReport.testedBy.ownPositiveLine - 1] ?? "", /const ownReport = await request\(caller, on,/);
  assert.match(groupReportLines[groupReport.testedBy.foreignDenialLine - 1] ?? "", /assert\.equal\(deniedVictim\.status, 403,/);
  assert.match(groupReportLines.join("\n"), /assert\.equal\(refusedReleasedRun\.status, 409,/);
  const groupReportCredits = 1;
  // Preserve the original 129/354 main-method baseline. The six MNY-02 credits
  // are additional only when each distinct contractor/EWT route/method points
  // to its own executed two-attacker HTTP proof and unchanged victim DB rows.
  const contractorEvidenceFile = "scripts/qa/tenant-mny02-contractors-http.mjs";
  const contractorEvidence = readFileSync(contractorEvidenceFile, "utf8").split("\n");
  const contractorCases = [
    { method: "GET", route: "contractors", own: 138, foreign: 143 },
    { method: "POST", route: "contractors", own: 54, foreign: 152 },
    { method: "PATCH", route: "contractors", own: 167, foreign: 160 },
    { method: "DELETE", route: "contractors", own: 186, foreign: 180 },
    { method: "GET", route: "contractors/payments", own: 194, foreign: 201 },
    { method: "POST", route: "contractors/payments", own: 73, foreign: 220 },
  ] as const;
  const contractorMethods = (Object.values(manifest.allApiRouteFiles) as Array<{
    methods: Array<{ name: string; status: string; testedBy?: { file: string } }>;
  }>).flatMap(entry => entry.methods.filter(method =>
    method.testedBy?.file === contractorEvidenceFile));
  assert.equal(contractorMethods.length, contractorCases.length,
    "Only six distinct reviewed contractor/EWT methods can be credited");
  assert.ok(harnessLines.some(line =>
    line.includes("verifyMny02ContractorTenantIsolation(f, { request, expectStatus })")),
  "Contractor proof must execute in the guarded PG16 real-HTTP harness");
  for (const item of contractorCases) {
    const key = item.method + " " + item.route;
    const m = manifest.allApiRouteFiles["src/app/api/" + item.route + "/route.ts"]
      ?.methods.find((candidate: { name: string }) => candidate.name === item.method);
    assert.equal(m?.status, "COVERED", key + ": real own/victim proof is required");
    assert.equal(m?.testedBy?.file, contractorEvidenceFile,
      key + ": unrelated HTTP evidence may not be substituted");
    assert.equal(m?.testedBy?.ownPositiveLine, item.own);
    assert.equal(m?.testedBy?.foreignDenialLine, item.foreign);
    assert.equal(m?.testedBy?.unchangedDbLine, 271);
    assert.match(contractorEvidence[item.own - 1] ?? "", /expectStatus\(await request\(/,
      key + ": exact own HTTP proof line required");
    assert.match(contractorEvidence[item.foreign - 1] ?? "", /expectStatus\(await request\(/,
      key + ": exact foreign HTTP denial line required");
    assert.match(contractorEvidence[270] ?? "",
      /assert\.deepEqual\(await victimSnapshot\(victim\.id\), originalVictim/,
      key + ": victim SQL snapshot must remain identical");
  }
  assert.equal(manifest.metrics.coveredAfter - newlySourcePinned - moneyMethods.length - contractorCases.length - groupReportCredits, 129,
    "Keep all 129 independently source-pinned methods from merged main, not counting new MNY-02");
  assert.equal(manifest.metrics.gap + newlySourcePinned + moneyMethods.length + contractorCases.length + groupReportCredits, 354,
    "Never reduce main's 354 originally open method GAPs without distinct own/victim HTTP proof");
  assert.equal(manifest.metrics.coveredAfter + manifest.metrics.publicByDesign + manifest.metrics.gap, 493);
  const readLine = (number: number) => {
    assert.ok(Number.isInteger(number) && number > 0 && number <= harnessLines.length);
    return harnessLines[number - 1];
  };
  for (const name of ["GET", "POST"]) {
    const method = record.methods.find((candidate: { name: string }) => candidate.name === name);
    assert.equal(method?.status, "COVERED", name + " must not borrow an anonymous 403");
    assert.equal(method?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs");
    const own = readLine(method.testedBy.ownPositiveLine);
    const foreign = readLine(method.testedBy.foreignDenialLine);
    const victimUnchanged = readLine(method.testedBy.unchangedDbLine);
    assert.ok(own.includes("/api/compliance/remittance-month-close") && own.includes("), 200,"),
      name + ": actual own employer positive 200 required");
    assert.ok(foreign.includes("/api/compliance/remittance-month-close") &&
      foreign.includes("victim.id") && foreign.includes("), 403,"),
      name + ": real victim employer exact 403 required");
    assert.match(victimUnchanged, /assert\.deepEqual\(victimClosuresAfter, victimClosuresBefore/);
    if (name === "POST") {
      assert.ok(own.includes('method: "POST"') && foreign.includes('method: "POST"'));
      assert.ok(harnessLines.some(line => line.includes("persistedClosure?.id, ownMonthClosePost.json.closure.id")),
        "Own POST must persist actual certifying record, not just succeed with a stub");
    }
  }
  assert.ok(harnessLines.some(line => line.includes('await verifyRemittanceMonthCloseTenantProof(f);')),
    "Method-level test must be executed by existing real-HTTP disposable PG16 job");
  // The disposable PG16 source fixture moved to January to avoid overlapping
  // a released payroll period. Pin the actual method-level proof month, rather
  // than a stale September string that no longer occurs in the live harness.
  const remittanceProofStart = harnessLines.findIndex(line =>
    line.includes("async function verifyRemittanceMonthCloseTenantProof(f)"));
  assert.ok(remittanceProofStart >= 0, "Real remittance proof must exist");
  assert.ok(harnessLines.slice(remittanceProofStart, remittanceProofStart + 40)
    .some(line => line.trim() === 'const period = "2026-01";'),
    "Remittance GET and POST must share the reviewed January synthetic payroll period");
  assert.ok(harnessLines.some(line => line.includes('status: "reconciled"')));
  assert.ok(harnessLines.some(line => line.includes('fileSha256: createHash("sha256")')));
  assert.ok(harnessLines.some(line => line.includes('assert.deepEqual(victimBatchesAfter, victimBatchesBefore')));
  assert.ok(harnessLines.some(line => line.includes('assert.deepEqual(victimEvidenceAfter, victimEvidenceBefore')));
});


test("actual server active payment-proof shape parses without nonexistent status field", () => {
  const original = validRead();
  const proof = {
    id: 303, batchId: 101, fileName: "fictional-payment-proof.pdf",
    fileSha256: digest("c"), byteSize: 82,
    uploadedByName: "Fictional independent treasury reviewer",
    uploadedAt: "2026-10-19T08:00:00.000Z",
  };
  const ready = {
    ...original,
    evaluation: { ...original.evaluation, ready: true, blockers: [], paymentEvidence: [proof] },
  };
  assert.equal(parse(ready)?.evaluation.ready, true,
    "Valid active proof is emitted without status by evaluateRemittanceMonthClose");
  const invalid = [
    { ...proof, batchId: 202 },
    { ...proof, fileSha256: "" },
    { ...proof, byteSize: 0 },
    { ...proof, uploadedByName: "" },
    { ...proof, uploadedAt: "not-a-date" },
  ];
  for (const broken of invalid) {
    assert.equal(parse({
      ...ready, evaluation: { ...ready.evaluation, paymentEvidence: [broken] },
    }), null, "Incomplete or foreign active proof must fail closed");
  }
  const evaluator = readFileSync("src/lib/statutory-remittance-close.ts", "utf8");
  assert.match(evaluator, /paymentEvidence: activePaymentEvidence/);
  assert.match(evaluator, /uploadedByName: evidence.uploadedByName/);
  assert.match(evaluator, /uploadedAt: String\(evidence.uploadedAt\)/);
});
