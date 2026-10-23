/**
 * Regression controls for the offboarding BIR 2316 and unsigned certificate
 * source/PDF paths. Source checks plus the pure policy are NOT authenticated
 * PostgreSQL HTTP tenant proof; keep method status GAP until that is executed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { frozenFinalPayLegalEntityId, historical2316Employer } from "../src/lib/bir-2316-employer";
import { decideEntityAccess, entityResourceAllowed } from "../src/lib/multi-entity-policy";

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
