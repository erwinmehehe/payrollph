/**
 * Regression controls for the offboarding BIR 2316 and unsigned certificate
 * source/PDF paths. Source/pure-policy tests are not HTTP acceptance:
 * the separate disposable PG16+HTTPS proof must execute and pass before
 * the provisional three-method coverage can be independently accepted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { frozenFinalPayLegalEntityId, historical2316Employer } from "../src/lib/bir-2316-employer";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";

test("frozen employer ID rejects absent, null, forged, fractional and unsafe evidence", () => {
  assert.equal(frozenFinalPayLegalEntityId({ sourceFingerprint: { employeeLegalEntityId: 11 } }), 11);
  for (const source of [
    undefined, null, false, "", [], {}, { sourceFingerprint: null },
    { sourceFingerprint: [] },
    { sourceFingerprint: { employeeLegalEntityId: null } },
    { sourceFingerprint: { employeeLegalEntityId: "11" } },
    { sourceFingerprint: { employeeLegalEntityId: -1 } },
    { sourceFingerprint: { employeeLegalEntityId: 0 } },
    { sourceFingerprint: { employeeLegalEntityId: 11.5 } },
    { sourceFingerprint: { employeeLegalEntityId: Number.MAX_SAFE_INTEGER + 1 } },
  ]) assert.equal(frozenFinalPayLegalEntityId(source), null);
});

test("final-pay entity authorizes frozen employer, never transferred employee's current employer", () => {
  const legacy = { name: "Fictional Group", legalName: null, birTin: "999999999", birBranchCode: "0000" };
  const entities = [
    { id: 11, organizationId: 1, legalName: "Fictional Original Ltd", birTin: "123456789", birBranchCode: "0001" },
    { id: 22, organizationId: 1, legalName: "Fictional New Ltd", birTin: "234567890", birBranchCode: "0002" },
  ];
  const snapshot = { sourceFingerprint: { employeeLegalEntityId: 11 } };
  const historical = historical2316Employer({ organizationId: 1, snapshot, entities, legacy });
  assert.equal(historical.ok, true);
  if (!historical.ok) return;
  assert.equal(historical.legalEntityId, 11);
  const currentEmployeeEntityId = 22;
  assert.notEqual(currentEmployeeEntityId, historical.legalEntityId);
  const originalGrant = decideEntityAccess({
    role: "payroll", availableEntityIds: [11, 22], grantedEntityIds: [11], requested: 11,
  });
  const newEmployerGrant = decideEntityAccess({
    role: "payroll", availableEntityIds: [11, 22], grantedEntityIds: [22], requested: 22,
  });
  assert.equal(entityResourceAllowed(originalGrant, historical.legalEntityId), true);
  assert.equal(entityResourceAllowed(newEmployerGrant, historical.legalEntityId), false);
  assert.equal(entityResourceAllowed(originalGrant, null), false);
  assert.equal(entityResourceAllowed(originalGrant, 999), false);
  assert.equal(decideEntityAccess({
    role: "payroll", availableEntityIds: [11, 22], grantedEntityIds: [11], requested: "all",
  }).ok, false);
  assert.equal(decideEntityAccess({
    role: "payroll", availableEntityIds: [11, 22], grantedEntityIds: [], requested: 11,
  }).ok, false);
  assert.equal(decideEntityAccess({
    role: "payroll", availableEntityIds: [22], grantedEntityIds: [11], requested: 11,
  }).ok, false, "inactive historical employer requires an explicit reviewed access policy");
});

test("offboarding draft enforces employer selection and frozen scope before tax identity or response", () => {
  const source = readFileSync("src/app/api/separation/[id]/2316/route.ts", "utf8");
  const resolve = source.indexOf("resolveMultiEntityContext({");
  const gate = source.indexOf("assertEntityResource(entityScope.context, frozenFinalPayLegalEntityId(snapshot))");
  const registration = source.indexOf("historical2316Employer(");
  const tin = source.indexOf("decryptGovernmentId(employee.tin)");
  const render = source.indexOf("renderForm2316({");
  assert.ok(resolve > 0 && gate > resolve && registration > gate && tin > registration && render > tin);
  assert.match(source, /certificateDraftEnabled\(\) \|\| entityScope\.context\.enabled/);
  assert.match(source, /if \(!entityScope\.ok\) return entityScope\.response;/);
  assert.match(source, /if \(entityDenied\) return entityDenied;/);
  assert.match(source, /if \(historicalDenied\) return historicalDenied;/);
  assert.match(source, /userId: session\.id, organizationId: separation\.organizationId, request/);
});

test("unsigned 2316 GET source and POST PDF share employer-scoped handler", () => {
  const source = readFileSync("src/app/api/year-end/2316-certificate/route.ts", "utf8");
  const resolve = source.indexOf("resolveMultiEntityContext({");
  const early = source.indexOf("assertEntityResource(entityScope.context, frozenFinalPayLegalEntityId(frozen.snapshot))");
  const load = source.indexOf("load2316CertificateSource(scope);");
  const recheck = source.indexOf("assertEntityResource(entityScope.context, source.legalEntityId)");
  const digest = source.indexOf("certificateSourceDigest(source)");
  const pdf = source.indexOf("render2316CertificatePdf(source, review)");
  assert.ok(resolve > 0 && early > resolve && load > early && recheck > load && digest > recheck && pdf > digest);
  assert.match(source, /eq\(separationRecords\.id, scope\.separationId\)/);
  assert.match(source, /eq\(separationRecords\.organizationId, scope\.organizationId\)/);
  assert.match(source, /eq\(separationRecords\.employeeId, scope\.employeeId\)/);
  assert.match(source, /if \(earlyDenied\) return earlyDenied;/);
  assert.match(source, /if \(sourceDenied\) return sourceDenied;/);
  assert.match(source, /if \(scope\.separationId === undefined\)/);
  assert.match(source, /export const GET = \(request: Request\) => respond\(request, "source"\);/);
  assert.match(source, /export const POST = \(request: Request\) => respond\(request, "pdf"\);/);
});

test("three BIR document methods have executed-path HTTP fixtures and remain review-gated", () => {
  const workflow = readFileSync(".github/workflows/multi-entity-browser-qa.yml", "utf8");
  const script = readFileSync("scripts/qa/tenant-bir2316-http.mjs", "utf8");
  const inventory = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  assert.match(workflow, /npx tsx scripts\/qa\/tenant-bir2316-http\.mjs/);
  assert.match(workflow, /MULTI_ENTITY_ENABLED: "true"/);
  assert.match(workflow, /BIR_2316_CERTIFICATE_DRAFT_ENABLED: "true"/);
  assert.match(workflow, /BIR_2316_WITHHOLDING_EVIDENCE_ENABLED: "true"/);
  assert.match(workflow, /BIR_2316_RECONCILIATION_ENABLED: "true"/);
  assert.match(workflow, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(workflow, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(script, /MULTI_ENTITY_QA_MODE, "synthetic-postgres-only"/);
  assert.match(script, /for \(const idx of \[0, 1\]\)/);
  assert.match(script, /await login\(context, fixture\.people\[idx \* 3\]\.email/);
  assert.match(script, /rows\[4\]\.id > rows\[0\]\.id && rows\[4\]\.id > rows\[1\]\.id/);
  assert.match(script, /const foreignDraft = expectStatus\(await request\(context, ON, draftPath\(victim\)\)/);
  assert.match(script, /const foreignSource = expectStatus\(await request\(context, ON, sourcePath\(victim\)\)/);
  assert.match(script, /const foreignPdf = expectStatus\(await request\(context, ON, sourcePath\(victim\)/);
  assert.match(script, /assert\.deepEqual\(victimAfter, victimBefore/);
  assert.match(script, /Revoked historical employer grant denies existing signed-in PDF generation/);
  assert.match(script, /Transferred employee source must use prior employer/);
  for (const [path, verbs] of [
    ["src/app/api/separation/[id]/2316/route.ts", ["GET"]],
    ["src/app/api/year-end/2316-certificate/route.ts", ["GET", "POST"]],
  ] as const) {
    for (const verb of verbs) {
      const method = inventory.allApiRouteFiles[path].methods.find((m: { name: string }) => m.name === verb);
      assert.equal(method?.status, "COVERED", path + " " + verb);
      assert.equal(method.testedBy?.file, "scripts/qa/tenant-bir2316-http.mjs");
      for (const key of ["line", "ownPositiveLine", "foreignDenialLine",
        ...(verb === "POST" ? ["unchangedDbLine"] : [])]) {
        const number = method.testedBy?.[key];
        assert.ok(Number.isInteger(number) && number > 0 && number <= script.split("\n").length,
          path + " " + verb + " missing exact proof " + key);
      }
    }
  }
  // Live counts are invariants (tallies add up; nothing proven regresses against the base),
  // not pinned numbers that every later batch would have to edit.
  assertLiveTenantCounts(assert, inventory);
});
