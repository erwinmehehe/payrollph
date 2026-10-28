import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  METHOD, PATH, routeFor, assertRefused, assertSourceUnchanged,
  requireDisposableAttestationRecovery,
} from "../scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs";

const safe = Object.freeze({
  GITHUB_ACTIONS: "true",
  CI: "true",
  NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_TABLE_PROFILE: "default",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DEMO_MODE: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false",
  WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
});

test("strict run profile refuses production, Neon, provider and unauthorized service hosts", () => {
  assert.doesNotThrow(() => requireDisposableAttestationRecovery(safe));
  for (const key of [
    "GITHUB_ACTIONS", "CI", "NODE_ENV", "TENANT_SECOND_PASS_MODE",
    "TENANT_TABLE_PROFILE", "DATABASE_URL", "SECURITY_SMOKE_URL",
    "DEMO_MODE", "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED", "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED",
  ]) {
    assert.throws(() => requireDisposableAttestationRecovery({
      ...safe, [key]: undefined,
    }), /MANAGER_ATTESTATION_RECOVERY_REFUSED/, key);
    assert.throws(() => requireDisposableAttestationRecovery({
      ...safe, [key]: key === "DATABASE_URL"
        ? "postgresql://prod.example.com/payroll" : "wrong",
    }), /MANAGER_ATTESTATION_RECOVERY_REFUSED/, key);
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY"]) {
    assert.throws(() => requireDisposableAttestationRecovery({
      ...safe, [key]: "real-key-not-allowed",
    }), /MANAGER_ATTESTATION_RECOVERY_REFUSED/, key);
  }
});

test("canonical GET path carries actual path decision ID and query employer selector", () => {
  assert.equal(METHOD, "GET hcm/employment-term-decisions/[id]/manager-attestation");
  assert.equal(PATH, "/api/hcm/employment-term-decisions/");
  assert.equal(routeFor(407, 12),
    "/api/hcm/employment-term-decisions/407/manager-attestation?organizationId=12");
  assert.equal(routeFor(407, 12, "&decisionId=808&employeeId=909&userId=707"),
    "/api/hcm/employment-term-decisions/407/manager-attestation?organizationId=12"
      + "&decisionId=808&employeeId=909&userId=707");
  for (const bad of [-1, 0, 1.5, Infinity, NaN, 2 ** 33, "99", null]) {
    assert.throws(() => routeFor(bad, 12), /RECOVERY_REFUSED/);
    assert.throws(() => routeFor(407, bad), /RECOVERY_REFUSED/);
  }
  assert.throws(() => routeFor(407, 12, "&redirect=https://evil.example"), /RECOVERY_REFUSED/);
});

test("real denied reply must have the expected status, bounded error and no victim private data", () => {
  const victimMarker = "TTBL-VICTIM-private";
  const victimStatement = "TTBL-VICTIM-private manager statement";
  const good = {
    status: 404, json: { error: "Employment-term decision not found." },
    text: '{"error":"Employment-term decision not found."}',
  };
  assert.doesNotThrow(() => assertRefused(good, 404,
    [victimMarker, victimStatement], "forged path"));
  for (const bad of [
    { ...good, status: 200 },
    { ...good, status: 403 },
    { ...good, json: { attestations: [] }, text: '{"attestations":[]}' },
    { ...good, json: { error: "error", attestations: [{ statement: victimStatement }] } },
    { ...good, text: '{"error":"' + victimStatement + '"}' },
    { ...good, text: "x".repeat(1201) },
  ]) {
    assert.throws(() => assertRefused(bad, 404,
      [victimMarker, victimStatement], "forged path"));
  }
});

test("real before/after business state comparisons detect tampered attestation and audit", () => {
  const before = {
    org: [{ id: 4 }], decisions: [{ id: 91, status: "pending_approval" }],
    attestations: [{ id: 93, statement: "private manager decision" }],
    audit: [{ id: 3, action: "attestation" }],
    payroll: [{ id: 13, status: "Released" }],
  };
  assert.doesNotThrow(() => assertSourceUnchanged(before, structuredClone(before), "victim"));
  for (const table of ["decisions", "attestations", "audit", "payroll"]) {
    const after = structuredClone(before);
    after[table][0].changed = true;
    assert.throws(() => assertSourceUnchanged(before, after, "victim"));
  }
});

