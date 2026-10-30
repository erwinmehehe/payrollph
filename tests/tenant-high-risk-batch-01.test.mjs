import { verifyPromotionCredits } from "../scripts/qa/tenant-gap-promotion-verify.mjs";
import { verifyCredits as verifyPerformanceCoreCredits } from "../scripts/qa/tenant-performance-core-credit.mjs";
import { verifyFollowOnCredits } from "../scripts/qa/tenant-follow-on-credit-verify.mjs";
import { verifyMoreCredits } from "../scripts/qa/tenant-more-credit-verify.mjs";
import { verifyPost1523Credits } from "../scripts/qa/tenant-post1523-credit-verify.mjs";
import { verifyMergedProofCredits } from "../scripts/qa/tenant-merged-proof-credits.mjs";
import { verifyCredits as verifySelfDevelopmentCredits } from "../scripts/qa/tenant-self-development-credit.mjs";
/**
 * Static proof-integrity gate for the first high-risk tenant audit batch.
 * Does not claim HTTP coverage; live results must pass the original Security
 * HTTP Smoke workflow using disposable PG16 and localhost production server.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/qa/tenant-high-risk-01-http.mjs", "utf8");
const harness = readFileSync("scripts/qa/tenant-second-pass-http.mjs", "utf8");
const names = [...source.matchAll(/^\s+"(GET [^"]+)",$/gm)].map((m) => m[1]);

test("high-risk batch has 16 unique exported GET methods with actual route files", () => {
  assert.equal(names.length, 16, "Exactly 16 explicitly selected high-risk methods");
  assert.equal(new Set(names).size, 16, "No duplicated credit for a single handler");
  for (const spec of names) {
    const [method, route] = spec.split(" ");
    assert.equal(method, "GET");
    const path = "src/app/api/" + route + "/route.ts";
    const routeSource = readFileSync(path, "utf8");
    assert.match(routeSource, /export\s+async\s+function\s+GET\s*\(/,
      spec + " must exist as actual production HTTP method");
  }
});

test("live batch is executed from existing disposable two-attacker PG/HTTP harness", () => {
  assert.match(harness, /await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\);/);
  assert.match(harness, /await verifyCrossTenant\(f\);[\s\S]*await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\);/);
  assert.match(harness, /function requireDisposable\(\)/);
  assert.match(harness, /app\.hostname !== "127\.0\.0\.1"/);
  assert.match(source, /process\.env\.TENANT_SECOND_PASS_MODE, "isolated-ci-only"/);
  assert.match(source, /await request\(item\.own, \{ cookie: ownerCookie \}\)/);
  assert.match(source, /await request\(item\.foreign, \{ cookie: ownerCookie \}\)/);
  assert.match(source, /expectStatus\(await request\(item\.foreign, \{ cookie: ownerCookie \}\), 403/);
});

test("every method requires real seeded owner-positive, real victim denial and no victim DB mutation", () => {
  assert.match(source, /const ownEntry = \(await db\.select\(\)\.from\(payrollEntries\)/);
  assert.match(source, /victimEntry\?\.id > 6/);
  assert.match(source, /const owned = expectStatus\(await request\(item\.own, \{ cookie: ownerCookie \}\), 200/);
  assert.match(source, /assertNoVictimBytes\(foreign, victimMarker\)/);
  assert.match(source, /await takeVictimSnapshot\(victim\.id\)/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
  assert.match(source, /throw new AggregateError/);
  assert.match(source, /assert\.equal\(passed\.size, 36/);
  assert.match(source, /assert\.deepEqual\(ownPositive, \[16, 16\]\)/);
  assert.match(source, /assert\.deepEqual\(deniedForeign, \[17, 17\]\)/);
});

test("self-service routes use real employee sessions and revoke real memberships", () => {
  assert.match(source, /employeeId: f\.ownedEmployees\[idx - 1\]\.id/);
  assert.match(source, /employeeAccounts\.map\(\(account\) => makeSession\(account\.id\)\)/);
  assert.match(source, /await db\.update\(userOrganizations\)\.set\(\{ active: false \}\)/);
  assert.match(source, /assert\.equal\(revoked\[0\]\?\.active, false\)/);
  assert.match(source, /assert\.equal\(destination\[0\]\?\.active, true\)/);
  assert.match(source, /expectStatus\(await request\("\/api\/account", \{ cookie: employeeCookie \}\), 200/);
  assert.match(source, /expectStatus\(await request\(endpoint, \{ cookie: employeeCookie \}\), 403/);
  assert.match(source, /"GET self\/payslips\/\[id\]\/explain"/);
  assert.match(source, /"GET self\/documents"/);
});

test("12 net-new Batch 01 high-risk GET receipts preserve current-main tenant proofs", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const mergedProofCredits = verifyMergedProofCredits(manifest);
  const cases = [...source.matchAll(/^\s+"(GET [^"]+)",$/gm)].map((m) => m[1]);
  assert.equal(cases.length, 16, "Never silently narrow the tested Batch 01 method set");
  assert.equal(new Set(cases).size, 16);
  const pendingReview = [];
  for (const spec of cases) {
    const route = spec.slice("GET ".length);
    const method = manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]?.methods.find((m) => m.name === "GET");
    assert.equal(method?.status, "COVERED", spec + " must have actual executed own/victim evidence");
    if (method.testedBy.file !== "scripts/qa/tenant-high-risk-01-http.mjs") continue;
    pendingReview.push(spec);
    const proof = method.testedBy;
    const lines = source.split("\n");
    const signature = lines[proof.line - 1];
    assert.ok(signature && (signature.includes('key: "' + spec + '"') ||
      signature.includes('await caseCheck("' + spec + '"')),
      spec + ": must link a unique route-specific case, not a generic handler");
    assert.match(lines[proof.ownPositiveLine - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[proof.foreignDenialLine - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(lines[proof.unchangedDbLine - 1] ?? "", /assert\.deepEqual\(victimAfter, victimBefore/);
    assert.match(method.reason, /^Provisional:/);
    assert.match(proof.scope, /independent|Two independent/);
  }
  assert.equal(pendingReview.length, 12, "The thirteenth GET has newer independent current-main proof; never double-credit it");
  const payExplain = manifest.allApiRouteFiles["src/app/api/self/payslips/[id]/explain/route.ts"]
    ?.methods.find((m) => m.name === "GET");
  assert.equal(payExplain?.status, "COVERED");
  assert.equal(payExplain?.testedBy?.file, "scripts/qa/tenant-second-pass-http.mjs",
    "Keep the newer source-matched own/foreign real-HTTP pay-explanation proof");
  // Preserve all inherited main-branch receipts, including payment-evidence and merged vault proofs. Newly
  // credited routes may only add to this historical count when their specific
  // isolated two-attacker HTTP suite is wired into the real PG16 harness.
  // Never "fix" this gate by substituting a new total without proof.
  const additionalSuites = [
    {
      file: "scripts/qa/compliance-read-sweep-http.mjs",
      entrypoint: "verifyComplianceReadSweep",
      methods: [
        "GET bir/annual-employer/module-evidence",
        "POST bir/annual-employer/module-evidence",
        "GET compliance/dole-13th-month",
        "POST compliance/dole-13th-month",
        "GET compliance/government-loan-remittances",
        "POST compliance/government-loan-remittances",
        "GET compliance/statutory-remittances/payment-evidence",
        "POST compliance/statutory-remittances/payment-evidence",
      ],
    },
    {
      file: "scripts/qa/hcm-probation-sweep-http.mjs",
      entrypoint: "verifyHcmProbationSweep",
      methods: [
        "GET hcm/probation-reviews",
        "POST hcm/probation-reviews",
        "PATCH hcm/probation-reviews",
      ],
    },
  ];
  const methodsByKey = new Map(Object.values(manifest.allApiRouteFiles).flatMap((route) =>
    route.methods.map((method) => [method.name + " " + route.route, method])));
  let additionalSourcePinnedMethods = 0;
  for (const suite of additionalSuites) {
    const statuses = suite.methods.map((key) => {
      const method = methodsByKey.get(key);
      assert.ok(method, key + ": reviewed route and method must still exist");
      const inheritedMainSources = new Map([
        ["GET compliance/statutory-remittances/payment-evidence", "scripts/qa/tenant-manifest-driven-http.mjs"],
        ["POST compliance/statutory-remittances/payment-evidence", "scripts/qa/tenant-manifest-driven-http.mjs"],
        ["GET compliance/dole-13th-month", "scripts/qa/dole-13th-month-http.mjs"],
        ["POST compliance/dole-13th-month", "scripts/qa/dole-13th-month-http.mjs"],
        ["GET compliance/government-loan-remittances", "scripts/qa/government-loan-read-http.mjs"],
        ["POST compliance/government-loan-remittances", "scripts/qa/government-loan-read-http.mjs"],
      ]);
      const mainEvidence = method.status === "COVERED" &&
        method.testedBy?.file === inheritedMainSources.get(key);
      assert.ok(method.status === "GAP" || mainEvidence ||
        (method.status === "COVERED" && method.testedBy?.file === suite.file),
        key + ": a historical GAP can only close with its reviewed own/victim HTTP evidence");
      if (method.status === "GAP") assert.equal(method.testedBy, null);
      return method.status === "COVERED" && method.testedBy?.file !== suite.file ? "INHERITED" : method.status;
    });
    const added = statuses.filter((status) => status === "COVERED").length;
    const inherited = statuses.filter((status) => status === "INHERITED").length;
    assert.ok(added === 0 || added + inherited === suite.methods.length,
      suite.file + ": an incomplete/partial proof suite cannot silently receive credit");
    if (!added) continue;
    const runner = readFileSync(suite.file, "utf8");
    assert.ok(harness.includes(suite.entrypoint + "(f, { request, expectStatus })"),
      suite.file + ": actual disposable HTTP/PG16 harness must execute the suite");
    assert.match(runner, /process\.env\.TENANT_SECOND_PASS_MODE/);
    assert.match(runner, /for \(const idx of \[1, 2\]\)/);
    const proofLines = runner.split("\n");
    for (const key of suite.methods) {
      const method = methodsByKey.get(key);
      if (method.testedBy?.file !== suite.file) {
        assert.ok(["scripts/qa/tenant-manifest-driven-http.mjs",
          "scripts/qa/dole-13th-month-http.mjs",
          "scripts/qa/government-loan-read-http.mjs"].includes(method.testedBy?.file),
          key + ": inherited source must have its independently reviewed main HTTP suite");
        assert.ok(method.testedBy.ownPositiveLine && method.testedBy.foreignDenialLine);
        continue;
      }
      assert.equal(method.testedBy.file, suite.file);
      const { ownPositiveLine, foreignDenialLine, unchangedDbLine } = method.testedBy;
      assert.match(proofLines[ownPositiveLine - 1] ?? "",
        /expectStatus\(await request(?:Multipart)?\(/,
        key + ": source-pinned authenticated own-employer HTTP success is required");
      assert.match(proofLines[foreignDenialLine - 1] ?? "", /403\s*,/,
        key + ": source-pinned real victim-employer HTTP denial is required");
      if (!key.startsWith("GET ")) {
        assert.match(proofLines[unchangedDbLine - 1] ?? "", /assert\.deepEqual\(/,
          key + ": denied writes must leave victim PostgreSQL rows unchanged");
      }
    }
    additionalSourcePinnedMethods += added;
  }
  // Account for the two newly credited vault methods only when their
  // standalone, flag-scoped, two-attacker PG16 HTTP source proof remains linked.
  // This is provisional evidence, NOT production or whole-system certification.
  const vaultSourceFile = "scripts/qa/tenant-dl01-vault-http.mjs";
  const vaultLines = readFileSync(vaultSourceFile, "utf8").split("\n");
  assert.match(harness, /TENANT_DL01_VAULT_PROOF === "isolated-ci-only"/);
  assert.match(harness, /verifyDl01Vault\(f, \{ request, expectStatus \}\)/);
  let vaultSourcePinnedMethods = 0;
  for (const [key, expectedStatus] of [
    ["GET employee-vault", 200],
    ["DELETE employee-vault/[id]", 204],
  ]) {
    const method = methodsByKey.get(key);
    assert.equal(method?.status, "COVERED", key + ": provisional credit requires the live method proof");
    assert.equal(method.testedBy?.file, vaultSourceFile, key + ": only its own suite can prove this method");
    const proof = method.testedBy;
    const own = vaultLines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 4).join("\n");
    const foreign = vaultLines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 4).join("\n");
    assert.match(own, /expectStatus\(await request\(/);
    assert.ok(own.includes("), " + expectedStatus + ","),
      key + ": an actual own-employer HTTP success is required");
    assert.match(foreign, /expectStatus\(await request\(/);
    assert.match(foreign, /\), 403,/, key + ": a real victim-employer denial is required");
    assert.match(vaultLines[proof.unchangedDbLine - 1] ?? "",
      /assert\.deepEqual\(await victimSnapshot\(victimOrg\.id\), before/,
      key + ": victim PostgreSQL records must remain unchanged");
    vaultSourcePinnedMethods++;
  }
  assert.equal(vaultSourcePinnedMethods, 2, "No partial or double-credited vault closeout");
  const moneyMethods = Object.values(manifest.allApiRouteFiles).flatMap(r => r.methods)
    .filter(m => m.testedBy?.file === "scripts/qa/tenant-money-lifecycle-http.mjs");
  assert.equal(moneyMethods.length, 7,
    "The seven non-process money methods retain their exact own-success/foreign-denial proofs");
  assert.ok(moneyMethods.every(m => m.status === "COVERED" && m.testedBy.ownPositiveLine &&
    m.testedBy.foreignDenialLine && m.testedBy.unchangedDbLine && m.testedBy.forgedSelectorLine));

  // The process route was modified to REFUSE calculation until its statutory
  // packs are independently verified. Its original positive-money proof is
  // historical, not current. Credit the source-pinned own-422/foreign-403
  // boundary separately; do not call it a successful calculation.
  const processMethod = methodsByKey.get("POST payroll-runs/[id]/process");
  const preRunMethod = methodsByKey.get("GET payroll-runs/[id]/pre-run-readiness");
  const preRunProofFile = "scripts/qa/tenant-second-pass-http.mjs";
  const preRunLines = readFileSync(preRunProofFile, "utf8").split("\n");
  assert.equal(processMethod?.status, "COVERED", "Calculation entry must retain method-specific tenant authorization");
  assert.equal(preRunMethod?.status, "COVERED", "Readiness GET must retain method-specific tenant authorization");
  assert.equal(processMethod?.testedBy?.file, preRunProofFile);
  assert.equal(preRunMethod?.testedBy?.file, preRunProofFile);
  assert.match(harness, /await verifyPreRunReadinessTenantRead\(f\)/,
    "The new tenant-owned/foreign HTTP proof must be executed, not merely declared");
  const processOwn = preRunLines.slice(processMethod.testedBy.ownPositiveLine - 1,
    processMethod.testedBy.ownPositiveLine + 2).join("\n");
  const processForeign = preRunLines.slice(processMethod.testedBy.foreignDenialLine - 1,
    processMethod.testedBy.foreignDenialLine + 2).join("\n");
  const readinessOwn = preRunLines.slice(preRunMethod.testedBy.ownPositiveLine - 1,
    preRunMethod.testedBy.ownPositiveLine + 2).join("\n");
  const readinessForeign = preRunLines.slice(preRunMethod.testedBy.foreignDenialLine - 1,
    preRunMethod.testedBy.foreignDenialLine + 2).join("\n");
  assert.match(processOwn, /ownBlockedProcess = expectStatus\(await request\(/);
  assert.match(processOwn, /\), 422,/,
    "A valid owned Draft with unverified rules MUST fail closed, not calculate");
  assert.match(processForeign, /foreignBlockedProcess = expectStatus\(await request\(/);
  assert.match(processForeign, /\), 403,/);
  assert.match(readinessOwn, /ownPreRun = expectStatus\(await request\(/);
  assert.match(readinessOwn, /\), 200,/);
  assert.match(readinessForeign, /foreignPreRun = expectStatus\(await request\(/);
  assert.match(readinessForeign, /\), 403,/);
  assert.match(preRunLines[processMethod.testedBy.unchangedDbLine - 1] ?? "",
    /assert\.deepEqual\(ownedAfter, ownedBefore/,
    "Rejected owned process POST must not mutate the payroll run");
  assert.match(preRunLines[preRunMethod.testedBy.unchangedDbLine - 1] ?? "",
    /assert\.deepEqual\(victimAfter, victimBefore/,
    "Denied cross-tenant pre-run read must leave victim rows unchanged");
  assert.match(harness, /PRERUN_STATUTORY_VERIFICATION_UNRECORDED/,
    "No source-only test may invent official verification to pass money CI");

  const underpaymentFile = "scripts/qa/underpayment-posting-http.mjs";
  const underpaymentLines = readFileSync(underpaymentFile, "utf8").split("\n");
  const underpaymentWorkflow = readFileSync(".github/workflows/underpayment-posting.yml", "utf8");
  assert.match(underpaymentWorkflow, /MONEY_PROOF_TRANSPORT: http/);
  assert.match(underpaymentWorkflow, /posting: \['false', 'true'\]/);
  assert.match(underpaymentWorkflow, /npx tsx scripts\/qa\/underpayment-posting-http\.mjs/);
  const underpaymentMethods = Object.values(manifest.allApiRouteFiles).flatMap(r => r.methods)
    .filter(m => m.testedBy?.file === underpaymentFile);
  assert.equal(underpaymentMethods.length, 2, "Only two independently executed underpayment writes are credited");
  for (const [methodName, ownLine, foreignLine] of [["POST", 136, 149], ["PATCH", 166, 155]]) {
    const method = methodsByKey.get(methodName + " payroll-underpayments");
    assert.equal(method?.status, "COVERED");
    assert.equal(method.testedBy.file, underpaymentFile);
    assert.deepEqual([method.testedBy.ownPositiveLine, method.testedBy.foreignDenialLine], [ownLine, foreignLine]);
    assert.ok(underpaymentLines[ownLine - 1].includes(methodName === "POST" ? "status(await request" : "const winner = replies.find"));
    assert.ok(underpaymentLines[foreignLine - 1].includes("await deny(v,") &&
      underpaymentLines[foreignLine - 1].includes("v.org.id"));
    assert.ok(underpaymentLines[method.testedBy.unchangedDbLine - 1].includes("assert.deepEqual(await snapshot(v), before"));
  }
  // Six additional MNY-02 contractor/EWT methods are separately counted only
  // when their exact real HTTP own/foreign proof is pinned to this specific
  // reviewed suite. Do not weaken or change the historical 124/359 baseline.
  const contractorProof = "scripts/qa/tenant-mny02-contractors-http.mjs";
  const contractorSource = readFileSync(contractorProof, "utf8").split("\n");
  const contractorKeys = [
    "GET contractors", "POST contractors", "PATCH contractors", "DELETE contractors",
    "GET contractors/payments", "POST contractors/payments",
  ];
  assert.match(harness, /verifyMny02ContractorTenantIsolation\(f, \{ request, expectStatus \}\)/);
  let contractorMethods = 0;
  for (const key of contractorKeys) {
    const method = methodsByKey.get(key);
    assert.equal(method?.status, "COVERED", key + ": own/victim proof required");
    assert.equal(method.testedBy?.file, contractorProof, key + ": cannot borrow unrelated proof");
    const p = method.testedBy;
    assert.match(contractorSource[p.ownPositiveLine - 1] ?? "", /expectStatus\(await request\(/,
      key + ": executed own-employer success required");
    assert.match(contractorSource[p.foreignDenialLine - 1] ?? "", /expectStatus\(await request\(/,
      key + ": executed real foreign-employer denial required");
    assert.match(contractorSource[p.unchangedDbLine - 1] ?? "",
      /assert\.deepEqual\(await victimSnapshot\(victim\.id\), originalVictim/,
      key + ": unchanged victim DB records required");
    contractorMethods++;
  }
  assert.equal(contractorMethods, 6);
  const groupReport = manifest.allApiRouteFiles["src/app/api/multi-entity/reports/route.ts"]
    ?.methods.find(method => method.name === "GET");
  assert.equal(groupReport?.status, "COVERED",
    "Group report needs a distinct reviewed own/foreign and unattributed-employer denial proof");
  assert.equal(groupReport?.testedBy?.file, "scripts/qa/multi-entity-group-report-http.mjs");
  const groupReportCredits = 1;
  // The two new statutory action method credits must be independently linked
  // to owned real HTTP 200, two-attacker victim denial 403, and unchanged SQL.
  // Do NOT update the historical count without these exact-method receipts.
  const actionPath = "src/app/api/compliance/remittance-actions/route.ts";
  const actionMethods = manifest.allApiRouteFiles[actionPath]?.methods;
  assert.deepEqual(actionMethods?.map(method => method.name).sort(), ["GET", "POST"],
    "Exactly two statutory action HTTP methods; no extra provisional credit");
  const actionSuite = readFileSync("scripts/qa/remittance-action-entity-http.mjs", "utf8");
  const actionLines = actionSuite.split("\n");
  const actionReceipt = {
    GET: { own: 138, victim: 210 },
    POST: { own: 186, victim: 213 },
  };
  for (const method of actionMethods) {
    const pin = actionReceipt[method.name];
    assert.ok(pin, "No unrelated method can borrow the statutory action proof");
    assert.equal(method.status, "COVERED",
      method.name + ": separate real own/victim legal-employer evidence required");
    assert.equal(method.testedBy?.file, "scripts/qa/remittance-action-entity-http.mjs");
    assert.deepEqual([
      method.testedBy.line, method.testedBy.ownPositiveLine,
      method.testedBy.foreignDenialLine, method.testedBy.unchangedDbLine,
    ], [pin.own, pin.own, pin.victim, 237],
      "Statutory action source evidence pins must remain exact");
    const own = actionLines.slice(pin.own - 1, pin.own + 4).join("\n");
    const foreign = actionLines.slice(pin.victim - 1, pin.victim + 4).join("\n");
    assert.match(own, /expectStatus\(await request\("\/api\/compliance\/remittance-actions/);
    assert.match(own, /\), 200,/);
    assert.match(foreign, /expectStatus\(await request\("\/api\/compliance\/remittance-actions/);
    assert.match(foreign, /\), 403,/);
    if (method.name === "POST") {
      assert.match(own, /method: "POST"/);
      assert.match(foreign, /method: "POST"/);
    }
  }
  assert.match(actionLines[236], /assert\.deepEqual\(await snapshot\(victim\.id\), before,/,
    "Denied action mutations must leave actual victim DB/audit/outbox/payroll unchanged");
  assert.match(actionSuite, /for \(const attacker of \[attackerA, attackerB\]\)/,
    "Two independently authenticated unrelated attacker tenants are required");
  const actionWorkflow = readFileSync(".github/workflows/remittance-action-tenant-isolation.yml", "utf8");
  assert.match(actionWorkflow, /multi_entity: \['false', 'true'\]/);
  assert.match(actionWorkflow, /image: postgres:16/);
  assert.match(actionWorkflow, /npx tsx scripts\/qa\/remittance-action-entity-http\.mjs/);
  const actionCredits = actionMethods.length;
  const bir2316Methods = Object.values(manifest.allApiRouteFiles).flatMap(route => route.methods)
    .filter(m => m.testedBy?.file === "scripts/qa/tenant-bir2316-http.mjs");
  assert.equal(bir2316Methods.length, 3, "Three source-pinned real signed-in BIR2316 HTTP methods");
  assert.ok(bir2316Methods.every(m => m.status === "COVERED" &&
    m.testedBy?.ownPositiveLine && m.testedBy?.foreignDenialLine));
  assert.match(readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8"),
    /npx tsx scripts\/qa\/tenant-bir2316-http\.mjs/);
  // The next six MNY-02 expense/benefit methods have their own executable
  // three-employer proof. Do not count a generic 403 or a source-only check.
  const expenseBenefitFile = "scripts/qa/tenant-mny02-expenses-benefits-http.mjs";
  const expenseBenefitLines = readFileSync(expenseBenefitFile, "utf8").split("\n");
  const expenseBenefitKeys = [
    "GET expenses", "POST expenses", "PATCH expenses",
    "GET de-minimis", "POST de-minimis", "DELETE de-minimis",
  ];
  assert.match(harness, /verifyMny02ExpensesBenefitsIsolation\(f, \{ request, expectStatus, makeSession \}\)/);
  let expenseBenefitMethods = 0;
  for (const key of expenseBenefitKeys) {
    const method = methodsByKey.get(key);
    assert.equal(method?.status, "COVERED", key + ": current provisional real-HTTP proof required");
    assert.equal(method?.testedBy?.file, expenseBenefitFile, key + ": unique suite required");
    const p = method.testedBy;
    assert.match(expenseBenefitLines[p.ownPositiveLine - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(expenseBenefitLines[p.foreignDenialLine - 1] ?? "", /expectStatus\(await request\(/);
    assert.match(expenseBenefitLines[p.unchangedDbLine - 1] ?? "",
      /assert\.deepEqual\(await victimSnapshot\(victim\.id\), baseline/);
    expenseBenefitMethods++;
  }
  assert.equal(expenseBenefitMethods, 6);
  // Tenant-table credits are counted only when each cites an exact GET row of the shared table
  // runner with all three pinned proof lines; the inventory guard re-validates every row.
  const tableSource = readFileSync("scripts/qa/tenant-table-http.mjs", "utf8").split("\n");
  const writeTableSource = readFileSync("scripts/qa/tenant-write-table-http.mjs", "utf8").split("\n");
  const tableMethods = Object.entries(manifest.allApiRouteFiles).flatMap(([, route]) =>
    route.methods.filter(m => ["scripts/qa/tenant-table-http.mjs", "scripts/qa/tenant-write-table-http.mjs"].includes(m.testedBy?.file))
      .map(m => [m.name + " " + route.route, m]));
  for (const [key, m] of tableMethods) {
    assert.equal(m.status, "COVERED", key + ": table proof only ever credits COVERED");
    const writes = m.testedBy.file === "scripts/qa/tenant-write-table-http.mjs";
    const lines = writes ? writeTableSource : tableSource;
    const rowLines = readFileSync(m.testedBy.rowFile, "utf8").split("\n");
    assert.ok((rowLines[m.testedBy.rowLine - 1] ?? "").includes('{ key: "' + key + '",'), key + ": must cite its own table row");
    assert.match(lines[m.testedBy.ownPositiveLine - 1] ?? "", writes
      ? /const owned = expectStatus\(await request\(urlFor\("own"\),/ : /const owned = expectStatus\(await request\(item\.own,/);
    assert.match(lines[m.testedBy.foreignDenialLine - 1] ?? "", writes
      ? /const foreign = expectStatus\(await request\(urlFor\("foreign"\),/ : /const foreign = expectStatus\(await request\(item\.foreign,/);
    assert.match(lines[m.testedBy.unchangedDbLine - 1] ?? "", /assert\.deepEqual\(victimAfter, victimBefore,/);
  }
  // This newly added route is outside the historical API pool below. Its
  // distinct verifier is checked separately; it must not inflate old credits.
  const managerDirectReportCredits = manifest.allApiRouteFiles["src/app/api/hcm/manager-direct-reports/route.ts"].methods
    .filter(method => method.name === "GET" && method.status === "COVERED" && method.testedBy?.file === "scripts/qa/hcm-manager-direct-reports-http.mjs").length;

  // This ESS batch contributes only two provisional contribution-case methods.
  // Preserve the historical 124/359 baseline by separately proving and
  // subtracting those credits, never by increasing the historical constants.
  const essProofFile = "scripts/qa/tenant-ess-statutory-identity-http.mjs";
  const essLines = readFileSync(essProofFile, "utf8").split("\n");
  const contributionMethods = manifest.allApiRouteFiles["src/app/api/self/contribution-issues/route.ts"]?.methods;
  assert.deepEqual(contributionMethods?.map(method => method.name), ["GET", "POST"],
    "Only the two contribution-case verbs qualify for new ESS credits");
  assert.match(harness, /verifyEssStatutoryIdentityIsolation\(f, \{ request, expectStatus, makeSession \}\)/,
    "The real disposable HTTP/PG16 harness must execute the ESS proof");
  assert.match(essLines.join("\n"), /for \(const index of \[1, 2\]\)/,
    "Both independent attackers must be exercised");
  let essContributionCredits = 0;
  for (const [name, ownStatus] of [["GET", 200], ["POST", 201]]) {
    const method = contributionMethods.find(item => item.name === name);
    const proof = method?.testedBy;
    assert.equal(method?.status, "COVERED", name + ": provisional ESS credit requires real HTTP proof");
    assert.equal(proof?.file, essProofFile, name + ": no unrelated proof source may be borrowed");
    assert.equal(proof.denialKind, "same-session-revoked-membership");
    assert.equal(proof.ownStatus, ownStatus);
    assert.equal(proof.foreignStatus, 403);
    assert.equal(proof.line, proof.ownPositiveLine);
    for (const field of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine", "victimIdOrderingLine"]) {
      assert.ok(Number.isInteger(proof[field]) && proof[field] > 0 && proof[field] <= essLines.length,
        name + ": source-pinned " + field + " must exist");
    }
    const own = essLines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 7).join("\n");
    const denied = essLines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 7).join("\n");
    assert.match(own, name === "GET"
      ? /const caseResponse = expectStatus\(await request\(/
      : /const result = expectStatus\(await request\(/);
    assert.match(own, /\/api\/self\/contribution-issues/);
    assert.match(own, new RegExp("\\), " + ownStatus + ","),
      name + ": own request must succeed with its actual expected HTTP status");
    assert.match(denied, name === "GET"
      ? /const revokedContributionGet = expectStatus\(await request\(/
      : /const caseDenied = expectStatus\(await request\(/);
    assert.match(denied, /\), 403,/,
      name + ": original employer must be denied after real membership revocation");
    assert.match(essLines[proof.unchangedDbLine - 1] ?? "",
      /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/,
      name + ": victim SQL/audit/outbox must remain unchanged");
    assert.match(essLines[proof.victimIdOrderingLine - 1] ?? "", /f\.victimEmployee\.id > 6/);
    essContributionCredits++;
  }
  assert.equal(essContributionCredits, 2);
  assert.deepEqual(manifest.allApiRouteFiles["src/app/api/self/identifiers/route.ts"].methods
    .map(method => [method.name, method.status]), [["GET", "COVERED"], ["POST", "COVERED"]],
    "ESS identifier promotions retain their separately verified proof");
  assert.equal(managerDirectReportCredits, 1);
  // These three source-specific APIs are NEW methods, not recoveries from the
  // historical GAP pool. Require their actual family HTTP proofs, and retain
  // the original 124/359 baseline rather than silently inflating its recovery.
  const originalInventory = JSON.parse(readFileSync("scripts/qa/tenant-isolation-inventory/baseline.json", "utf8"));
  const newCorrectionMethods = ["GET hcm/effective-change-corrections", ...["return", "resubmit"].map(action => "POST hcm/effective-change-corrections/" + action)];
  for (const key of newCorrectionMethods) {
    const [verb, route] = key.split(" "), method = methodsByKey.get(key);
    assert.equal(originalInventory.api["src/app/api/" + route + "/route.ts"], undefined);
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy.rowFile, "scripts/qa/tenant-table-rows/" + (verb === "GET" ? "read" : "write") + "/hcm-corrections.mjs");
    assert.ok(method.testedBy.ownPositiveLine && method.testedBy.foreignDenialLine && method.testedBy.unchangedDbLine);
  }
  const promotionCredits = verifyPromotionCredits(manifest);
  assert.equal(promotionCredits, 16);
  // Keep the original 124/359 historical baseline unchanged. Only subtract
  // the six exact-source verified follow-on credits from the current ledger.
  const followOnCredits = verifyFollowOnCredits(manifest);
  assert.equal(followOnCredits, 6);
  const newDisjointCredits = verifyMoreCredits(manifest);
  assert.equal(newDisjointCredits, 3, "two receipts plus one issued-demand GET, excluding #1524 profile");
  // #1537 promotes one distinct HMO POST, but never GET or other benefits methods.
  // Keep its source-pinned HTTP credit separate from the historical 124/359 ledger.
  const hmoPostCredit = methodsByKey.get("POST benefits/hmo");
  assert.equal(hmoPostCredit?.status, "COVERED", "Only the executed HMO POST is provisionally credited");
  assert.equal(hmoPostCredit?.testedBy?.file, "scripts/qa/tenant-hmo-http.mjs",
    "The source-only benefits/HMO fixture cannot certify this method");
  assert.deepEqual(hmoPostCredit?.testedBy?.postActions,
    ["create_plan", "add_dependent", "update_dependent", "update_enrollment"]);
  assert.equal(hmoPostCredit?.testedBy?.passedJob,
    "https://github.com/erwinmehehe/payrollph/actions/runs/40675730756/job/122773670031");
  const hmoPostCredits = 1;
  // DL-02 demand-import POST is a separate, source-pinned review promotion (guarded in
  // tenant-isolation-coverage-inventory.test.mjs); keep it out of the historical 124/359 ledger.
  const dl02ImportCredits = [...methodsByKey.values()].filter(method =>
    method.status === "COVERED" &&
    ["scripts/qa/tenant-dl02-rows/demand-import.mjs", "scripts/qa/tenant-dl02-rows/self-photo.mjs",
      "scripts/qa/tenant-dl02-rows/web-bundy.mjs"].includes(method.testedBy?.file)).length;
  assert.equal(dl02ImportCredits, 3, "exactly demand-import POST, self/photo POST and web-bundy evidence GET are promoted");
  const selfDevelopmentCredits = verifySelfDevelopmentCredits(manifest);
  const performanceCoreCredits = verifyPerformanceCoreCredits(manifest);
  assert.equal(performanceCoreCredits, 4, "four complete-action Performance proofs remain separate from previous credits");
  assert.equal(selfDevelopmentCredits, 3, "new credits require their exact executed receipt and source anchors");
  const post1523Credits = verifyPost1523Credits(manifest);
  assert.equal(post1523Credits, 3, "only the three post-#1523 proofs can change this historical baseline");
  // WRK-01 staffing-policy POST/PATCH are two additional, independently
  // source-pinned fictional PG16 methods. Never count the unproven GET.
  const staffingPolicyMethods = manifest.allApiRouteFiles["src/app/api/workforce/demand-staffing/policies/route.ts"].methods;
  const staffingPolicyCredits = staffingPolicyMethods.filter(method =>
    method.status === "COVERED" &&
    method.testedBy?.file === "scripts/qa/tenant-wrk01-staffing-writes-http.mjs").length;
  assert.equal(staffingPolicyCredits, 2, "only staffing-policy POST and PATCH can earn the WRK-01 proof");
  assert.equal(staffingPolicyMethods.find(method => method.name === "GET")?.status, "GAP");
  // These six newer mainline Workforce credits already contribute to tableMethods.length.
  // Verify them explicitly, but do not double subtract from the historical 124/359 ledger.
  const newMainWorkforce = [
      "POST workforce/attendance-corrections",
      "POST workforce/coverage",
      "POST workforce/overtime",
      "POST workforce/schedule-swaps",
      "POST workforce/schedules",
      "POST workforce/timesheets"
  ];
  for (const key of newMainWorkforce) {
    const method = methodsByKey.get(key);
    assert.equal(method?.status, "COVERED", key + ": main proof credit must be preserved");
    assert.equal(method?.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs");
    assert.match(method?.testedBy?.rowFile ?? "", /^scripts\/qa\/tenant-table-rows\/write\//);
    for (const field of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine"]) {
      assert.ok(Number.isSafeInteger(method.testedBy[field]) && method.testedBy[field] > 0,
        key + ": owned/denied/unchanged PostgreSQL source anchors must exist");
    }
    assert.equal(method.testedBy.postgresMajor, 16);
  }
  assert.equal(manifest.metrics.coveredAfter - newDisjointCredits - promotionCredits - selfDevelopmentCredits - managerDirectReportCredits - additionalSourcePinnedMethods - vaultSourcePinnedMethods -
    moneyMethods.length - contractorMethods - underpaymentMethods.length - 2 - groupReportCredits - expenseBenefitMethods - bir2316Methods.length -
    tableMethods.length - mergedProofCredits - essContributionCredits - 7 - followOnCredits - hmoPostCredits - post1523Credits - staffingPolicyCredits - dl02ImportCredits - performanceCoreCredits, 124,
    "Preserve historical source-pinned covered receipts, tracking pre-run GET and blocked process separately");
  assert.equal(manifest.metrics.gap + newDisjointCredits + promotionCredits + selfDevelopmentCredits + additionalSourcePinnedMethods +
    vaultSourcePinnedMethods + moneyMethods.length + 1 + contractorMethods + underpaymentMethods.length + groupReportCredits + expenseBenefitMethods + bir2316Methods.length +
    tableMethods.length + mergedProofCredits + essContributionCredits + 7 + followOnCredits + hmoPostCredits + post1523Credits + staffingPolicyCredits + dl02ImportCredits + performanceCoreCredits - newCorrectionMethods.length, 359,
    "No historical GAP may silently disappear when an old process positive becomes an intentional blocker");
  assert.match(harness, /await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /assert\.equal\(passed\.size, 36/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
});
test("fictional payroll accounting close and pre-run readiness cannot share an overlapping period", () => {
  // An accounting close's Released fixture persists for the whole HTTP suite.
  // If its cutoff collides with the readiness Create & process probe, the API
  // correctly returns 409 period-conflict rather than exercising the expected
  // own-employer unverified-source 422. Keep both genuine controls testable.
  const fixture = source.match(
    /periodLabel: "CI-ACCOUNTING-CLOSE-"[^\n]*\n\s*periodStart: "(\d{4}-\d{2}-\d{2})", periodEnd: "(\d{4}-\d{2}-\d{2})",[^\n]*\n\s*payDate: "(\d{4}-\d{2}-\d{2})"/,
  );
  const readiness = harness.match(
    /const createBody = \{ organizationId: org\.id, legalEntityId: f\.entities\[idx\]\.id,[^\n]*\n\s*periodStart: "(\d{4}-\d{2}-\d{2})", periodEnd: "(\d{4}-\d{2}-\d{2})", payDate: "(\d{4}-\d{2}-\d{2})", processNow: true \};/,
  );
  assert.ok(fixture && readiness, "Both independently populated real-HTTP fixture periods must remain explicit");
  const [, closeStart, closeEnd, closePayDate] = fixture;
  const [, readinessStart, readinessEnd] = readiness;
  assert.ok(closeStart <= closeEnd && readinessStart <= readinessEnd,
    "Both payroll ranges must remain chronological");
  assert.ok(closeEnd < readinessStart || readinessEnd < closeStart,
    "Fictional Released close payroll must never shadow readiness Create & process with a 409 overlap");
  assert.ok(closePayDate > closeEnd);
  assert.ok(source.includes('completedAt: "' + closePayDate + 'T00:00:00.000Z"'),
    "Fictional audit settlement reference must use the same pay date; never claim a real transfer");
  const closeCall = harness.indexOf(
    'await (await import("./tenant-high-risk-01-http.mjs")).verifyHighRiskBatchOne(f, { request, expectStatus, makeSession });',
  );
  const readinessCall = harness.indexOf("await verifyPreRunReadinessTenantRead(f);");
  assert.ok(closeCall >= 0 && readinessCall > closeCall,
    "The close fixture persists before the readiness proof; their periods must stay isolated");
});
