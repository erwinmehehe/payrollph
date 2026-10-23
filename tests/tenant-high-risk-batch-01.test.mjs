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
  assert.equal(manifest.metrics.coveredAfter - additionalSourcePinnedMethods - vaultSourcePinnedMethods -
    moneyMethods.length - contractorMethods - underpaymentMethods.length - 2, 124,
    "Preserve historical source-pinned covered receipts, tracking pre-run GET and blocked process separately");
  assert.equal(manifest.metrics.gap + additionalSourcePinnedMethods +
    vaultSourcePinnedMethods + moneyMethods.length + 1 + contractorMethods + underpaymentMethods.length, 359,
    "No historical GAP may silently disappear when an old process positive becomes an intentional blocker");
  assert.match(harness, /await \(await import\("\.\/tenant-high-risk-01-http\.mjs"\)\)\.verifyHighRiskBatchOne\(f, \{ request, expectStatus, makeSession \}\)/);
  assert.match(source, /for \(const idx of \[1, 2\]\)/);
  assert.match(source, /assert\.equal\(passed\.size, 36/);
  assert.match(source, /assert\.deepEqual\(victimAfter, victimBefore/);
});