test("new source executes own 200, genuine foreign 403, stolen own-org path 404 and ignored spoof selector", () => {
  const code = readFileSync(
    "scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs", "utf8");
  for (const required of [
    "requireDisposableAttestationRecovery();",
    'await seedEmployer("ATTA"',
    'await seedEmployer("ATTB"',
    'await seedEmployer("VICTIM"',
    "employer.seeded = await row.seed(employer)",
    "const victimOwn = standaloneExpectStatus(await standaloneRequest(",
    "row.prove(own, ctx);",
    "row.prove(earlierOwn, ctx)",
    "routeFor(victim.seeded.id, victim.org.id)",
    "assertRefused(foreign, 403",
    "routeFor(victim.seeded.id, attacker.org.id)",
    "assertRefused(stolenVictimPath, 404",
    "routeFor(other.seeded.id, attacker.org.id)",
    "assertRefused(stolenPeerPath, 404",
    'const forgedQuery = routeFor(attacker.seeded.id, attacker.org.id,',
    'assert.deepEqual(ignored.json, own.json,',
    "assertSourceUnchanged(before.get(e.org.id), await readBusiness(e.org.id)",
  ]) {
    assert.ok(code.includes(required), "missing independently executed source condition: " + required);
  }
  assert.ok(!code.includes('method: "POST"'),
    "read recovery cannot borrow method evidence from manager attestation writes");
});

test("actual authoritative snapshot includes attestations, decision, staff, audit and money sources", () => {
  const code = readFileSync(
    "scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs", "utf8");
  for (const source of [
    "hcmEmploymentDecisionManagerAttestations",
    "hcmEmploymentTermDecisions", "hcmEmploymentTerms",
    "positions", "positionAssignments", "jobProfiles",
    "employees", "employeePayProfiles", "orgUnits", "legalEntities",
    "userOrganizations", "auditEvents",
    "payrollRuns", "payrollEntries", "payoutBatches",
    "auditBusinessSnapshot(audit)",
  ]) assert.ok(code.includes(source), "victim source missing from real SQL snapshot: " + source);
});

test("original route is organization/decision bound; only target GET is still GAP", () => {
  const route = readFileSync(
    "src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts", "utf8");
  const lib = readFileSync("src/lib/hcm-manager-attestation.ts", "utf8");
  assert.match(route, /await attestationAccess\(user, organizationId, decisionId\)/);
  assert.match(route, /listDecisionManagerAttestations\(\{ organizationId, decisionId \}\)/);
  assert.match(lib, /eq\(hcmEmploymentTermDecisions\.organizationId, input\.organizationId\)/);
  assert.match(lib, /eq\(hcmEmploymentDecisionManagerAttestations\.organizationId, input\.organizationId\)/);
  assert.match(lib, /eq\(hcmEmploymentDecisionManagerAttestations\.decisionId, input\.decisionId\)/);
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const key = "src/app/api/hcm/employment-term-decisions/[id]/manager-attestation/route.ts";
  const record = manifest.allApiRouteFiles[key];
  assert.equal(record.gitBlobSha, "5de82dc98b5fa336b7ec4f8051bc7e66bf3c167c");
  assert.equal(record.methods.find(x => x.name === "GET")?.status, "GAP");
  const post = record.methods.find(x => x.name === "POST");
  assert.equal(post?.status, "COVERED", "POST has separately executed persisted manager-attestation evidence");
  assert.equal(post?.testedBy?.file, "scripts/qa/tenant-write-table-http.mjs");
  assert.equal(post?.testedBy?.rowFile, "scripts/qa/tenant-table-rows/write/hcm-manager-attestation-post.mjs");
  for (const pin of ["rowLine", "ownPositiveLine", "foreignDenialLine", "unchangedDbLine"]) assert.ok(Number.isSafeInteger(post.testedBy[pin]) && post.testedBy[pin] > 0);
});

test("dedicated workflow runs independent real localhost PG16 proof with no provider", () => {
  const wf = readFileSync(
    ".github/workflows/tenant-hcm-manager-attestation-recovery.yml", "utf8");
  const occurrences = phrase => wf.split(phrase).length - 1;
  assert.match(wf, /image: postgres:16/);
  assert.ok(wf.includes("persist-credentials: false"));
  assert.ok(wf.includes('WORKER_ENABLED: "false"'));
  assert.ok(wf.includes('CENTRAL_SCHEDULER_ENABLED: "false"'));
  assert.ok(wf.includes('node scripts/qa/tenant-table-env.mjs default >> "$GITHUB_ENV"'));
  for (const term of [
    "run: npm run db:push",
    "run: node scripts/qa/apply-isolated-baseline.mjs",
    "run: npm run build",
    "npm start -- -H 127.0.0.1",
    "node --import tsx scripts/qa/tenant-hcm-manager-attestation-recovery-http.mjs",
  ]) assert.ok(wf.includes(term), term);
  assert.equal(occurrences("https://api."), 0);
});
